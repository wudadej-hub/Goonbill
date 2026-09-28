import * as FileSystem from 'expo-file-system/legacy';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSetting, setSetting, getUuid, getDb } from './db';
import { getSupabase, supabaseConfigured } from './supabase';

// ---------------------------------------------------------------------------
// Cloud sync: mirrors the local SQLite tables in Supabase (per-user, RLS).
// Last-write-wins by updated_at (millis). Photos live in the `job-photos`
// storage bucket; only their remote path syncs, files upload/download.
// ---------------------------------------------------------------------------

const db = getDb();

interface ParentFk {
  /** local integer FK column, e.g. 'invoice_id' */
  local: string;
  /** local parent table, e.g. 'invoices' */
  parentTable: string;
  /** remote uuid column, e.g. 'invoice_uuid' */
  remote: string;
}

interface SyncSpec {
  local: string;
  remote: string;
  /** local columns (besides uuid/updated_at/deleted) pushed as-is */
  cols: string[];
  parents?: ParentFk[];
  /** photo column handling: 'job_photos' uses uri, 'material_entries' uses receipt_uri */
  photoUriCol?: string;
}

const SPECS: SyncSpec[] = [
  { local: 'clients', remote: 'clients', cols: ['name', 'phone', 'email', 'address', 'created_at'] },
  {
    local: 'invoices',
    remote: 'invoices',
    cols: ['number', 'status', 'subtotal_cents', 'gst_rate', 'pst_rate', 'gst_cents', 'pst_cents', 'total_cents', 'notes', 'due_date', 'payment_terms', 'created_at'],
    parents: [{ local: 'client_id', parentTable: 'clients', remote: 'client_uuid' }],
  },
  {
    local: 'line_items',
    remote: 'line_items',
    cols: ['description', 'quantity', 'rate_cents'],
    parents: [{ local: 'invoice_id', parentTable: 'invoices', remote: 'invoice_uuid' }],
  },
  {
    local: 'payments',
    remote: 'payments',
    cols: ['amount_cents', 'method', 'reference', 'paid_at'],
    parents: [{ local: 'invoice_id', parentTable: 'invoices', remote: 'invoice_uuid' }],
  },
  {
    local: 'quotes',
    remote: 'quotes',
    cols: ['number', 'status', 'title', 'scope', 'materials', 'timeline', 'subtotal_cents', 'gst_rate', 'pst_rate', 'gst_cents', 'pst_cents', 'total_cents', 'payment_schedule', 'late_fees', 'scope_change_policy', 'valid_until', 'client_signature', 'signed_at', 'created_at'],
    parents: [
      { local: 'client_id', parentTable: 'clients', remote: 'client_uuid' },
      { local: 'converted_invoice_id', parentTable: 'invoices', remote: 'converted_invoice_uuid' },
    ],
  },
  {
    local: 'quote_items',
    remote: 'quote_items',
    cols: ['description', 'quantity', 'rate_cents'],
    parents: [{ local: 'quote_id', parentTable: 'quotes', remote: 'quote_uuid' }],
  },
  {
    local: 'change_orders',
    remote: 'change_orders',
    cols: ['description', 'amount_cents', 'status', 'client_approval', 'approved_at', 'billed', 'created_at'],
    parents: [{ local: 'invoice_id', parentTable: 'invoices', remote: 'invoice_uuid' }],
  },
  {
    local: 'time_entries',
    remote: 'time_entries',
    cols: ['work_date', 'hours', 'description', 'rate_cents', 'billed', 'created_at'],
    parents: [{ local: 'invoice_id', parentTable: 'invoices', remote: 'invoice_uuid' }],
  },
  {
    local: 'material_entries',
    remote: 'material_entries',
    cols: ['description', 'cost_cents', 'billed', 'created_at'],
    parents: [{ local: 'invoice_id', parentTable: 'invoices', remote: 'invoice_uuid' }],
    photoUriCol: 'receipt_uri',
  },
  {
    local: 'job_photos',
    remote: 'job_photos',
    cols: ['kind', 'caption', 'created_at'],
    parents: [{ local: 'invoice_id', parentTable: 'invoices', remote: 'invoice_uuid' }],
    photoUriCol: 'uri',
  },
];

const PHOTO_BUCKET = 'job-photos';

function cursorKey(table: string): string {
  return `sync_cursor_${table}`;
}
function getCursor(table: string): number {
  return parseInt(getSetting(cursorKey(table), '0'), 10) || 0;
}
function setCursor(table: string, v: number): void {
  setSetting(cursorKey(table), String(v));
}

