import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme, spacing } from '../lib/theme';
import { Button, Card, Screen, Title } from '../components/ui';
import { router } from 'expo-router';

const STEPS = [
  {
    icon: '🎤',
    title: 'Dictate an invoice',
    body: 'Tap + New, then hit the microphone and describe the job out loud — the work done, hours, and materials. GoonBill turns your words into invoice line items. GST (5%) and PST (6%) are added automatically.',
  },
  {
    icon: '🧾',
    title: 'Review and send',
    body: 'Check the totals on the invoice screen, then share it as a professional PDF straight to your client. Filter invoices by paid, unpaid, or overdue so nothing slips through.',
  },
  {
    icon: '📝',
    title: 'Write quotes that protect you',
    body: 'Open the Quotes tab and create a quote with scope, materials, timeline, payment schedule, and late fees. Your client signs with a typed name, and you convert the approved quote to an invoice with one tap.',
  },
  {
    icon: '📸',
    title: 'Document every job',
    body: 'On any invoice, open Job Docs to log hours (added straight to the invoice), snap receipt photos for materials, record change orders with client approval, and keep a before-and-after photo grid.',
  },
  {
    icon: '💰',
    title: 'Get paid faster',
    body: 'Use Collect payment on an invoice: PayPal with a pre-filled link, Interac e-Transfer details by one-tap SMS, or crypto QR codes. Mark the invoice paid when the money lands.',
  },
  {
    icon: '⚙️',
    title: 'Set up once in Settings',
    body: 'Add your business profile (it prints on every PDF), pick your voice dictation provider, turn on cloud sync to back up your data, and connect your online payment methods.',
  },
  {
    icon: '💳',
    title: 'Your subscription',
    body: 'GoonBill is free for 28 days, then $28 CAD/month or $280 CAD/year. Manage or cancel anytime — your invoices and data stay yours.',
  },
];

export default function HowToScreen() {
  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Title>How to use GoonBill</Title>
        <Text style={styles.intro}>
          Seven steps from voice to paid. Everything below works from your phone — no desk required.
        </Text>
        {STEPS.map((s, i) => (
          <Card key={s.title} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.icon}>{s.icon}</Text>
              <View style={styles.textWrap}>
                <Text style={styles.stepTitle}>
                  {i + 1}. {s.title}
                </Text>
                <Text style={styles.body}>{s.body}</Text>
              </View>
            </View>
          </Card>
        ))}
        <Button title="Start invoicing" onPress={() => router.replace('/(tabs)/new')} />
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  intro: { color: theme.muted, fontSize: 15, marginBottom: spacing.md, lineHeight: 22 },
  card: { marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  icon: { fontSize: 28, marginRight: spacing.sm, marginTop: 2 },
  textWrap: { flex: 1 },
  stepTitle: { color: theme.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  body: { color: theme.muted, fontSize: 14, lineHeight: 21 },
});
