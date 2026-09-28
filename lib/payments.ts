import { getSupabase } from './supabase';
import { getSetting, getUuid } from './db';

export function stripeConfigured(): boolean {
  return getSetting('stripe_publishable_key').trim().length > 0;
}

// ---------- PayPal (PayPal.Me link with amount) ----------

export function paypalConfigured(): boolean {
  return getSetting('paypal_me').trim().length > 0;
}

/** https://www.paypal.com/paypalme/<user>/<amount> — amount in dollars, 2dp. */
export function paypalLink(amountCents: number): string | null {
  const user = getSetting('paypal_me').trim().replace(/^@/, '').replace(/\/$/, '');
  if (!user) return null;
  const amount = (Math.round(amountCents) / 100).toFixed(2);
  return `https://www.paypal.com/paypalme/${encodeURIComponent(user)}/${amount}`;
}

// ---------- Interac e-Transfer (Canada) ----------

export function interacConfigured(): boolean {
  return getSetting('interac_email').trim().length > 0;
}

export function interacInstructions(amountCents: number, invoiceNumber: string): string {
  const email = getSetting('interac_email').trim();
  const business = getSetting('business_name').trim();
  const dollars = (Math.round(amountCents) / 100).toFixed(2);
  return (
    `Please send $${dollars} by Interac e-Transfer to ${email}\n` +
    `Reference: invoice ${invoiceNumber}${business ? ` (${business})` : ''}`
  );
}

// ---------- Crypto (pay-to-address with QR) ----------

export interface CryptoWallet {
  id: 'btc' | 'eth';
  label: string;
  address: string;
}

export function cryptoWallets(): CryptoWallet[] {
  const out: CryptoWallet[] = [];
  const btc = getSetting('crypto_btc').trim();
  const eth = getSetting('crypto_eth').trim();
  if (btc) out.push({ id: 'btc', label: 'Bitcoin (BTC)', address: btc });
  if (eth) out.push({ id: 'eth', label: 'Ethereum (ETH)', address: eth });
  return out;
}

export function cryptoConfigured(): boolean {
  return cryptoWallets().length > 0;
}

// ---------- Stripe (card, via edge function) ----------

/**
 * Ask the edge function for a PaymentIntent client secret for this invoice.
 * Requires cloud sync (the function verifies the invoice in Supabase).
 */
export async function createPaymentIntent(
  invoiceLocalId: number,
  amountCents: number,
  invoiceNumber: string
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error('Cloud sync is not set up. Set it up in Settings first.');
  const uuid = getUuid('invoices', invoiceLocalId);
  if (!uuid) throw new Error('This invoice has no cloud id yet — sync first.');
  const { data, error } = await sb.functions.invoke('create-payment-intent', {
    body: { amount_cents: Math.round(amountCents), invoice_uuid: uuid, invoice_number: invoiceNumber, currency: 'cad' },
  });
  if (error) throw new Error(error.message || 'Could not reach the payment server.');
  if (data?.error) throw new Error(data.error);
  if (!data?.clientSecret) throw new Error('Payment server did not return a client secret.');
  return data.clientSecret as string;
}
