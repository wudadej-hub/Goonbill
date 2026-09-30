import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { finishTransaction } from 'react-native-iap';
import { theme, spacing } from '../lib/theme';
import { Button, Card, Screen, Title, Subtitle } from './ui';
import {
  SUBSCRIPTION_SKUS,
  billingSupported,
  checkEntitlement,
  fetchPlans,
  isUserCancelled,
  listenForPurchaseErrors,
  listenForPurchases,
  restorePurchases,
  subscribe,
  type PlanInfo,
} from '../lib/billing';

interface Props {
  /** Called once the user holds an active subscription. */
  onUnlocked: () => void;
}

export function SubscribeScreen({ onUnlocked }: Props) {
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const unlockedRef = useRef(false);

  const unlock = () => {
    if (!unlockedRef.current) {
      unlockedRef.current = true;
      onUnlocked();
    }
  };

  useEffect(() => {
    if (!billingSupported()) {
      setLoadError('Subscriptions are billed through Google Play, which is not available on this device.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const fetched = await fetchPlans();
        if (!cancelled) {
          if (fetched.length === 0) {
            setLoadError('Subscription products are not set up yet. Please try again later.');
          } else {
            setPlans(fetched);
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load subscription options.');
      }
    })();

    // Safety net: finish any purchase that completes outside the awaited call.
    const updateSub = listenForPurchases(async (purchase) => {
      if (!purchase.productId || !SUBSCRIPTION_SKUS.includes(purchase.productId)) return;
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {
        // Already acknowledged — ignore.
      }
      if ((await checkEntitlement()) === 'active') unlock();
    });
    const errorSub = listenForPurchaseErrors((error) => {
      if (!isUserCancelled(error)) {
        Alert.alert('Purchase failed', error.message ?? 'Something went wrong.');
      }
      setBusyPlan(null);
    });
    return () => {
      cancelled = true;
      updateSub.remove();
      errorSub.remove();
    };
  }, []);

  const handleSubscribe = async (plan: PlanInfo) => {
    setBusyPlan(plan.id);
    try {
      const done = await subscribe(plan);
      if (done && (await checkEntitlement()) === 'active') {
        unlock();
      } else if (done) {
        Alert.alert(
          'Almost there',
          'Your purchase went through — it can take a moment to appear. Tap "Restore purchases" if the app does not unlock.',
        );
      }
    } catch (e) {
      if (!isUserCancelled(e)) {
        Alert.alert('Could not start purchase', e instanceof Error ? e.message : 'Unknown error');
      }
    } finally {
      setBusyPlan(null);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      if (await restorePurchases()) {
        unlock();
      } else {
        Alert.alert('No subscription found', 'We could not find an active GoonBill subscription on this Google account.');
      }
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRestoring(false);
    }
  };

  const openManage = () => {
    Linking.openURL('https://play.google.com/store/account/subscriptions').catch(() => {
      Alert.alert('Open the Play Store app → your profile → Payments & subscriptions to manage.');
    });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Title>Subscribe to GoonBill</Title>
        <Subtitle>One subscription unlocks the whole app — invoices, quotes, job docs and client payments.</Subtitle>

        <Card style={styles.trialCard}>
          <Text style={styles.trialTitle}>🎉 28-day free trial</Text>
          <Text style={styles.trialText}>
            Try everything free for 28 days. You won't be charged until the trial ends — cancel anytime in Google Play.
          </Text>
        </Card>

        {plans === null && !loadError ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.accent} />
            <Text style={styles.muted}>Loading plans…</Text>
          </View>
        ) : null}

        {loadError ? (
          <Card>
            <Text style={styles.errorText}>{loadError}</Text>
          </Card>
        ) : null}

        {plans?.map((plan) => {
          const yearly = plan.id === 'goonbill_yearly';
          return (
            <Card key={plan.id} style={yearly ? styles.bestCard : undefined}>
              {yearly ? (
                <View style={styles.bestBadge}>
                  <Text style={styles.bestBadgeText}>BEST VALUE — 2 MONTHS FREE</Text>
                </View>
              ) : null}
              <Text style={styles.planTitle}>{plan.title || (yearly ? 'Yearly' : 'Monthly')}</Text>
              <Text style={styles.planPrice}>{plan.displayPrice}</Text>
              <Text style={styles.planNote}>
                {yearly ? '$280/year after the 28-day free trial' : '$28/month after the 28-day free trial'}
              </Text>
              <Button
                title={yearly ? 'Subscribe Yearly' : 'Subscribe Monthly'}
                onPress={() => handleSubscribe(plan)}
                loading={busyPlan === plan.id}
                disabled={busyPlan !== null}
                style={styles.planButton}
              />
            </Card>
          );
        })}

        <TouchableOpacity onPress={handleRestore} disabled={restoring} activeOpacity={0.7} style={styles.linkRow}>
          <Text style={styles.link}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openManage} activeOpacity={0.7} style={styles.linkRow}>
          <Text style={styles.link}>Manage subscription in Google Play</Text>
        </TouchableOpacity>

        <Text style={styles.finePrint}>
          Billed securely through Google Play. Subscriptions auto-renew until cancelled. Cancel anytime in the Play
          Store — you keep access until the end of the billing period.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xl },
  trialCard: { borderColor: theme.accent, borderWidth: 1.5 },
  trialTitle: { color: theme.accent, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  trialText: { color: theme.text, fontSize: 15, lineHeight: 22 },
  center: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  muted: { color: theme.muted, fontSize: 15 },
  errorText: { color: theme.danger, fontSize: 15, lineHeight: 22 },
  bestCard: { borderColor: theme.accent, borderWidth: 1.5 },
  bestBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: spacing.sm,
  },
  bestBadgeText: { color: '#0b0f0d', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  planTitle: { color: theme.text, fontSize: 20, fontWeight: '800' },
  planPrice: { color: theme.accent, fontSize: 26, fontWeight: '800', marginTop: 4 },
  planNote: { color: theme.muted, fontSize: 14, marginTop: 4, marginBottom: spacing.md },
  planButton: { marginTop: 4 },
  linkRow: { alignItems: 'center', paddingVertical: spacing.sm },
  link: { color: theme.accent, fontSize: 16, fontWeight: '600' },
  finePrint: { color: theme.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: spacing.md },
});
