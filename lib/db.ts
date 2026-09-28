import * as SQLite from 'expo-sqlite';
import { todayISO } from './format';

// TODO: Supabase sync (post-MVP).
//   Planned shape: a `lib/sync.ts` module that mirrors these tables in Supabase
//   (clients, invoices, line_items), pushes local rows on save, and pulls remote
//   changes on app start. Auth via Supabase Auth; per-user row-level security.
//   The integer-cents money model and settings table map 1:1 — see README.

const db = SQLite.openDatabaseSync('goonbill.db');

/** Shared handle for modules that need raw access (sync engine). */
export function getDb(): SQLite.SQLiteDatabase {
  return db;
}

// ---------- Types ----------

export interface Client {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  created_at: string;
}

export interface LineItem {
  id: number;
  invoice_id: number;
  description: string;
  quantity: number;
  rate_cents: number;
}

export type InvoiceStatus = 'draft' | 'unpaid' | 'paid';
export type DisplayStatus = 'draft' | 'unpaid' | 'paid' | 'overdue';

export interface Invoice {
  id: number;
  number: string;
  client_id: number;
  status: InvoiceStatus;
  subtotal_cents: number;
  gst_rate: number;
  pst_rate: number;
  gst_cents: number;
  pst_cents: number;
  total_cents: number;
  notes: string;
  due_date: string;
  payment_terms: string;
  created_at: string;
  client_name: string;
}

export interface InvoiceWithItems extends Invoice {
  items: LineItem[];
  client: Client | null;
}

/** Editable line item as held in the invoice form (strings for TextInput). */
export interface DraftItem {
  description: string;
  quantity: string;
  rate: string;
}

// ---------- Schema ----------

