/** Format integer cents as CAD, e.g. 123456 -> "$1,234.56" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${rem.toString().padStart(2, '0')}`;
}

/** Parse a user-typed dollar string ("1,234.50", "$45", "45.5") to integer cents. */
export function parseDollarsToCents(input: string): number {
  const cleaned = input.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** Today's date as YYYY-MM-DD (local). */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** YYYY-MM-DD -> "Sep 27, 2026" */
export function formatDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** Shift a YYYY-MM-DD date by N days, returning YYYY-MM-DD. */
export function shiftISODate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
