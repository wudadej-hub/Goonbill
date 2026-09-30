import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initDb } from '../lib/db';
import { refreshReminders } from '../lib/reminders';
import { checkEntitlement, type Entitlement } from '../lib/billing';
import { SubscribeScreen } from '../components/SubscribeScreen';
import { theme } from '../lib/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [entitlement, setEntitlement] = useState<Entitlement | 'checking'>('checking');

  useEffect(() => {
    (async () => {
      try {
        initDb();
      } catch (e) {
        console.error('Database init failed', e);
      }
      setReady(true);
      // Schedule payment reminders in the background (no-op if disabled)
      refreshReminders();
      // Play Billing entitlement: active sub (trial counts) → full access,
      // 'unknown' (billing unreachable) fails open so nobody is wrongly locked out.
      setEntitlement(await checkEntitlement());
    })();
  }, []);

  if (!ready || entitlement === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  // No active subscription — gate the app behind the paywall.
  if (entitlement === 'inactive') {
    return (
      <>
        <StatusBar style="light" />
        <SubscribeScreen onUnlocked={() => setEntitlement('active')} />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.bg },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="howto" options={{ title: 'How to use' }} />
        <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
        <Stack.Screen name="subscribe" options={{ title: 'Subscription' }} />
      </Stack>
    </>
  );
}
