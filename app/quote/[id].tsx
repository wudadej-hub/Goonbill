import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { refreshReminders } from '../../lib/reminders';
import {
  QuoteStatus,
  QuoteWithItems,
  convertQuoteToInvoice,
  deleteQuote,
  getQuote,
  setQuoteStatus,
  signQuote,
} from '../../lib/db';
import { formatCents, formatDate } from '../../lib/format';
import { quoteHtml } from '../../lib/pdf';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Field, Screen, Title } from '../../components/ui';

const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: theme.muted,
  sent: theme.warning,
  approved: theme.accent,
  declined: theme.danger,
  converted: theme.text,
};

function Section({ title, body }: { title: string; body: string }) {
  if (!body) return null;
  return (
    <Card>
      <Text style={styles.secLabel}>{title}</Text>
      <Text style={styles.secBody}>{body}</Text>
    </Card>
  );
}

export default function QuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [quote, setQuote] = useState<QuoteWithItems | null>(null);
  const [sharing, setSharing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [sigName, setSigName] = useState('');

  const load = useCallback(() => {
    const q = getQuote(Number(id));
    setQuote(q);
  }, [id]);

  useFocusEffect(load);

  const setStatus = (s: QuoteStatus) => {
    if (!quote) return;
    setQuoteStatus(quote.id, s);
    load();
  };

  const doSign = () => {
    if (!quote || !sigName.trim()) {
      Alert.alert('Signature needed', 'Type the client name as their signature.');
      return;
    }
    signQuote(quote.id, sigName.trim());
    setStatus('approved');
  };

  const sharePdf = async () => {
    if (!quote) return;
    setSharing(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: quoteHtml(quote) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share ${quote.number}`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Sharing not available', `PDF saved at ${uri}`);
      }
    } catch (e) {
      Alert.alert('Could not create PDF', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSharing(false);
    }
  };

  const doConvert = () => {
    if (!quote) return;
    Alert.alert(
      'Create invoice?',
      `This makes an invoice from ${quote.number} for ${formatCents(quote.total_cents)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create Invoice',
          onPress: () => {
            setConverting(true);
            try {
              const invId = convertQuoteToInvoice(quote.id);
              refreshReminders();
              router.push(`/invoice/${invId}`);
            } catch (e) {
              Alert.alert('Could not convert', e instanceof Error ? e.message : 'Unknown error');
              setConverting(false);
            }
          },
        },
      ]
    );
  };

  const confirmDelete = () => {
    if (!quote) return;
    Alert.alert('Delete quote?', `${quote.number} will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteQuote(quote.id);
          router.back();
        },
      },
    ]);
  };

  if (!quote) {
    return (
      <Screen>
        <EmptyState message="Quote not found." />
      </Screen>
    );
  }

  const color = STATUS_COLORS[quote.status];
  const signed = !!quote.client_signature;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Title>{quote.number}</Title>
            <Text style={styles.meta}>
              {quote.client_name} · {formatDate(quote.created_at)}
              {quote.valid_until ? ` · Valid until ${formatDate(quote.valid_until)}` : ''}
            </Text>
            {quote.title ? <Text style={styles.projTitle}>{quote.title}</Text> : null}
          </View>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>{quote.status.toUpperCase()}</Text>
          </View>
        </View>

        <Section title="Scope of work" body={quote.scope} />
        <Section title="Materials" body={quote.materials} />
        <Section title="Timeline" body={quote.timeline} />

        <Card>
          {quote.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemMain}>
                <Text style={styles.itemDesc}>{item.description}</Text>
                <Text style={styles.itemSub}>
                  {item.quantity} × {formatCents(item.rate_cents)}
                </Text>
              </View>
              <Text style={styles.itemAmount}>{formatCents(Math.round(item.quantity * item.rate_cents))}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatCents(quote.subtotal_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>GST ({quote.gst_rate * 100}%)</Text>
            <Text style={styles.totalValue}>{formatCents(quote.gst_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>PST ({quote.pst_rate * 100}%)</Text>
            <Text style={styles.totalValue}>{formatCents(quote.pst_cents)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandRow]}>
            <Text style={styles.grandLabel}>Estimated total</Text>
            <Text style={styles.grandValue}>{formatCents(quote.total_cents)}</Text>
          </View>
        </Card>

        <Section title="Payment schedule" body={quote.payment_schedule} />
        <Section title="Late fees" body={quote.late_fees} />
        <Section title="If the scope changes" body={quote.scope_change_policy} />

        {signed ? (
          <Card style={styles.signedCard}>
            <Text style={styles.secLabel}>Signed</Text>
            <Text style={styles.sigName}>{quote.client_signature}</Text>
            <Text style={styles.meta}>Accepted {formatDate(quote.signed_at)}</Text>
          </Card>
        ) : quote.status === 'sent' ? (
          <Card>
            <Text style={styles.secLabel}>Client signature</Text>
            <Text style={styles.hint}>
              Have the client type their name here — or sign the shared PDF. Signing marks the quote approved.
            </Text>
            <Field voice label="Client name (signature)" placeholder="e.g. John Smith" value={sigName} onChangeText={setSigName} />
            <Button title="Sign & Approve" onPress={doSign} />
          </Card>
        ) : null}

        <View style={styles.actions}>
          {quote.status === 'draft' && <Button title="Mark as Sent" onPress={() => setStatus('sent')} />}
          {quote.status === 'sent' && (
            <>
              <Button title="Mark Approved" onPress={() => setStatus('approved')} />
              <Button title="Mark Declined" variant="secondary" onPress={() => setStatus('declined')} />
            </>
          )}
          {quote.status === 'approved' && (
            <Button title="Convert to Invoice" onPress={doConvert} loading={converting} />
          )}
          {quote.status === 'converted' && quote.converted_invoice_id ? (
            <Button
              title="View Invoice"
              variant="secondary"
              onPress={() => router.push(`/invoice/${quote.converted_invoice_id}`)}
            />
          ) : null}
          <Button title="Share / Send PDF" variant="secondary" onPress={sharePdf} loading={sharing} />
          {(quote.status === 'draft' || quote.status === 'sent') && (
            <Button
              title="Edit Quote"
              variant="secondary"
              onPress={() => router.push(`/quote/new?edit=${quote.id}`)}
            />
          )}
          <Button title="Delete" variant="danger" onPress={confirmDelete} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  headerMain: { flex: 1, paddingRight: spacing.sm },
  meta: { color: theme.muted, fontSize: 14, marginTop: 2 },
  projTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 6 },
  badge: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  secLabel: { color: theme.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  secBody: { color: theme.text, fontSize: 15, lineHeight: 22 },
  hint: { color: theme.muted, fontSize: 13, marginBottom: spacing.sm, lineHeight: 18 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  itemMain: { flex: 1, paddingRight: spacing.sm },
  itemDesc: { color: theme.text, fontSize: 16, fontWeight: '600' },
  itemSub: { color: theme.muted, fontSize: 13, marginTop: 2 },
  itemAmount: { color: theme.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: spacing.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { color: theme.muted, fontSize: 15 },
  totalValue: { color: theme.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  grandRow: { borderTopWidth: 1, borderTopColor: theme.border, marginTop: 6, paddingTop: 10 },
  grandLabel: { color: theme.text, fontSize: 18, fontWeight: '800' },
  grandValue: { color: theme.accent, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  signedCard: { borderColor: theme.accent },
  sigName: { color: theme.text, fontSize: 22, fontStyle: 'italic', marginVertical: 4 },
  actions: { marginTop: spacing.md, gap: spacing.sm },
});
