import { Platform } from 'react-native';
import {
  initConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  hasActiveSubscriptions,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type ProductSubscription,
  type Purchase,
} from 'react-native-iap';

/**
 * Google Play Billing for the GoonBill app subscription.
 *
 * Product IDs — Wyatt creates these exact IDs in the Play Console
 * (Monetize → Products → Subscriptions), each with a 28-day free trial:
 *   goonbill_monthly — $28 CAD/month
 *   goonbill_yearly  — $280 CAD/year
 *
 * Entitlement is checked live against Play on launch. A subscription that is
 * in its free-trial period counts as active. Stripe is untouched — it stays
 * for invoice card payments only.
 */

export const SUBSCRIPTION_SKUS = ['goonbill_monthly', 'goonbill_yearly'];

export interface PlanInfo {
  id: string;
  title: string;
  /** Localized price string from Play, e.g. "$28.00/month". */
  displayPrice: string;
  /** Offer token for the base plan — Play Billing needs it to start the flow. */
  offerToken: string | null;
}

export type Entitlement = 'active' | 'inactive' | 'unknown';

let connected = false;

/** Play Billing only exists on Android. Other platforms fail open. */
export function billingSupported(): boolean {
  return Platform.OS === 'android';
}

export async function initBilling(): Promise<boolean> {
  if (!billingSupported()) return false;
  if (connected) return true;
  try {
    await initConnection();
    connected = true;
    return true;
  } catch (e) {
    console.warn('[billing] initConnection failed', e);
    return false;
  }
}

/** Fetch the two subscription products with live pricing from Play. */
export async function fetchPlans(): Promise<PlanInfo[]> {
  if (!(await initBilling())) throw new Error('Play Billing is not available on this device.');
  const products = await fetchProducts({ skus: SUBSCRIPTION_SKUS, type: 'subs' });
  const subs = ((products ?? []) as ProductSubscription[]).filter(
    (p) => p.platform === 'android' && SUBSCRIPTION_SKUS.includes(p.id),
  );
  // Monthly first, regardless of Play's return order.
  subs.sort((a, b) => SUBSCRIPTION_SKUS.indexOf(a.id) - SUBSCRIPTION_SKUS.indexOf(b.id));
  return subs.map((p) => ({
    id: p.id,
    // Play appends " (GoonBill)" to titles — strip it for a clean label.
    title: p.title.replace(/\s*\(.*?\)\s*$/, ''),
    displayPrice: p.displayPrice,
    offerToken: p.subscriptionOffers?.[0]?.offerTokenAndroid ?? null,
  }));
}

/**
 * Run the Google Play purchase sheet for a plan.
 * Returns true when the purchase completed (acknowledged with Play).
 */
export async function subscribe(plan: PlanInfo): Promise<boolean> {
  if (!(await initBilling())) throw new Error('Play Billing is not available on this device.');
  const google: {
    skus: string[];
    subscriptionOffers?: { sku: string; offerToken: string }[];
  } = { skus: [plan.id] };
  if (plan.offerToken) {
    google.subscriptionOffers = [{ sku: plan.id, offerToken: plan.offerToken }];
  }
  const result = await requestPurchase({ request: { google }, type: 'subs' });
  const purchases = Array.isArray(result) ? result : result ? [result] : [];
  let done = false;
  for (const purchase of purchases) {
    // Acknowledge so Play doesn't auto-refund after 3 days.
    await finishTransaction({ purchase, isConsumable: false });
    done = true;
  }
  return done;
}

/**
 * True when the user holds an active GoonBill subscription.
 * A subscription in its 28-day free-trial period counts as active.
 * Returns 'unknown' when billing can't be reached — callers fail open so a
 * transient Play error never locks a paying user out.
 */
export async function checkEntitlement(): Promise<Entitlement> {
  if (!billingSupported()) return 'active';
  try {
    if (!(await initBilling())) return 'unknown';
    return (await hasActiveSubscriptions(SUBSCRIPTION_SKUS)) ? 'active' : 'inactive';
  } catch (e) {
    console.warn('[billing] entitlement check failed', e);
    return 'unknown';
  }
}

/**
 * Re-pull purchases from Play, acknowledge anything unfinished, then re-check.
 * Used by the "Restore purchases" button.
 */
export async function restorePurchases(): Promise<boolean> {
  if (!(await initBilling())) throw new Error('Play Billing is not available on this device.');
  try {
    const purchases = await getAvailablePurchases();
    for (const p of purchases) {
      if (p.productId && SUBSCRIPTION_SKUS.includes(p.productId)) {
        try {
          await finishTransaction({ purchase: p, isConsumable: false });
        } catch (e) {
          console.warn('[billing] finishTransaction failed', e);
        }
      }
    }
  } catch (e) {
    console.warn('[billing] restore failed', e);
  }
  return (await checkEntitlement()) === 'active';
}

/** Safety net: finish any subscription purchase that completes outside the awaited call. */
export function listenForPurchases(onPurchase: (purchase: Purchase) => void) {
  return purchaseUpdatedListener(onPurchase);
}

export function listenForPurchaseErrors(
  onError: (error: { code?: string; message?: string }) => void,
) {
  return purchaseErrorListener(onError);
}

/** True when the error is just the user backing out of the Play sheet. */
export function isUserCancelled(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'user-cancelled' || code === 'E_USER_CANCELLED';
}
