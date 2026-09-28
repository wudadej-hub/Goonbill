# GoonBill — Voice-to-Invoice for Canadian Trades Contractors

GoonBill turns spoken job details into professional invoices. Dictate on the job site,
review the extracted invoice, and share a PDF with GST + PST calculated automatically.

**MVP scope (this repo):** offline-first Expo + TypeScript app. No backend, no auth, no payments yet.

## Setup

Prerequisites: Node 18+ and the Expo Go app on your phone (or an Android emulator / iOS simulator).

```bash
cd goonbill
npm install
npx expo start
```

Then scan the QR code with Expo Go (Android) or your camera (iOS). The app boots to the Invoices tab.

Type check:

```bash
npx tsc --noEmit
```

## Where the OpenAI API key goes

Voice dictation is bring-your-own-key:

1. Get a key at https://platform.openai.com/api-keys (needs billing enabled on your OpenAI account).
2. Open **Settings** in the app → paste it under **Voice dictation** → Save.
3. The key is stored with `expo-secure-store` (encrypted, on-device only). It is only ever sent to `api.openai.com` for Whisper transcription and GPT-4o-mini extraction.

Without a key, voice is disabled but you can still create invoices by typing.

## How the voice flow works

1. **+ New tab → big mic button** — say the job: *"Furnace filter change for John Smith, 85 dollars, plus two hours labour at 90 an hour."*
2. The recording goes to Whisper (`lib/openai.ts` → `transcribeAudio`), then GPT-4o-mini extracts structured JSON: client name, line items (description / quantity / rate), and notes (`extractInvoice`).
3. The form pre-fills for review — client is matched to your address book or created new, items/taxes/notes are all editable.
4. **Save Invoice** → it appears in the list as unpaid with GST 5% + PST 6% applied.

## Key files

| Path | What it does |
|---|---|
| `app/(tabs)/index.tsx` | Invoices list with All / Unpaid / Overdue / Paid filters |
| `app/(tabs)/new.tsx` | Voice-first invoice creation + editable review form |
| `app/invoice/[id].tsx` | Invoice detail, mark paid/unpaid, PDF share, delete |
| `app/(tabs)/clients.tsx` | Client address book (add / edit / delete) |
| `app/(tabs)/settings.tsx` | Business profile, tax rates, API key, defaults |
| `lib/db.ts` | expo-sqlite schema + all queries (clients, invoices, line items, settings) |
| `lib/openai.ts` | Whisper transcription + GPT-4o-mini extraction pipeline |
| `lib/pdf.ts` | Professional invoice HTML template for `expo-print` |
| `lib/secrets.ts` | SecureStore wrapper for the OpenAI key |
| `lib/format.ts` | Money (integer cents), date helpers |
| `lib/taxes.ts` *(folded into db.ts)* | GST/PST rates live in settings; per-invoice rates stored on each invoice |
| `components/ui.tsx` | Shared buttons, fields, cards, status badges |

### Data model (SQLite, `goonbill.db`)

- `clients(id, name, phone, email, address, created_at)`
- `invoices(id, number UNIQUE like INV-0001, client_id, status, subtotal_cents, gst_rate, pst_rate, gst_cents, pst_cents, total_cents, notes, due_date, created_at)`
- `line_items(id, invoice_id, description, quantity, rate_cents)`
- `settings(key, value)` — business profile, `gst_rate`, `pst_rate`, `invoice_counter`, `default_due_days`

Money is stored as integer cents. An unpaid invoice past its due date displays as **Overdue** (computed, not stored).

## Stubbed for later (TODO)

These are intentionally **not** implemented in the MVP. Search the codebase for `TODO:` markers.

- **Supabase sync** — cloud backup and multi-device sync of invoices/clients. Likely shape: a `lib/sync.ts` module pushing SQLite rows to Supabase tables with the same schema, plus auth via Supabase Auth.
- **Stripe payments** — "Pay now" link on the PDF / share sheet via Stripe Payment Links or Checkout, webhook marking invoices paid.
- **Automated reminders** — scheduled job (or Supabase Edge Function) that texts/emails clients with overdue invoices.

## Notes

- Recording uses `expo-audio` (the maintained audio API in current Expo SDKs; `expo-av` is deprecated).
- PDF sharing uses the native share sheet on device; on web it falls back to showing the file path.
- Invoice numbers auto-increment from `INV-0001` via the `invoice_counter` setting.
