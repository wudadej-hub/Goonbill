// Supabase Edge Function: stripe-webhook
// Receives Stripe events and marks the matching invoice paid in Supabase,
// so the app picks it up on the next sync even if the phone was offline.
// Deploy: supabase functions deploy stripe-webhook
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// In Stripe dashboard → Developers → Webhooks, point at:
//   https://<project-ref>.supabase.co/functions/v1/stripe-webhook

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    return new Response('Missing Stripe secrets', { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('No signature', { status: 400 });

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (e) {
    return new Response(`Webhook error: ${e instanceof Error ? e.message : e}`, { status: 400 });
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const invoiceUuid = intent.metadata?.invoice_uuid;
    const userId = intent.metadata?.user_id;
    if (invoiceUuid && userId) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const now = Date.now();
      // Record the payment
      await admin.from('payments').upsert(
        {
          uuid: `stripe-${intent.id}`,
          user_id: userId,
          invoice_uuid: invoiceUuid,
          amount_cents: intent.amount_received,
          method: 'stripe',
          reference: intent.id,
          paid_at: new Date().toISOString().slice(0, 10),
          updated_at: now,
          deleted: false,
        },
        { onConflict: 'uuid' }
      );
      // Mark the invoice paid
      await admin
        .from('invoices')
        .update({ status: 'paid', updated_at: now })
        .eq('uuid', invoiceUuid)
        .eq('user_id', userId);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
