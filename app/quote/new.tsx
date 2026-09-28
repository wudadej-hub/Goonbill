import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  Client,
  DraftItem,
  createClient,
  createQuote,
  getQuote,
  getSetting,
  getTaxRates,
  listClients,
  updateQuote,
} from '../../lib/db';
import { parseDollarsToCents } from '../../lib/format';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Field, Screen, Title } from '../../components/ui';

function emptyItem(): DraftItem {
  return { description: '', quantity: '1', rate: '' };
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function NewQuoteScreen() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const editingId = edit ? Number(edit) : null;
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [materials, setMaterials] = useState('');
  const [timeline, setTimeline] = useState('');
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [gstPct, setGstPct] = useState('5');
  const [pstPct, setPstPct] = useState('6');
  const [paymentSchedule, setPaymentSchedule] = useState('');
  const [lateFees, setLateFees] = useState('');
  const [scopePolicy, setScopePolicy] = useState('');
  const [validUntil, setValidUntil] = useState(addDaysISO(30));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => {
    setClients(listClients());
    const rates = getTaxRates();
    setGstPct(String(rates.gst * 100));
    setPstPct(String(rates.pst * 100));
    setPaymentSchedule(getSetting('default_payment_schedule'));
    setLateFees(getSetting('default_late_fees'));
    setScopePolicy(getSetting('default_scope_policy'));
    if (editingId) {
      const q = getQuote(editingId);
      if (q) {
        setClientId(q.client_id);
        setTitle(q.title);
        setScope(q.scope);
        setMaterials(q.materials);
        setTimeline(q.timeline);
        setItems(
          q.items.map((i) => ({
            description: i.description,
            quantity: String(i.quantity),
            rate: (i.rate_cents / 100).toFixed(2),
          }))
        );
        setGstPct(String(q.gst_rate * 100));
        setPstPct(String(q.pst_rate * 100));
        setPaymentSchedule(q.payment_schedule);
        setLateFees(q.late_fees);
        setScopePolicy(q.scope_change_policy);
        setValidUntil(q.valid_until);
      }
    }
  }, [editingId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const updateItem = (i: number, patch: Partial<DraftItem>) =>
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const removeItem = (i: number) => setItems((p) => p.filter((_, idx) => idx !== i));

  const save = () => {
    setError(null);
    let resolvedClientId = clientId;
    if (!resolvedClientId) {
      if (!newClientName.trim()) {
        setError('Pick a client or type a new client name.');
        return;
      }
      resolvedClientId = createClient(newClientName.trim()).id;
    }
    const parsedItems = items
      .filter((i) => i.description.trim())
      .map((i) => ({
        description: i.description.trim(),
        quantity: parseFloat(i.quantity) || 1,
        rate_cents: parseDollarsToCents(i.rate),
      }));
    if (parsedItems.length === 0) {
      setError('Add at least one line item with a description.');
      return;
    }
    if (!scope.trim()) {
      setError('Describe the scope of work — that is what the client is agreeing to.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        updateQuote(editingId, {
          clientId: resolvedClientId,
          title,
          scope,
          materials,
          timeline,
          items: parsedItems,
          gstRate: (parseFloat(gstPct) || 0) / 100,
          pstRate: (parseFloat(pstPct) || 0) / 100,
          paymentSchedule,
          lateFees,
          scopeChangePolicy: scopePolicy,
          validUntil,
        });
        router.replace(`/quote/${editingId}`);
      } else {
        const q = createQuote({
          clientId: resolvedClientId,
          title,
          scope,
          materials,
          timeline,
          items: parsedItems,
          gstRate: (parseFloat(gstPct) || 0) / 100,
          pstRate: (parseFloat(pstPct) || 0) / 100,
          paymentSchedule,
          lateFees,
          scopeChangePolicy: scopePolicy,
          validUntil,
        });
        router.replace(`/quote/${q.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the quote.');
      setSaving(false);
    }
  };

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Title>{editingId ? 'Edit Quote' : 'New Quote'}</Title>
        <Text style={styles.hint}>Agreed upfront: scope, price, and terms — before any work starts.</Text>

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        ) : null}

        <Text style={styles.sectionTitle}>Client</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.clientRow}>
          {clients.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => {
                setClientId(c.id);
                setNewClientName('');
              }}
              style={[styles.clientChip, clientId === c.id && styles.clientChipActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.clientChipText, clientId === c.id && styles.clientChipTextActive]}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Field
          voice label="Or new client name"
          placeholder="e.g. John Smith"
          value={newClientName}
          onChangeText={(t) => {
            setNewClientName(t);
            if (t) setClientId(null);
          }}
        />

        <Text style={styles.sectionTitle}>The job</Text>
        <Field voice label="Project title" placeholder="e.g. Bathroom renovation" value={title} onChangeText={setTitle} />
        <Field
          voice
          label="Scope of work *"
          placeholder="Exactly what is included — and what is not."
          multiline
          value={scope}
          onChangeText={setScope}
        />
        <Field
          voice label="Materials"
          placeholder="Who supplies what, brands, allowances…"
          multiline
          value={materials}
          onChangeText={setMaterials}
        />
        <Field
          voice label="Timeline"
          placeholder="e.g. Start June 2, done by June 9"
          multiline
          value={timeline}
          onChangeText={setTimeline}
        />

        <Text style={styles.sectionTitle}>Line items</Text>
        {items.map((item, i) => (
          <Card key={i}>
            <Field
              voice
              label={`Item ${i + 1}`}
              placeholder="What will you do?"
              value={item.description}
              onChangeText={(t) => updateItem(i, { description: t })}
            />
            <View style={styles.itemRow}>
              <Field
                label="Qty"
                keyboardType="decimal-pad"
                value={item.quantity}
                onChangeText={(t) => updateItem(i, { quantity: t })}
                style={{ flex: 1 }}
              />
              <Field
                label="Rate ($)"
                keyboardType="decimal-pad"
                placeholder="0.00"
                value={item.rate}
                onChangeText={(t) => updateItem(i, { rate: t })}
                style={{ flex: 2, marginLeft: spacing.sm }}
              />
              <TouchableOpacity onPress={() => removeItem(i)} style={styles.removeBtn} activeOpacity={0.7}>
                <Text style={styles.removeText}>✕</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}
        <Button title="+ Add item" variant="secondary" onPress={() => setItems((p) => [...p, emptyItem()])} />

        <Text style={styles.sectionTitle}>Terms</Text>
        <Field
          voice label="Payment schedule"
          placeholder="e.g. 50% deposit, balance on completion"
          multiline
          value={paymentSchedule}
          onChangeText={setPaymentSchedule}
        />
        <Field
          voice label="Late fees"
          placeholder="e.g. 2% per month on overdue balances"
          multiline
          value={lateFees}
          onChangeText={setLateFees}
        />
        <Field
          voice label="If the scope changes"
          placeholder="Extra work needs a written change order first…"
          multiline
          value={scopePolicy}
          onChangeText={setScopePolicy}
        />
        <View style={styles.itemRow}>
          <Field label="GST %" keyboardType="decimal-pad" value={gstPct} onChangeText={setGstPct} style={{ flex: 1 }} />
          <Field
            label="PST %"
            keyboardType="decimal-pad"
            value={pstPct}
            onChangeText={setPstPct}
            style={{ flex: 1, marginLeft: spacing.sm }}
          />
          <Field
            label="Valid until (YYYY-MM-DD)"
            value={validUntil}
            onChangeText={setValidUntil}
            style={{ flex: 2, marginLeft: spacing.sm }}
          />
        </View>

        <Button title={editingId ? 'Save Changes' : 'Save Quote'} onPress={save} loading={saving} style={styles.saveBtn} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  hint: { color: theme.muted, fontSize: 14, marginBottom: spacing.md },
  sectionTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm },
  errorCard: { borderColor: theme.danger },
  errorText: { color: theme.danger, fontSize: 14 },
  clientRow: { marginBottom: spacing.sm },
  clientChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: spacing.sm,
    backgroundColor: theme.surface,
  },
  clientChipActive: { borderColor: theme.accent, backgroundColor: theme.surface2 },
  clientChipText: { color: theme.text, fontSize: 15, fontWeight: '600' },
  clientChipTextActive: { color: theme.accent },
  itemRow: { flexDirection: 'row', alignItems: 'flex-end' },
  removeBtn: { padding: spacing.sm, marginLeft: spacing.sm, marginBottom: spacing.sm },
  removeText: { color: theme.danger, fontSize: 20 },
  saveBtn: { marginTop: spacing.md },
});
