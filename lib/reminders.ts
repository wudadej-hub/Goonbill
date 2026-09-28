import * as Notifications from 'expo-notifications';
import * as SMS from 'expo-sms';
import { getSetting, getClient, listInvoices, displayStatus, Invoice } from './db';
import { formatCents, todayISO, shiftISODate, formatDate } from './format';

// ---------------------------------------------------------------------------
// Automatic payment reminders. When invoices are created or changed we
// (re)schedule local notifications for each reminder day configured in
// Settings (default: due date, +3, +7, +14 days). No server needed.
// ---------------------------------------------------------------------------

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const PREFIX = 'goonbill-reminder-';

export async function ensureReminderPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === 'granted';
}

export function remindersEnabled(): boolean {
  return getSetting('reminders_enabled', '1') === '1';
}

export function reminderDays(): number[] {
  return getSetting('reminder_days', '0,3,7,14')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 0)
    .slice(0, 8);
}

function reminderBody(inv: Invoice, daysOverdue: number): string {
  const amount = formatCents(inv.total_cents);
  const who = inv.client_name ? ` from ${inv.client_name}` : '';
  if (daysOverdue <= 0) return `Invoice #${inv.number} for ${amount}${who} is due ${formatDate(inv.due_date)}.`;
  return `Invoice #${inv.number} for ${amount}${who} is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue.`;
}

/** Cancel our reminders and reschedule from the current invoice list. */
export async function refreshReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith(PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
    if (!remindersEnabled()) return;
    const ok = await ensureReminderPermission();
    if (!ok) return;

    const days = reminderDays();
    if (days.length === 0) return;
    const today = todayISO();
    const invoices = listInvoices().filter(
      (inv) => (displayStatus(inv) === 'unpaid' || displayStatus(inv) === 'overdue') && inv.due_date
    );
    for (const inv of invoices) {
      for (const d of days) {
        const fireDate = shiftISODate(inv.due_date, d);
        if (fireDate < today) continue; // don't schedule in the past
        const when = new Date(`${fireDate}T09:00:00`);
        if (when.getTime() <= Date.now()) continue;
        await Notifications.scheduleNotificationAsync({
          identifier: `${PREFIX}${inv.id}-${d}`,
          content: {
            title: d === 0 ? 'Invoice due today' : 'Overdue invoice',
            body: reminderBody(inv, d),
            data: { invoiceId: inv.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
        });
      }
    }
  } catch (e) {
    console.warn('refreshReminders failed', e);
  }
}

/** Open the SMS composer with a polite payment nudge prefilled. */
export async function sendSmsReminder(inv: Invoice): Promise<'sent' | 'unavailable' | 'cancelled'> {
  const available = await SMS.isAvailableAsync();
  if (!available) return 'unavailable';
  const phone = getClient(inv.client_id)?.phone ?? '';
  const amount = formatCents(inv.total_cents);
  const business = getSetting('business_name');
  const msg =
    `Hi ${inv.client_name || 'there'}, just a friendly reminder that invoice #${inv.number} ` +
    `for ${amount} was due ${formatDate(inv.due_date)}. ` +
    `Let me know if you have any questions!${business ? ` — ${business}` : ''}`;
  const { result } = await SMS.sendSMSAsync(phone ? [phone] : [], msg);
  return result === 'sent' ? 'sent' : 'cancelled';
}