function localIdForUuid(table: string, uuid: string | null): number | null {
  if (!uuid) return null;
  const row = db.getFirstSync<{ id: number }>(`SELECT id FROM ${table} WHERE uuid = ?`, [uuid]);
  return row ? row.id : null;
}

async function ensurePhotoDir(): Promise<string> {
  const dir = `${FileSystem.documentDirectory}job-photos/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function uploadPhoto(sb: SupabaseClient, userId: string, localUri: string, uuid: string): Promise<string> {
  const path = `${userId}/${uuid}.jpg`;
  const res = await fetch(localUri);
  const blob = await res.blob();
  const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;
  return path;
}

async function downloadPhoto(sb: SupabaseClient, remotePath: string, uuid: string): Promise<string> {
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(remotePath, 60 * 60 * 24 * 365);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not sign photo URL');
  const dir = await ensurePhotoDir();
  const dest = `${dir}sync-${uuid}.jpg`;
  await FileSystem.downloadAsync(data.signedUrl, dest);
  return dest;
}

// ---------- Auth ----------

export interface SyncUser {
  id: string;
  email: string | undefined;
}

export async function syncSignUp(email: string, password: string): Promise<SyncUser> {
  const sb = getSupabase();
  if (!sb) throw new Error('Add your Supabase URL and anon key in Settings first.');
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-up did not return a user.');
  return { id: data.user.id, email: data.user.email };
}

export async function syncSignIn(email: string, password: string): Promise<SyncUser> {
  const sb = getSupabase();
  if (!sb) throw new Error('Add your Supabase URL and anon key in Settings first.');
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-in did not return a user.');
  return { id: data.user.id, email: data.user.email };
}

export async function syncSignOut(): Promise<void> {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
}

export async function syncUser(): Promise<SyncUser | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email } : null;
}

// ---------- Push ----------

async function pushTable(sb: SupabaseClient, userId: string, spec: SyncSpec): Promise<number> {
  const cursor = getCursor(spec.local);
  const rows = db.getAllSync<Record<string, any>>(
    `SELECT * FROM ${spec.local} WHERE updated_at > ? AND (deleted IS NULL OR deleted = 0) ORDER BY updated_at ASC LIMIT 500`,
    [cursor]
  );
  let pushed = 0;
  let maxTs = cursor;
  for (const row of rows) {
    const payload: Record<string, any> = {
      uuid: row.uuid,
      user_id: userId,
      updated_at: row.updated_at,
      deleted: 0,
    };
    for (const c of spec.cols) payload[c] = row[c];
    let skip = false;
    for (const p of spec.parents ?? []) {
      const localFk: number | null = row[p.local];
      if (localFk == null) {
        payload[p.remote] = null;
        continue;
      }
      const parentUuid = getUuid(p.parentTable, localFk);
      if (!parentUuid) {
        skip = true; // parent not synced yet; will retry next sync
        break;
      }
      payload[p.remote] = parentUuid;
    }
    if (skip) continue;

    // Photo upload for rows with a local file not yet in storage
    if (spec.photoUriCol) {
      const localUri: string = row[spec.photoUriCol] ?? '';
      const remotePath: string = row.remote_path ?? '';
      if (localUri.startsWith('file') && !remotePath) {
        try {
          const path = await uploadPhoto(sb, userId, localUri, row.uuid);
          db.runSync(`UPDATE ${spec.local} SET remote_path = ? WHERE id = ?`, [path, row.id]);
          payload.remote_path = path;
        } catch (e) {
          console.warn('Photo upload failed, will retry', e);
        }
      } else if (remotePath) {
        payload.remote_path = remotePath;
      }
    }

    const { error } = await sb.from(spec.remote).upsert(payload, { onConflict: 'uuid' });
    if (error) throw error;
    pushed += 1;
    if (row.updated_at > maxTs) maxTs = row.updated_at;
  }
  if (pushed > 0) setCursor(spec.local, maxTs);
  return pushed;
}

async function pushTombstones(sb: SupabaseClient): Promise<number> {
  const stones = db.getAllSync<{ uuid: string; table_name: string }>('SELECT uuid, table_name FROM tombstones');
  let n = 0;
  for (const s of stones) {
    const spec = SPECS.find((x) => x.local === s.table_name);
    if (!spec) {
      db.runSync('DELETE FROM tombstones WHERE uuid = ?', [s.uuid]);
      continue;
    }
    const { error } = await sb.from(spec.remote).delete().eq('uuid', s.uuid);
    if (error) throw error;
    db.runSync('DELETE FROM tombstones WHERE uuid = ?', [s.uuid]);
    n += 1;
  }
  return n;
}

// ---------- Pull ----------

async function pullTable(sb: SupabaseClient, spec: SyncSpec): Promise<number> {
  const cursor = getCursor(spec.local);
  const { data, error } = await sb
    .from(spec.remote)
    .select('*')
    .gt('updated_at', cursor)
    .order('updated_at', { ascending: true })
    .limit(500);
  if (error) throw error;
  let pulled = 0;
  let maxTs = cursor;
  for (const remote of data ?? []) {
    if (remote.updated_at > maxTs) maxTs = remote.updated_at;
    const selectCols = spec.photoUriCol ? 'id, updated_at, remote_path' : 'id, updated_at';
    const local = db.getFirstSync<{ id: number; updated_at: number; remote_path: string | null }>(
      `SELECT ${selectCols} FROM ${spec.local} WHERE uuid = ?`,
      [remote.uuid]
    );
    // Last-write-wins: ignore remote rows older than what we have
    if (local && remote.updated_at <= (local.updated_at ?? 0)) continue;

    const cols: string[] = [];
    const vals: any[] = [];
    const set = (col: string, v: any) => {
      cols.push(col);
      vals.push(v);
    };
    for (const c of spec.cols) set(c, remote[c] ?? null);
    let skip = false;
    for (const p of spec.parents ?? []) {
      const parentUuid: string | null = remote[p.remote] ?? null;
      if (!parentUuid) {
        set(p.local, null);
        continue;
      }
      const parentId = localIdForUuid(p.parentTable, parentUuid);
      if (parentId == null) {
        skip = true;
        break;
      }
      set(p.local, parentId);
    }
    if (skip) continue;

    // Photos: download the file if we don't have this version
    if (spec.photoUriCol) {
      const remotePath: string = remote.remote_path ?? '';
      const localPath: string = local?.remote_path ?? '';
      if (remotePath && remotePath !== localPath) {
        try {
          const dest = await downloadPhoto(sb, remotePath, remote.uuid);
          set(spec.photoUriCol, dest);
          set('remote_path', remotePath);
        } catch (e) {
          console.warn('Photo download failed, will retry', e);
        }
      }
    }

    // Preserve the remote timestamp so we don't bounce the row back up
    set('updated_at', remote.updated_at);
    set('deleted', 0);
    if (local) {
      const assignments = cols.map((c) => `${c} = ?`).join(', ');
      db.runSync(`UPDATE ${spec.local} SET ${assignments} WHERE id = ?`, [...vals, local.id]);
    } else {
      set('uuid', remote.uuid);
      const placeholders = cols.map(() => '?').join(', ');
      db.runSync(`INSERT INTO ${spec.local} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
    }
    pulled += 1;
  }
  if (maxTs > cursor) setCursor(spec.local, maxTs);
  return pulled;
}

