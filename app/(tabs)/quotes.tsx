import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Quote, QuoteStatus, listQuotes } from '../../lib/db';
import { formatCents, formatDate } from '../../lib/format';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Screen, Title } from '../../components/ui';

const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: theme.muted,
  sent: theme.warning,
  approved: theme.accent,
  declined: theme.danger,
  converted: theme.text,
};

function QuoteBadge({ status }: { status: QuoteStatus }) {
  const color = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

export default function QuotesScreen() {
  const [quotes, setQuotes] = useState<Quote[]>([]);

  const load = useCallback(() => setQuotes(listQuotes()), []);
  useFocusEffect(load);

  return (
    <Screen style={{ padding: 0 }}>
      <View style={styles.header}>
        <Title>Quotes</Title>
        <Button title="+ New Quote" onPress={() => router.push('/quote/new')} style={styles.newBtn} />
      </View>
      <FlatList
        data={quotes}
        keyExtractor={(q) => String(q.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState message="No quotes yet. Write one up before the job starts — scope, price, and terms, all agreed upfront." />
        }
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => router.push(`/quote/${item.id}`)} activeOpacity={0.7}>
            <Card>
              <View style={styles.row}>
                <View style={styles.main}>
                  <Text style={styles.number}>{item.number}</Text>
                  <Text style={styles.client}>{item.client_name}</Text>
                  {item.title ? <Text style={styles.title}>{item.title}</Text> : null}
                  <Text style={styles.meta}>
                    {formatCents(item.total_cents)} · {formatDate(item.created_at)}
                  </Text>
                </View>
                <QuoteBadge status={item.status} />
              </View>
            </Card>
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    paddingBottom: 0,
  },
  newBtn: { minHeight: 48, paddingHorizontal: spacing.md },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  main: { flex: 1, paddingRight: spacing.sm },
  number: { color: theme.text, fontSize: 17, fontWeight: '800' },
  client: { color: theme.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  title: { color: theme.muted, fontSize: 14, marginTop: 2 },
  meta: { color: theme.muted, fontSize: 13, marginTop: 4 },
  badge: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