export function initDb(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      status TEXT NOT NULL DEFAULT 'unpaid',
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      gst_rate REAL NOT NULL DEFAULT 0.05,
      pst_rate REAL NOT NULL DEFAULT 0.06,
      gst_cents INTEGER NOT NULL DEFAULT 0,
      pst_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      rate_cents INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed defaults (only if missing)
  const defaults: Record<string, string> = {
    business_name: '',
    business_address: '',
    business_phone: '',
    business_email: '',
    gst_rate: '0.05',
    pst_rate: '0.06',
    invoice_counter: '0',
    default_due_days: '14',
    supabase_url: '',
    supabase_anon_key: '',
    stripe_publishable_key: '',
    paypal_me: '',
    interac_email: '',
    crypto_btc: '',
    crypto_eth: '',
    reminders_enabled: '1',
    reminder_days: '0,3,7,14',
  };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!existing) {
      db.runSync('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  initJobTables();
  initSyncColumns();
}

// ---------- Settings ----------

export function getSetting(key: string, fallback = ''): string {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string): void {
  db.runSync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

export function getTaxRates(): { gst: number; pst: number } {
  return {
    gst: parseFloat(getSetting('gst_rate', '0.05')) || 0,
    pst: parseFloat(getSetting('pst_rate', '0.06')) || 0,
  };
}

export function nextInvoiceNumber(): string {
  const n = (parseInt(getSetting('invoice_counter', '0'), 10) || 0) + 1;
  setSetting('invoice_counter', String(n));
  return `INV-${String(n).padStart(4, '0')}`;
}

// ---------- Clients ----------

export function listClients(): Client[] {
  return db.getAllSync<Client>('SELECT * FROM clients ORDER BY name COLLATE NOCASE ASC');
}

export function getClient(id: number): Client | null {
  return db.getFirstSync<Client>('SELECT * FROM clients WHERE id = ?', [id]);
}

export function createClient(name: string, phone = '', email = '', address = ''): Client {
  const res = db.runSync(
    'INSERT INTO clients (name, phone, email, address, created_at) VALUES (?, ?, ?, ?, ?)',
    [name.trim(), phone.trim(), email.trim(), address.trim(), todayISO()]
  );
  const client = getClient(Number(res.lastInsertRowId));
  if (!client) throw new Error('Failed to create client');
  return client;
}

export function updateClient(id: number, fields: { name: string; phone: string; email: string; address: string }): void {
  db.runSync('UPDATE clients SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?', [
    fields.name.trim(),
    fields.phone.trim(),
    fields.email.trim(),
    fields.address.trim(),
    id,
  ]);
}

export function deleteClient(id: number): void {
  const inUse = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM invoices WHERE client_id = ?', [id]);
  if (inUse && inUse.c > 0) {
    throw new Error('This client has invoices and cannot be deleted.');
  }
  const uuid = getUuid('clients', id);
  db.runSync('DELETE FROM clients WHERE id = ?', [id]);
  if (uuid) tombstone('clients', uuid);
}

// ---------- Invoices ----------

export interface NewInvoiceInput {
  clientId: number;
  items: { description: string; quantity: number; rate_cents: number }[];
  gstRate: number;
  pstRate: number;
  notes: string;
  dueDate: string; // YYYY-MM-DD
  status?: InvoiceStatus;
}

function computeTotals(items: { quantity: number; rate_cents: number }[], gstRate: number, pstRate: number) {
  const subtotal = items.reduce((sum, i) => sum + Math.round(i.quantity * i.rate_cents), 0);
  const gst = Math.round(subtotal * gstRate);
  const pst = Math.round(subtotal * pstRate);
  return { subtotal, gst, pst, total: subtotal + gst + pst };
}

export function createInvoice(input: NewInvoiceInput): Invoice {
  const number = nextInvoiceNumber();
  const { subtotal, gst, pst, total } = computeTotals(input.items, input.gstRate, input.pstRate);
  const res = db.runSync(
    `INSERT INTO invoices
      (number, client_id, status, subtotal_cents, gst_rate, pst_rate, gst_cents, pst_cents, total_cents, notes, due_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      number,
      input.clientId,
      input.status ?? 'unpaid',
      subtotal,
      input.gstRate,
      input.pstRate,
      gst,
      pst,
      total,
      input.notes.trim(),
      input.dueDate,
      todayISO(),
    ]
  );
  const invoiceId = Number(res.lastInsertRowId);
  for (const item of input.items) {
    db.runSync('INSERT INTO line_items (invoice_id, description, quantity, rate_cents) VALUES (?, ?, ?, ?)', [
      invoiceId,
      item.description.trim(),
      item.quantity,
      item.rate_cents,
    ]);
  }
  const inv = getInvoice(invoiceId);
  if (!inv) throw new Error('Failed to create invoice');
  return inv;
}

export function listInvoices(statusFilter?: DisplayStatus | 'all'): Invoice[] {
  const rows = db.getAllSync<Invoice>(
    `SELECT i.*, c.name AS client_name
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ORDER BY i.id DESC`
  );
  if (!statusFilter || statusFilter === 'all') return rows;
  return rows.filter((inv) => displayStatus(inv) === statusFilter);
}

export function getInvoice(id: number): InvoiceWithItems | null {
  const inv = db.getFirstSync<Invoice>(
    `SELECT i.*, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`,
    [id]
  );
  if (!inv) return null;
  const items = db.getAllSync<LineItem>('SELECT * FROM line_items WHERE invoice_id = ? ORDER BY id ASC', [id]);
  const client = getClient(inv.client_id);
  return { ...inv, items, client };
}

export function setInvoiceStatus(id: number, status: InvoiceStatus): void {
  db.runSync('UPDATE invoices SET status = ? WHERE id = ?', [status, id]);
}

// ---------- Payments ----------

export interface Payment {
  id: number;
  invoice_id: number;
  amount_cents: number;
  method: string;
  reference: string;
  paid_at: string;
}

/** Record a payment and mark the invoice paid when it covers the total. */
export function recordPayment(invoiceId: number, amountCents: number, method: string, reference = ''): Payment {
  db.runSync('INSERT INTO payments (invoice_id, amount_cents, method, reference, paid_at) VALUES (?, ?, ?, ?, ?)', [
    invoiceId,
    amountCents,
    method,
    reference,
    todayISO(),
  ]);
  const id = Number(db.getFirstSync<{ id: number }>('SELECT last_insert_rowid() AS id')!.id);
  const inv = getInvoice(invoiceId);
  if (inv) {
    const paid = db.getFirstSync<{ s: number }>('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE invoice_id = ?', [
      invoiceId,
    ])!.s;
    if (paid >= inv.total_cents && inv.status !== 'paid') {
      setInvoiceStatus(invoiceId, 'paid');
    }
  }
  const row = db.getFirstSync<Payment>('SELECT * FROM payments WHERE id = ?', [id]);
  if (!row) throw new Error('Failed to record payment');
  return row;
}

export function listPayments(invoiceId: number): Payment[] {
  return db.getAllSync<Payment>('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id ASC', [invoiceId]);
}

export function deleteInvoice(id: number): void {
  const uuid = getUuid('invoices', id);
  const kids = db.getAllSync<{ t: string; uuid: string }>(`
    SELECT 'line_items' AS t, uuid FROM line_items WHERE invoice_id = ?
    UNION ALL SELECT 'payments', uuid FROM payments WHERE invoice_id = ?
    UNION ALL SELECT 'change_orders', uuid FROM change_orders WHERE invoice_id = ?
    UNION ALL SELECT 'time_entries', uuid FROM time_entries WHERE invoice_id = ?
    UNION ALL SELECT 'material_entries', uuid FROM material_entries WHERE invoice_id = ?
    UNION ALL SELECT 'job_photos', uuid FROM job_photos WHERE invoice_id = ?`, [id, id, id, id, id, id]);
  for (const k of kids) if (k.uuid) tombstone(k.t, k.uuid);
  db.runSync('DELETE FROM line_items WHERE invoice_id = ?', [id]);
  db.runSync('DELETE FROM payments WHERE invoice_id = ?', [id]);
  db.runSync('DELETE FROM change_orders WHERE invoice_id = ?', [id]);
  db.runSync('DELETE FROM time_entries WHERE invoice_id = ?', [id]);
  db.runSync('DELETE FROM material_entries WHERE invoice_id = ?', [id]);
  db.runSync('DELETE FROM job_photos WHERE invoice_id = ?', [id]);
  db.runSync('DELETE FROM invoices WHERE id = ?', [id]);
  if (uuid) tombstone('invoices', uuid);
}

export function invoiceCounts(): { total: number; unpaid: number; overdue: number; paid: number } {
  const rows = db.getAllSync<Invoice>('SELECT * FROM invoices');
  let unpaid = 0,
    overdue = 0,
    paid = 0;
  for (const inv of rows) {
    const s = displayStatus(inv);
    if (s === 'paid') paid++;
    else if (s === 'overdue') overdue++;
    else if (s === 'unpaid') unpaid++;
  }
  return { total: rows.length, unpaid, overdue, paid };
}

/** An unpaid invoice whose due date has passed shows as "overdue". */
export function displayStatus(inv: Invoice): DisplayStatus {
  if (inv.status === 'paid' || inv.status === 'draft') return inv.status;
  if (inv.due_date && inv.due_date < todayISO()) return 'overdue';
  return 'unpaid';
}

// ---------- Quotes & job documentation ----------

export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'converted';

export interface Quote {
  id: number;
  number: string;
  client_id: number;
  status: QuoteStatus;
  title: string;
  scope: string;
  materials: string;
  timeline: string;
  subtotal_cents: number;
  gst_rate: number;
  pst_rate: number;
  gst_cents: number;
  pst_cents: number;
  total_cents: number;
  payment_schedule: string;
  late_fees: string;
  scope_change_policy: string;
  valid_until: string;
  client_signature: string;
  signed_at: string;
  converted_invoice_id: number | null;
  created_at: string;
  client_name: string;
}

export interface QuoteItem {
  id: number;
  quote_id: number;
  description: string;
  quantity: number;
  rate_cents: number;
}

export interface QuoteWithItems extends Quote {
  items: QuoteItem[];
  client: Client | null;
}

export type ChangeOrderStatus = 'pending' | 'approved' | 'declined';

export interface ChangeOrder {
  id: number;
  invoice_id: number;
  description: string;
  amount_cents: number;
  status: ChangeOrderStatus;
  client_approval: string;
  approved_at: string;
  billed: number;
  created_at: string;
}

export interface TimeEntry {
  id: number;
  invoice_id: number;
  work_date: string;
  hours: number;
  description: string;
  rate_cents: number;
  billed: number;
  created_at: string;
}

export interface MaterialEntry {
  id: number;
  invoice_id: number;
  description: string;
  cost_cents: number;
  receipt_uri: string;
  billed: number;
  created_at: string;
}

export interface JobPhoto {
  id: number;
  invoice_id: number;
  uri: string;
  kind: string; // 'before' | 'after'
  caption: string;
  created_at: string;
}

function columnExists(table: string, column: string): boolean {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

/** Stable global id for cloud sync (backfilled for existing rows). */
export function uuidv4(): string {
  const h = () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-${['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)]}${h().slice(1)}-${h()}${h()}${h()}`;
}

/**
 * Sync columns: every syncable table gets a stable `uuid`, an `updated_at`
 * millisecond timestamp (auto-bumped by trigger on every UPDATE), and a
 * `deleted` soft-delete flag. Deletes also write to `tombstones` so the
 * remote row can be removed on the next push.
 */
const SYNC_TABLES = [
  'clients',
  'invoices',
  'line_items',
  'payments',
  'quotes',
  'quote_items',
  'change_orders',
  'time_entries',
  'material_entries',
  'job_photos',
];

function initSyncColumns(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'manual',
      reference TEXT DEFAULT '',
      paid_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tombstones (
      uuid TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      deleted_at INTEGER NOT NULL
    );
  `);
  for (const t of SYNC_TABLES) {
    if (!columnExists(t, 'uuid')) db.execSync(`ALTER TABLE ${t} ADD COLUMN uuid TEXT`);
    if (!columnExists(t, 'updated_at')) db.execSync(`ALTER TABLE ${t} ADD COLUMN updated_at INTEGER DEFAULT 0`);
    if (!columnExists(t, 'deleted')) db.execSync(`ALTER TABLE ${t} ADD COLUMN deleted INTEGER DEFAULT 0`);
    // Photo tables track their cloud storage path so we don't re-upload every sync
    if ((t === 'job_photos' || t === 'material_entries') && !columnExists(t, 'remote_path')) {
      db.execSync(`ALTER TABLE ${t} ADD COLUMN remote_path TEXT DEFAULT ''`);
    }
    // Backfill uuids for rows created before sync existed
    const missing = db.getAllSync<{ id: number }>(`SELECT id FROM ${t} WHERE uuid IS NULL`);
    for (const row of missing) {
      db.runSync(`UPDATE ${t} SET uuid = ? WHERE id = ?`, [uuidv4(), row.id]);
    }
    // Auto-bump updated_at on every write (WHEN guard stops trigger recursion)
    db.execSync(`
      CREATE TRIGGER IF NOT EXISTS trg_${t}_touch AFTER UPDATE ON ${t}
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE ${t} SET updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE id = NEW.id;
      END;
    `);
    // New rows start with a uuid + timestamp
    db.execSync(`
      CREATE TRIGGER IF NOT EXISTS trg_${t}_init AFTER INSERT ON ${t}
      WHEN NEW.uuid IS NULL
      BEGIN
        UPDATE ${t}
        SET uuid = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
              || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2)
              || '-' || lower(hex(randomblob(6))),
            updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        WHERE id = NEW.id;
      END;
    `);
  }
}

/** Record a tombstone so a local hard-delete propagates to the cloud on next sync. */
export function tombstone(table: string, uuid: string): void {
  db.runSync('INSERT OR REPLACE INTO tombstones (uuid, table_name, deleted_at) VALUES (?, ?, ?)', [
    uuid,
    table,
    Date.now(),
  ]);
}

export function getUuid(table: string, id: number): string | null {
  const row = db.getFirstSync<{ uuid: string }>(`SELECT uuid FROM ${table} WHERE id = ?`, [id]);
  return row?.uuid ?? null;
}

function initJobTables(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      status TEXT NOT NULL DEFAULT 'draft',
      title TEXT DEFAULT '',
      scope TEXT DEFAULT '',
      materials TEXT DEFAULT '',
      timeline TEXT DEFAULT '',
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      gst_rate REAL NOT NULL DEFAULT 0.05,
      pst_rate REAL NOT NULL DEFAULT 0.06,
      gst_cents INTEGER NOT NULL DEFAULT 0,
      pst_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      payment_schedule TEXT DEFAULT '',
      late_fees TEXT DEFAULT '',
      scope_change_policy TEXT DEFAULT '',
      valid_until TEXT DEFAULT '',
      client_signature TEXT DEFAULT '',
      signed_at TEXT DEFAULT '',
      converted_invoice_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      rate_cents INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS change_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      client_approval TEXT DEFAULT '',
      approved_at TEXT DEFAULT '',
      billed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      hours REAL NOT NULL,
      description TEXT DEFAULT '',
      rate_cents INTEGER NOT NULL DEFAULT 0,
      billed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS material_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      receipt_uri TEXT DEFAULT '',
      billed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      uri TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'after',
      caption TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  if (!columnExists('invoices', 'payment_terms')) {
    db.execSync(`ALTER TABLE invoices ADD COLUMN payment_terms TEXT DEFAULT ''`);
  }

  // New settings defaults (seed loop only fills missing keys, so upgrades are safe)
  const extraDefaults: Record<string, string> = {
    quote_counter: '0',
    payment_methods: '',
    default_payment_terms: 'Net 15',
    default_payment_schedule: '50% deposit to schedule work, balance due on completion.',
    default_late_fees: 'Overdue balances are subject to 2% interest per month.',
    default_scope_policy:
      'Any work beyond the scope described above requires a written change order approved by the client before the work begins.',
  };
  for (const [key, value] of Object.entries(extraDefaults)) {
    const existing = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!existing) {
      db.runSync('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }
}

// Recompute an invoice's totals from its line items (after adding billed extras).
export function recalcInvoiceTotals(id: number): void {
  const inv = db.getFirstSync<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]);
  if (!inv) return;
  const items = db.getAllSync<LineItem>('SELECT * FROM line_items WHERE invoice_id = ?', [id]);
  const { subtotal, gst, pst, total } = computeTotals(
    items.map((i) => ({ quantity: i.quantity, rate_cents: i.rate_cents })),
    inv.gst_rate,
    inv.pst_rate
  );
  db.runSync(
    'UPDATE invoices SET subtotal_cents = ?, gst_cents = ?, pst_cents = ?, total_cents = ? WHERE id = ?',
    [subtotal, gst, pst, total, id]
  );
}

/** Add a line item to an existing invoice and refresh its totals. */
export function addInvoiceItem(
  invoiceId: number,
  description: string,
  quantity: number,
  rate_cents: number
): void {
  db.runSync('INSERT INTO line_items (invoice_id, description, quantity, rate_cents) VALUES (?, ?, ?, ?)', [
    invoiceId,
    description.trim(),
    quantity,
    rate_cents,
  ]);
  recalcInvoiceTotals(invoiceId);
}

export function setInvoicePaymentTerms(id: number, terms: string): void {
  db.runSync('UPDATE invoices SET payment_terms = ? WHERE id = ?', [terms.trim(), id]);
}

// ----- Quotes -----

export function nextQuoteNumber(): string {
  const n = (parseInt(getSetting('quote_counter', '0'), 10) || 0) + 1;
  setSetting('quote_counter', String(n));
  return `Q-${String(n).padStart(4, '0')}`;
}

export interface NewQuoteInput {
  clientId: number;
  title: string;
  scope: string;
  materials: string;
  timeline: string;
  items: { description: string; quantity: number; rate_cents: number }[];
  gstRate: number;
  pstRate: number;
  paymentSchedule: string;
  lateFees: string;
  scopeChangePolicy: string;
  validUntil: string;
}

export function createQuote(input: NewQuoteInput): Quote {
  const number = nextQuoteNumber();
  const { subtotal, gst, pst, total } = computeTotals(input.items, input.gstRate, input.pstRate);
  const res = db.runSync(
    `INSERT INTO quotes
      (number, client_id, status, title, scope, materials, timeline,
       subtotal_cents, gst_rate, pst_rate, gst_cents, pst_cents, total_cents,
       payment_schedule, late_fees, scope_change_policy, valid_until, created_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      number,
      input.clientId,
      input.title.trim(),
      input.scope.trim(),
      input.materials.trim(),
      input.timeline.trim(),
      subtotal,
      input.gstRate,
      input.pstRate,
      gst,
      pst,
      total,
      input.paymentSchedule.trim(),
      input.lateFees.trim(),
      input.scopeChangePolicy.trim(),
      input.validUntil,
      todayISO(),
    ]
  );
  const quoteId = Number(res.lastInsertRowId);
  for (const item of input.items) {
    db.runSync('INSERT INTO quote_items (quote_id, description, quantity, rate_cents) VALUES (?, ?, ?, ?)', [
      quoteId,
      item.description.trim(),
      item.quantity,
      item.rate_cents,
    ]);
  }
  const q = getQuote(quoteId);
  if (!q) throw new Error('Failed to create quote');
  return q;
}

export function updateQuote(id: number, input: NewQuoteInput): void {
  const { subtotal, gst, pst, total } = computeTotals(input.items, input.gstRate, input.pstRate);
  db.runSync(
    `UPDATE quotes SET title = ?, scope = ?, materials = ?, timeline = ?,
       subtotal_cents = ?, gst_rate = ?, pst_rate = ?, gst_cents = ?, pst_cents = ?, total_cents = ?,
       payment_schedule = ?, late_fees = ?, scope_change_policy = ?, valid_until = ?
     WHERE id = ?`,
    [
      input.title.trim(),
      input.scope.trim(),
      input.materials.trim(),
      input.timeline.trim(),
      subtotal,
      input.gstRate,
      input.pstRate,
      gst,
      pst,
      total,
      input.paymentSchedule.trim(),
      input.lateFees.trim(),
      input.scopeChangePolicy.trim(),
      input.validUntil,
      id,
    ]
  );
  db.runSync('DELETE FROM quote_items WHERE quote_id = ?', [id]);
  for (const item of input.items) {
    db.runSync('INSERT INTO quote_items (quote_id, description, quantity, rate_cents) VALUES (?, ?, ?, ?)', [
      id,
      item.description.trim(),
      item.quantity,
      item.rate_cents,
    ]);
  }
}

export function listQuotes(): Quote[] {
  return db.getAllSync<Quote>(
    `SELECT q.*, c.name AS client_name FROM quotes q JOIN clients c ON c.id = q.client_id ORDER BY q.id DESC`
  );
}

export function getQuote(id: number): QuoteWithItems | null {
  const q = db.getFirstSync<Quote>(
    `SELECT q.*, c.name AS client_name FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.id = ?`,
    [id]
  );
  if (!q) return null;
  const items = db.getAllSync<QuoteItem>('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id ASC', [id]);
  const client = getClient(q.client_id);
  return { ...q, items, client };
}

export function setQuoteStatus(id: number, status: QuoteStatus): void {
  db.runSync('UPDATE quotes SET status = ? WHERE id = ?', [status, id]);
}

export function signQuote(id: number, signatureName: string): void {
  db.runSync('UPDATE quotes SET client_signature = ?, signed_at = ? WHERE id = ?', [
    signatureName.trim(),
    todayISO(),
    id,
  ]);
}

export function deleteQuote(id: number): void {
  const uuid = getUuid('quotes', id);
  const kids = db.getAllSync<{ uuid: string }>('SELECT uuid FROM quote_items WHERE quote_id = ?', [id]);
  for (const k of kids) if (k.uuid) tombstone('quote_items', k.uuid);
  db.runSync('DELETE FROM quote_items WHERE quote_id = ?', [id]);
  db.runSync('DELETE FROM quotes WHERE id = ?', [id]);
  if (uuid) tombstone('quotes', uuid);
}

/** Turn an approved quote into an invoice; returns the new invoice id. */
export function convertQuoteToInvoice(quoteId: number): number {
  const q = getQuote(quoteId);
  if (!q) throw new Error('Quote not found');
  if (q.status === 'converted' && q.converted_invoice_id) return q.converted_invoice_id;
  const inv = createInvoice({
    clientId: q.client_id,
    items: q.items.map((i) => ({ description: i.description, quantity: i.quantity, rate_cents: i.rate_cents })),
    gstRate: q.gst_rate,
    pstRate: q.pst_rate,
    notes: q.title ? `From quote ${q.number}: ${q.title}` : `From quote ${q.number}`,
    dueDate: '',
    status: 'unpaid',
  });
  setInvoicePaymentTerms(inv.id, getSetting('default_payment_terms', 'Net 15'));
  db.runSync(`UPDATE quotes SET status = 'converted', converted_invoice_id = ? WHERE id = ?`, [inv.id, quoteId]);
  return inv.id;
}

// ----- Change orders -----

export function listChangeOrders(invoiceId: number): ChangeOrder[] {
  return db.getAllSync<ChangeOrder>('SELECT * FROM change_orders WHERE invoice_id = ? ORDER BY id DESC', [invoiceId]);
}

export function createChangeOrder(invoiceId: number, description: string, amountCents: number): ChangeOrder {
  const res = db.runSync(
    'INSERT INTO change_orders (invoice_id, description, amount_cents, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [invoiceId, description.trim(), amountCents, 'pending', todayISO()]
  );
  const row = db.getFirstSync<ChangeOrder>('SELECT * FROM change_orders WHERE id = ?', [
    Number(res.lastInsertRowId),
  ]);
  if (!row) throw new Error('Failed to create change order');
  return row;
}

export function setChangeOrderStatus(id: number, status: ChangeOrderStatus, approvalName = ''): void {
  db.runSync('UPDATE change_orders SET status = ?, client_approval = ?, approved_at = ? WHERE id = ?', [
    status,
    approvalName.trim(),
    status === 'approved' ? todayISO() : '',
    id,
  ]);
}

export function deleteChangeOrder(id: number): void {
  db.runSync('DELETE FROM change_orders WHERE id = ?', [id]);
}

/** Add an approved change order to the invoice as a line item. */
export function billChangeOrder(id: number): void {
  const co = db.getFirstSync<ChangeOrder>('SELECT * FROM change_orders WHERE id = ?', [id]);
  if (!co || co.status !== 'approved' || co.billed) return;
  addInvoiceItem(co.invoice_id, `Change order: ${co.description}`, 1, co.amount_cents);
  db.runSync('UPDATE change_orders SET billed = 1 WHERE id = ?', [id]);
}

// ----- Time entries -----

export function listTimeEntries(invoiceId: number): TimeEntry[] {
  return db.getAllSync<TimeEntry>('SELECT * FROM time_entries WHERE invoice_id = ? ORDER BY work_date DESC, id DESC', [
    invoiceId,
  ]);
}

export function createTimeEntry(
  invoiceId: number,
  workDate: string,
  hours: number,
  description: string,
  rateCents: number
): void {
  db.runSync(
    'INSERT INTO time_entries (invoice_id, work_date, hours, description, rate_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [invoiceId, workDate, hours, description.trim(), rateCents, todayISO()]
  );
}

export function deleteTimeEntry(id: number): void {
  db.runSync('DELETE FROM time_entries WHERE id = ?', [id]);
}

/** Add a time entry to the invoice as a labour line item. */
export function billTimeEntry(id: number): void {
  const t = db.getFirstSync<TimeEntry>('SELECT * FROM time_entries WHERE id = ?', [id]);
  if (!t || t.billed || t.hours <= 0) return;
  const desc = t.description ? `Labour — ${t.description}` : 'Labour';
  addInvoiceItem(t.invoice_id, desc, t.hours, t.rate_cents);
  db.runSync('UPDATE time_entries SET billed = 1 WHERE id = ?', [id]);
}

// ----- Material entries -----

export function listMaterialEntries(invoiceId: number): MaterialEntry[] {
  return db.getAllSync<MaterialEntry>('SELECT * FROM material_entries WHERE invoice_id = ? ORDER BY id DESC', [
    invoiceId,
  ]);
}

export function createMaterialEntry(
  invoiceId: number,
  description: string,
  costCents: number,
  receiptUri = ''
): void {
  db.runSync(
    'INSERT INTO material_entries (invoice_id, description, cost_cents, receipt_uri, created_at) VALUES (?, ?, ?, ?, ?)',
    [invoiceId, description.trim(), costCents, receiptUri, todayISO()]
  );
}

export function deleteMaterialEntry(id: number): void {
  db.runSync('DELETE FROM material_entries WHERE id = ?', [id]);
}

/** Add a material entry to the invoice as a line item. */
export function billMaterialEntry(id: number): void {
  const m = db.getFirstSync<MaterialEntry>('SELECT * FROM material_entries WHERE id = ?', [id]);
  if (!m || m.billed) return;
  addInvoiceItem(m.invoice_id, `Materials — ${m.description}`, 1, m.cost_cents);
  db.runSync('UPDATE material_entries SET billed = 1 WHERE id = ?', [id]);
}

// ----- Job photos -----

export function listJobPhotos(invoiceId: number): JobPhoto[] {
  return db.getAllSync<JobPhoto>('SELECT * FROM job_photos WHERE invoice_id = ? ORDER BY id ASC', [invoiceId]);
}

export function addJobPhoto(invoiceId: number, uri: string, kind: string, caption: string): void {
  db.runSync('INSERT INTO job_photos (invoice_id, uri, kind, caption, created_at) VALUES (?, ?, ?, ?, ?)', [
    invoiceId,
    uri,
    kind,
    caption.trim(),
    todayISO(),
  ]);
}

export function deleteJobPhoto(id: number): void {
  db.runSync('DELETE FROM job_photos WHERE id = ?', [id]);
}
