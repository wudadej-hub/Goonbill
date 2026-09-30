import { useCallback, useState } from 'react';
import { Alert, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import * as SMS from 'expo-sms';
import { StripeProvider, useStripe } from '@stripe/stripe-react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  InvoiceWithItems,
  deleteInvoice,
  displayStatus,
  getInvoice,
  getSetting,
  listPayments,
  recordPayment,
  setInvoiceStatus,
} from '../../lib/db';
import { formatCents, formatDate } from '../../lib/format';
import { invoiceHtml, loadInvoicePhotos } from '../../lib/pdf';
import { theme, spacing } from '../../lib/theme';
import { Button, Card, EmptyState, Screen, StatusBadge, Title } from '../../components/ui';
import {
  createPaymentIntent,
  stripeConfigured,
  paypalConfigured,
  paypalLink,
  interacConfigured,
  interacInstructions,
  cryptoWallets,
  CryptoWallet,
} from '../../lib/payments';
import { refreshReminders, sendSmsReminder } from '../../lib/reminders';
import { syncNow } from '../../lib/sync';

export default function InvoiceDetailScreen() {
  // Stripe needs its provider above any useStripe() call; the key lives in Settings.
  const [stripeKey, setStripeKey] = useState('');
  useFocusEffect(
    useCallback(() => {
      setStripeKey(getSetting('stripe_publishable_key').trim());
    }, [])
  );
  if (!stripeKey) return <InvoiceDetailInner />;
  return (
    <StripeProvider publishableKey={stripeKey}>
      <InvoiceDetailInner />
    </StripeProvider>
  );
}

function InvoiceDetailInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceWithItems | null>(null);
  const [sharing, setSharing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cryptoOpen, setCryptoOpen] = useState(false);
  const [interacOpen, setInteracOpen] = useState(false);
  const stripe = useStripe();

  const load = useCallback(() => {
    const inv = getInvoice(Number(id));
    setInvoice(inv);
  }, [id]);

  useFocusEffect(load);

  const togglePaid = () => {
    if (!invoice) return;
    const next = invoice.status === 'paid' ? 'unpaid' : 'paid';
    setInvoiceStatus(invoice.id, next);
    refreshReminders();
    load();
  };

  const amountDue = () => {
    if (!invoice) return 0;
    const paid = listPayments(invoice.id).reduce((s, p) => s + p.amount_cents, 0);
    return Math.max(0, invoice.total_cents - paid);
  };

  const payOnline = async () => {
    if (!invoice) return;
    const due = amountDue();
    if (due <= 0) {
      Alert.alert('Nothing due', 'This invoice is already paid in full.');
      return;
    }
    if (!stripeConfigured()) {
      Alert.alert('Stripe not set up', 'Add your Stripe publishable key in Settings → Online payments first.');
      return;
    }
    setPaying(true);
    try {
      // Push the invoice to the cloud first — the payment server verifies it there.
      try {
        await syncNow();
      } catch (e) {
        throw new Error(
          'Could not sync this invoice to the cloud. ' + (e instanceof Error ? e.message : '')
        );
      }
      const clientSecret = await createPaymentIntent(invoice.id, due, invoice.number);
      const { error: initError } = await stripe.initPaymentSheet({
        merchantDisplayName: getSetting('business_name') || 'GoonBill',
        paymentIntentClientSecret: clientSecret,
        defaultBillingDetails: { name: invoice.client_name },
      });
      if (initError) throw new Error(initError.message);
      const { error: payError } = await stripe.presentPaymentSheet();
      if (payError) {
        if (payError.code !== 'Canceled') Alert.alert('Payment failed', payError.message);
        return;
      }
      recordPayment(invoice.id, due, 'stripe', 'in-app');
      refreshReminders();
      load();
      Alert.alert('Payment received', `${formatCents(due)} recorded for ${invoice.number}.`);
    } catch (e) {
      Alert.alert('Payment error', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPaying(false);
    }
  };

  const textReminder = async () => {
    if (!invoice) return;
    const res = await sendSmsReminder(invoice);
    if (res === 'unavailable') {
      Alert.alert('SMS not available', 'This device cannot send text messages.');
    } else if (res === 'cancelled') {
      Alert.alert('Cancelled', 'Reminder text was not sent.');
    }
  };

  /** Offer every payment method Wyatt has set up. */
  const collectPayment = () => {
    if (!invoice) return;
    const due = amountDue();
    const options: { text: string; onPress: () => void }[] = [];
    if (stripeConfigured()) options.push({ text: `💳 Card — ${formatCents(due)}`, onPress: payOnline });
    if (paypalConfigured()) options.push({ text: `🅿️ PayPal — ${formatCents(due)}`, onPress: payWithPaypal });
    if (interacConfigured()) options.push({ text: `🏦 Interac e-Transfer — ${formatCents(due)}`, onPress: () => setInteracOpen(true) });
    if (cryptoWallets().length > 0) options.push({ text: `₿ Crypto — ${formatCents(due)}`, onPress: () => setCryptoOpen(true) });
    if (options.length === 0) {
      Alert.alert(
        'No payment methods set up',
        'Add Stripe, PayPal, Interac or crypto in Settings → Online payments first.'
      );
      return;
    }
    Alert.alert('Collect payment', `${invoice.number} · ${formatCents(due)} due`, [
      ...options,
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const payWithPaypal = async () => {
    if (!invoice) return;
    const url = paypalLink(amountDue());
    if (!url) return;
    const ok = await Linking.canOpenURL(url);
    if (!ok) {
      Alert.alert('Cannot open PayPal', 'This device cannot open the PayPal link.');
      return;
    }
    await Linking.openURL(url);
  };

  const copyText = async (label: string, text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${label} copied to clipboard.`);
  };

  const textInteracDetails = async () => {
    if (!invoice) return;
    const available = await SMS.isAvailableAsync();
    if (!available) {
      Alert.alert('SMS not available', 'This device cannot send text messages.');
      return;
    }
    const phone = invoice.client?.phone ?? '';
    const { result } = await SMS.sendSMSAsync(
      phone ? [phone] : [],
      `Hi ${invoice.client_name || 'there'}, you can pay invoice #${invoice.number} by Interac e-Transfer:\n\n${interacInstructions(amountDue(), invoice.number)}`
    );
    if (result === 'sent') setInteracOpen(false);
  };
  const sharePdf = async () => {
    if (!invoice) return;
    setSharing(true);
    try {
      const photos = await loadInvoicePhotos(invoice.id);
      const { uri } = await Print.printToFileAsync({ html: invoiceHtml(invoice, photos) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share ${invoice.number}`,
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

  const confirmDelete = () => {
    if (!invoice) return;
    Alert.alert('Delete invoice?', `${invoice.number} will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteInvoice(invoice.id);
          router.back();
        },
      },
    ]);
  };

  if (!invoice) {
    return (
      <Screen>
        <EmptyState message="Invoice not found." />
      </Screen>
    );
  }

  const gstPct = invoice.gst_rate * 100;
  const pstPct = invoice.pst_rate * 100;

  return (
    <Screen style={{ padding: 0 }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View>
            <Title>{invoice.number}</Title>
            <Text style={styles.meta}>
              {invoice.client_name} · Issued {formatDate(invoice.created_at)}
              {invoice.due_date ? ` · Due ${formatDate(invoice.due_date)}` : ''}
            </Text>
          </View>
          <StatusBadge status={displayStatus(invoice)} />
        </View>

        <Card>
          {invoice.items.map((item) => (
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
            <Text style={styles.totalValue}>{formatCents(invoice.subtotal_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>GST ({gstPct}%)</Text>
            <Text style={styles.totalValue}>{formatCents(invoice.gst_cents)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>PST ({pstPct}%)</Text>
            <Text style={styles.totalValue}>{formatCents(invoice.pst_cents)}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandRow]}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>{formatCents(invoice.total_cents)}</Text>
          </View>
        </Card>

        {invoice.notes ? (
          <Card>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </Card>
        ) : null}

        {invoice.payment_terms ? (
          <Card>
            <Text style={styles.notesLabel}>Payment terms</Text>
            <Text style={styles.notesText}>{invoice.payment_terms}</Text>
          </Card>
        ) : null}

        <PaymentsCard invoiceId={invoice.id} />

        <View style={styles.actions}>
          <Button title="Share / Send PDF" onPress={sharePdf} loading={sharing} />
          {invoice.status !== 'paid' ? (
            <Button title={`💰 Collect payment — ${formatCents(amountDue())}`} onPress={collectPayment} loading={paying} />
          ) : null}
          <Button title="📋 Job docs — hours, materials, changes, photos" variant="secondary" onPress={() => router.push(`/job/${invoice.id}`)} />
          {invoice.status !== 'paid' ? (
            <Button title="📩 Text client a payment reminder" variant="secondary" onPress={textReminder} />
          ) : null}
          <Button
            title={invoice.status === 'paid' ? 'Mark Unpaid' : 'Mark Paid'}
            variant="secondary"
            onPress={togglePaid}
          />
          <Button title="Delete" variant="danger" onPress={confirmDelete} />
        </View>
      </ScrollView>

      {/* Interac e-Transfer details */}
      <Modal visible={interacOpen} animationType="slide" transparent onRequestClose={() => setInteracOpen(false)}>
        <View style={styles.modalWrap}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>🏦 Interac e-Transfer</Text>
            <Text style={styles.modalText}>{interacInstructions(amountDue(), invoice.number)}</Text>
            <Text style={styles.modalHint}>Mark the invoice paid manually when the transfer arrives.</Text>
            <Button title="📩 Text these details to client" onPress={textInteracDetails} />
            <Button
              title="Copy details"
              variant="secondary"
              onPress={() => copyText('E-transfer details', interacInstructions(amountDue(), invoice.number))}
            />
            <Button title="Close" variant="secondary" onPress={() => setInteracOpen(false)} />
          </Card>
        </View>
      </Modal>

      {/* Crypto QR codes */}
      <Modal visible={cryptoOpen} animationType="slide" transparent onRequestClose={() => setCryptoOpen(false)}>
        <View style={styles.modalWrap}>
          <Card style={styles.modalCard}>
            <Text style={styles.modalTitle}>₿ Pay with crypto</Text>
            <Text style={styles.modalText}>
              {invoice.number} · {formatCents(amountDue())} — scan with a wallet app. Send the exact fiat
              amount's worth; mark paid manually once it arrives.
            </Text>
            <ScrollView>
              {cryptoWallets().map((w: CryptoWallet) => (
                <View key={w.id} style={styles.walletRow}>
                  <Text style={styles.walletLabel}>{w.label}</Text>
                  <View style={styles.qrBox}>
                    <QRCode value={w.address} size={180} />
                  </View>
                  <Text style={styles.walletAddr} numberOfLines={2}>
                    {w.address}
                  </Text>
                  <TouchableOpacity onPress={() => copyText(w.label, w.address)} activeOpacity={0.7}>
                    <Text style={styles.copyLink}>Copy address</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <Button title="Close" variant="secondary" onPress={() => setCryptoOpen(false)} />
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

function PaymentsCard({ invoiceId }: { invoiceId: number }) {
  const [payments, setPayments] = useState<ReturnType<typeof listPayments>>([]);
  useFocusEffect(
    useCallback(() => {
      setPayments(listPayments(invoiceId));
    }, [invoiceId])
  );
  if (payments.length === 0) return null;
  return (
    <Card>
      <Text style={styles.notesLabel}>Payments</Text>
      {payments.map((p) => (
        <View key={p.id} style={styles.itemRow}>
          <View style={styles.itemMain}>
            <Text style={styles.itemDesc}>
              {p.method === 'stripe' ? '💳 Card (Stripe)' : 'Manual'}
              {p.reference ? ` · ${p.reference}` : ''}
            </Text>
            <Text style={styles.itemSub}>{formatDate(p.paid_at)}</Text>
          </View>
          <Text style={styles.itemAmount}>{formatCents(p.amount_cents)}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  meta: { color: theme.muted, fontSize: 14, marginTop: 2 },
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
  notesLabel: { color: theme.muted, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  notesText: { color: theme.text, fontSize: 15, lineHeight: 22 },
  actions: { marginTop: spacing.md, gap: spacing.sm },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '85%' },
  modalTitle: { color: theme.text, fontSize: 20, fontWeight: '800', marginBottom: spacing.sm },
  modalText: { color: theme.text, fontSize: 15, lineHeight: 22, marginBottom: spacing.sm },
  modalHint: { color: theme.muted, fontSize: 13, fontStyle: 'italic', marginBottom: spacing.md },
  walletRow: { alignItems: 'center', marginBottom: spacing.lg },
  walletLabel: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm },
  qrBox: { backgroundColor: '#fff', padding: 12, borderRadius: 12, marginBottom: spacing.sm },
  walletAddr: { color: theme.muted, fontSize: 12, textAlign: 'center', marginBottom: 4 },
  copyLink: { color: theme.accent, fontSize: 15, fontWeight: '700', paddingVertical: 6 },
});
