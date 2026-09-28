# GoonBill Cloud Setup — Supabase + Stripe

GoonBill ships with a shared cloud backend built in. Users just create an
account in the app (Settings → ☁️ Cloud sync) — no Supabase site visits, no
keys, no SQL. This guide is for the app owner (Wyatt): the one-time backend
setup.

## 1. Cloud sync backend (Supabase) — done once

The app is baked to use Wyatt's Supabase project (`idsgqbommqyrvrnxedec`).
One-time setup, already done 2026-09-28:

1. Project created at [supabase.com](https://supabase.com).
2. `supabase/schema.sql` run in the SQL editor (tables, RLS, `job-photos` bucket).
3. **Authentication → Sign In/Up → "Confirm email" OFF** — the app has no web
   redirect, so email confirmation links go nowhere on a phone. Keep it off.

Users' data is separated by Row-Level Security (each account sees only its own
rows). The anon key in the app is public by design.

## 2. Card payments (Stripe)

1. [stripe.com](https://stripe.com) → create account → **Developers → API keys**.
   Copy the **publishable key** (`pk_test_…` to try, `pk_live_…` for real money).
2. In GoonBill: **Settings → 💳 Online payments** → paste it → **Save Settings**.
3. Install the Supabase CLI once (`npm i -g supabase`), then from this repo:
   ```
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase functions deploy create-payment-intent
   supabase functions deploy stripe-webhook
   supabase secrets set STRIPE_SECRET_KEY=sk_live_… \
     STRIPE_WEBHOOK_SECRET=whsec_… \
     SUPABASE_URL=https://<ref>.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=<service_role key>
   ```
   (Service role key: Supabase → Project Settings → API.)
4. In Stripe: **Developers → Webhooks → Add endpoint** →
   `https://<ref>.supabase.co/functions/v1/stripe-webhook` → listen for
   `payment_intent.succeeded` → copy the **signing secret** (`whsec_…`) into the
   secrets command above.

How it works: on an invoice tap **💰 Collect payment → 💳 Card**. The app syncs
the invoice, asks your edge function for a payment intent, and shows Stripe's
card sheet. On success the payment is recorded in the app; the webhook also
marks it paid in the cloud as a backup. Stripe's fee is ~2.9% + 30¢ per charge.

## 3. PayPal

1. Go to [paypal.me](https://www.paypal.com/paypalme) while logged into PayPal
   and claim your link (e.g. `paypal.me/YourName`).
2. In GoonBill: **Settings → 💰 More ways to get paid → PayPal.Me username** →
   enter just the username → **Save Settings**.

On an invoice, **💰 Collect payment → 🅿️ PayPal** opens your PayPal.Me link with
the invoice amount pre-filled. Mark the invoice paid manually when it arrives.

## 4. Interac e-Transfer (Canada)

1. In GoonBill: **Settings → 💰 More ways to get paid → Interac e-Transfer email**
   → enter the email registered for autodeposit → **Save Settings**.

On an invoice, **💰 Collect payment → 🏦 Interac e-Transfer** shows the amount +
your email; one tap texts it to the client. Mark paid manually on arrival.

## 5. Crypto (Bitcoin / Ethereum)

1. In GoonBill: **Settings → 💰 More ways to get paid** → paste your **BTC**
   and/or **ETH** receive addresses → **Save Settings**.

On an invoice, **💰 Collect payment → ₿ Crypto** shows a QR code per currency
that the client scans from their wallet app. Mark paid manually on arrival.

## 6. Automatic reminders

**Settings → 🔔 Payment reminders** — on by default. GoonBill schedules phone
notifications for each unpaid invoice on the days you list (default: due date,
+3, +7, +14 days). Also, every invoice screen has **📩 Text client a payment
reminder** to SMS a polite nudge with the amount and due date.