// ---------- Public API ----------

export interface SyncResult {
  pushed: number;
  pulled: number;
  at: number;
}

export async function syncNow(): Promise<SyncResult> {
  if (!supabaseConfigured()) throw new Error('Cloud sync is not set up. Add your Supabase URL and anon key in Settings.');
  const sb = getSupabase()!;
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error('Sign in to your sync account first (Settings → Cloud sync).');
  const userId = data.user.id;

  let pushed = 0;
  let pulled = 0;
  for (const spec of SPECS) pushed += await pushTable(sb, userId, spec);
  pushed += await pushTombstones(sb);
  for (const spec of SPECS) pulled += await pullTable(sb, spec);

  const at = Date.now();
  setSetting('sync_last_at', String(at));
  return { pushed, pulled, at };
}

export function lastSyncAt(): number {
  return parseInt(getSetting('sync_last_at', '0'), 10) || 0;
}

export function pendingPushCount(): number {
  let n = 0;
  for (const spec of SPECS) {
    const cursor = getCursor(spec.local);
    const row = db.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${spec.local} WHERE updated_at > ? AND (deleted IS NULL OR deleted = 0)`,
      [cursor]
    );
    n += row?.c ?? 0;
  }
  const t = db.getFirstSync<{ c: number }>('SELECT COUNT(*) AS c FROM tombstones');
  return n + (t?.c ?? 0);
}
