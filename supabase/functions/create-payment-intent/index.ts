// Supabase Edge Function: create-payment-intent
// Creates a Stripe PaymentIntent for a GoonBill invoice.
// Deploy: supabase functions deploy create-payment-intent
// Secrets: STRIPE_SECRET_KEY  (stripe.com → Developers → API keys)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@16.12.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is not set on this function.');

    // Verify the caller's Supabase JWT so only the invoice owner can charge it.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401, headers: cors });
    }

    const { amount_cents, invoice_uuid, invoice_number, currency = 'cad' } = await req.json();
    if (!amount_cents || amount_cents < 50 || !invoice_uuid) {
      return new Response(JSON.stringify({ error: 'amount_cents (>= 50) and invoice_uuid are required.' }), {
        status: 400, headers: cors,
      });
    }

    // Confirm the invoice belongs to this user and is still unpaid.
    const { data: invoice } = await supabase
      .from('invoices')
      .select('uuid,total_cents,status')
      .eq('uuid', invoice_uuid)
      .eq('user_id', user.id)
      .single();
    if (!invoice) {
      return new Response(JSON.stringify({ error: 'Invoice not found.' }), { status: 404, headers: cors });
    }
    if (invoice.status === 'paid') {
      return new Response(JSON.stringify({ error: 'Invoice is already paid.' }), { status: 400, headers: cors });
    }
    const amount = Math.min(amount_cents, invoice.total_cents);

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      metadata: { invoice_uuid, invoice_number: invoice_number ?? '', user_id: user.id },
    });

    return new Response(JSON.stringify({ clientSecret: intent.client_secret }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500, headers: cors,
    });
  }
});
