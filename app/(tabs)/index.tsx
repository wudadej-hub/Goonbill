import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { DisplayStatus, Invoice, displayStatus, invoiceCounts, listInvoices } from '../../lib/db';
import { formatCents, formatDate } from '../../lib/format';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Screen, StatusBadge, Title } from '../../components/ui';

const FILTERS: { key: DisplayStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
];

export default function InvoicesScreen() {
  const [filter, setFilter] = useState<DisplayStatus | 'all'>('all');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [counts, setCounts] = useState({ total: 0, unpaid: 0, overdue: 0, paid: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setInvoices(listInvoices(filter));
    setCounts(invoiceCounts());
  }, [filter]);

  useFocusEffect(load);

  const onRefresh = () => {
    setRefreshing(true);
    load();
    setRefreshing(false);
  };

  const outstanding = invoices
    .filter((i) => displayStatus(i) === 'unpaid' || displayStatus(i) === 'overdue')
    .reduce((sum, i) => sum + i.total_cents, 0);

  return (
    <Screen style={{ padding: 0 }}>
      <View style={styles.header}>
        <Title>Invoices</Title>
        {counts.total > 0 && (
          <Text style={styles.summary}>
            {outstanding > 0 ? `${formatCents(outstanding)} outstanding` : 'Nothing outstanding — nice work.'}
            {counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ''}
          </Text>
        )}
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.chip, filter === f.key && styles.chipActive]}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={invoices}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
        ListEmptyComponent={
          <EmptyState message="No invoices yet. Hit + New and dictate your first one — it takes about 30 seconds." />
        }
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.push(`/invoice/${item.id}`)}>
            <Card>
              <View style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.number}>{item.number}</Text>
                  <Text style={styles.client}>{item.client_name}</Text>
                  <Text style={styles.date}>Due {formatDate(item.due_date)}</Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.total}>{formatCents(item.total_cents)}</Text>
                  <StatusBadge status={displayStatus(item)} />
                </View>
              </View>
            </Card>
          </TouchableOpacity>
        )}
      />

      <View style={styles.fabWrap}>
        <Button title="+ New Invoice" onPress={() => router.push('/(tabs)/new')} style={styles.fab} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  summary: { color: theme.muted, fontSize: 15, marginBottom: spacing.sm },
  filters: { flexDirection: 'row', paddingHorizontal: spacing.md, marginBottom: spacing.sm, gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.muted, fontWeight: '600', fontSize: 14 },
  chipTextActive: { color: '#0b0f0d' },
  list: { paddingHorizontal: spacing.md, paddingBottom: 110 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowMain: { flex: 1 },
  number: { color: theme.text, fontSize: 17, fontWeight: '700' },
  client: { color: theme.muted, fontSize: 14, marginTop: 2 },
  date: { color: theme.muted, fontSize: 12, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 8 },
  total: { color: theme.text, fontSize: 18, fontWeight: '800' },
  fabWrap: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg },
  fab: { minHeight: 60, borderRadius: 16 },
});
