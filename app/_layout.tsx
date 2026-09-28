import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { initDb } from '../lib/db';
import { refreshReminders } from '../lib/reminders';
import { theme } from '../lib/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      initDb();
    } catch (e) {
      console.error('Database init failed', e);
    }
    setReady(true);
    // Schedule payment reminders in the background (no-op if disabled)
    refreshReminders();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
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
        <Stack.Screen name="invoice/[id]" options={{ title: 'Invoice' }} />
      </Stack>
    </>
  );
}
