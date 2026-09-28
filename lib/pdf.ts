import { InvoiceWithItems, QuoteWithItems, getSetting } from './db';
import { formatCents, formatDate } from './format';

function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a clean, professional invoice as printable HTML for expo-print. */
export function invoiceHtml(inv: InvoiceWithItems): string {
  const businessName = esc(getSetting('business_name', 'Your Business'));
  const businessAddress = esc(getSetting('business_address', ''));
  const businessPhone = esc(getSetting('business_phone', ''));
  const businessEmail = esc(getSetting('business_email', ''));
  const client = inv.client;

  const rows = inv.items
    .map(
      (item) => `
      <tr>
        <td>${esc(item.description)}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${formatCents(item.rate_cents)}</td>
        <td class="num">${formatCents(Math.round(item.quantity * item.rate_cents))}</td>
      </tr>`
    )
    .join('');

  const gstPct = (inv.gst_rate * 100).toFixed(inv.gst_rate * 100 % 1 === 0 ? 0 : 2);
  const pstPct = (inv.pst_rate * 100).toFixed(inv.pst_rate * 100 % 1 === 0 ? 0 : 2);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 40px; max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .biz h1 { font-size: 26px; margin: 0 0 6px 0; }
  .biz p { margin: 2px 0; color: #555; font-size: 13px; }
  .inv-meta { text-align: right; }
  .inv-meta h2 { font-size: 32px; margin: 0; color: #111; letter-spacing: 1px; }
  .inv-meta p { margin: 3px 0; font-size: 13px; color: #555; }
  .billto { margin-bottom: 28px; }
  .billto h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 6px 0; }
  .billto p { margin: 2px 0; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; padding: 10px 8px; border-bottom: 2px solid #111; }
  td { padding: 12px 8px; border-bottom: 1px solid #e5e5e5; font-size: 14px; }
  .num { text-align: right; white-space: nowrap; }
  .totals { width: 280px; margin-left: auto; }
  .totals .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }
  .totals .grand { border-top: 2px solid #111; margin-top: 6px; padding-top: 10px; font-size: 18px; font-weight: bold; }
  .notes { margin-top: 28px; font-size: 13px; color: #555; }
  .notes h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 6px 0; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
  <div class="header">
    <div class="biz">
      <h1>${businessName}</h1>
      ${businessAddress ? `<p>${businessAddress}</p>` : ''}
      ${businessPhone ? `<p>${esc(businessPhone)}</p>` : ''}
      ${businessEmail ? `<p>${esc(businessEmail)}</p>` : ''}
    </div>
    <div class="inv-meta">
      <h2>INVOICE</h2>
      <p><strong>${esc(inv.number)}</strong></p>
      <p>Issued ${formatDate(inv.created_at)}</p>
      ${inv.due_date ? `<p>Due ${formatDate(inv.due_date)}</p>` : ''}
    </div>
  </div>

  <div class="billto">
    <h3>Bill To</h3>
    <p><strong>${esc(client?.name ?? inv.client_name)}</strong></p>
    ${client?.address ? `<p>${esc(client.address)}</p>` : ''}
    ${client?.phone ? `<p>${esc(client.phone)}</p>` : ''}
    ${client?.email ? `<p>${esc(client.email)}</p>` : ''}
  </div>

  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${formatCents(inv.subtotal_cents)}</span></div>
    <div class="row"><span>GST (${gstPct}%)</span><span>${formatCents(inv.gst_cents)}</span></div>
    <div class="row"><span>PST (${pstPct}%)</span><span>${formatCents(inv.pst_cents)}</span></div>
    <div class="row grand"><span>Total</span><span>${formatCents(inv.total_cents)}</span></div>
  </div>

  ${inv.notes ? `<div class="notes"><h3>Notes</h3><p>${esc(inv.notes)}</p></div>` : ''}

  ${inv.payment_terms ? `<div class="notes"><h3>Payment Terms</h3><p>${esc(inv.payment_terms)}</p></div>` : ''}
  ${getSetting('payment_methods') ? `<div class="notes"><h3>Accepted Payment Methods</h3><p>${esc(getSetting('payment_methods'))}</p></div>` : ''}

  <div class="footer">Thank you for your business.</div>
</body></html>`;
}

/** Render a quote / work agreement as printable HTML for expo-print. */
export function quoteHtml(q: QuoteWithItems): string {
  const businessName = esc(getSetting('business_name', 'Your Business'));
  const businessAddress = esc(getSetting('business_address', ''));
  const businessPhone = esc(getSetting('business_phone', ''));
  const businessEmail = esc(getSetting('business_email', ''));
  const client = q.client;

  const rows = q.items
    .map(
      (item) => `
      <tr>
        <td>${esc(item.description)}</td>
        <td class="num">${item.quantity}</td>
        <td class="num">${formatCents(item.rate_cents)}</td>
        <td class="num">${formatCents(Math.round(item.quantity * item.rate_cents))}</td>
      </tr>`
    )
    .join('');

  const gstPct = (q.gst_rate * 100).toFixed(q.gst_rate * 100 % 1 === 0 ? 0 : 2);
  const pstPct = (q.pst_rate * 100).toFixed(q.pst_rate * 100 % 1 === 0 ? 0 : 2);
  const signed = q.client_signature && q.signed_at;

  const section = (title: string, body: string) =>
    body ? `<div class="notes"><h3>${title}</h3><p>${esc(body).replace(/\n/g, '<br>')}</p></div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; padding: 40px; max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .biz h1 { font-size: 26px; margin: 0 0 6px 0; }
  .biz p { margin: 2px 0; color: #555; font-size: 13px; }
  .inv-meta { text-align: right; }
  .inv-meta h2 { font-size: 32px; margin: 0; color: #111; letter-spacing: 1px; }
  .inv-meta p { margin: 3px 0; font-size: 13px; color: #555; }
  .billto { margin-bottom: 28px; }
  .billto h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 6px 0; }
  .billto p { margin: 2px 0; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; padding: 10px 8px; border-bottom: 2px solid #111; }
  td { padding: 12px 8px; border-bottom: 1px solid #e5e5e5; font-size: 14px; }
  .num { text-align: right; white-space: nowrap; }
  .totals { width: 280px; margin-left: auto; }
  .totals .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }
  .totals .grand { border-top: 2px solid #111; margin-top: 6px; padding-top: 10px; font-size: 18px; font-weight: bold; }
  .notes { margin-top: 24px; font-size: 13px; color: #333; }
  .notes h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 0 0 6px 0; }
  .notes p { line-height: 1.6; margin: 0; }
  .signbox { margin-top: 36px; border: 1px solid #ccc; border-radius: 8px; padding: 20px; }
  .signbox .sig { font-size: 22px; font-family: cursive; margin: 8px 0 2px 0; }
  .signline { margin-top: 28px; border-top: 1px solid #111; padding-top: 6px; font-size: 12px; color: #888; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #999; text-align: center; }
</style></head>
<body>
  <div class="header">
    <div class="biz">
      <h1>${businessName}</h1>
      ${businessAddress ? `<p>${businessAddress}</p>` : ''}
      ${businessPhone ? `<p>${esc(businessPhone)}</p>` : ''}
      ${businessEmail ? `<p>${esc(businessEmail)}</p>` : ''}
    </div>
    <div class="inv-meta">
      <h2>QUOTE</h2>
      <p><strong>${esc(q.number)}</strong></p>
      <p>Issued ${formatDate(q.created_at)}</p>
      ${q.valid_until ? `<p>Valid until ${formatDate(q.valid_until)}</p>` : ''}
    </div>
  </div>

  <div class="billto">
    <h3>Prepared For</h3>
    <p><strong>${esc(client?.name ?? q.client_name)}</strong></p>
    ${client?.address ? `<p>${esc(client.address)}</p>` : ''}
    ${client?.phone ? `<p>${esc(client.phone)}</p>` : ''}
    ${client?.email ? `<p>${esc(client.email)}</p>` : ''}
  </div>

  ${q.title ? `<div class="billto"><h3>Project</h3><p><strong>${esc(q.title)}</strong></p></div>` : ''}
  ${section('Scope of Work', q.scope)}
  ${section('Materials', q.materials)}
  ${section('Timeline', q.timeline)}

  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${formatCents(q.subtotal_cents)}</span></div>
    <div class="row"><span>GST (${gstPct}%)</span><span>${formatCents(q.gst_cents)}</span></div>
    <div class="row"><span>PST (${pstPct}%)</span><span>${formatCents(q.pst_cents)}</span></div>
    <div class="row grand"><span>Estimated Total</span><span>${formatCents(q.total_cents)}</span></div>
  </div>

  ${section('Payment Schedule', q.payment_schedule)}
  ${section('Late Fees', q.late_fees)}
  ${section('Changes to Scope', q.scope_change_policy)}

  <div class="signbox">
    <h3 style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px 0;">Client Acceptance</h3>
    ${
      signed
        ? `<p class="sig">${esc(q.client_signature)}</p><p style="font-size:13px;color:#555;">Signed ${formatDate(q.signed_at)}</p>`
        : `<p style="font-size:13px;color:#555;">By signing, the client accepts this quote including the payment schedule, late fees, and scope-change terms above.</p>
           <div class="signline">Client signature &amp; date</div>`
    }
  </div>

  <div class="footer">This quote is an estimate. Final invoice reflects completed work and approved change orders.</div>
</body></html>`;
}
