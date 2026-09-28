import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { theme } from '../../lib/theme';

function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ color: focused ? theme.accent : theme.muted, fontSize: 13, fontWeight: focused ? '700' : '500' }}>
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          minHeight: 72,
          paddingBottom: 12,
          paddingTop: 8,
        },
        tabBarIcon: () => null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Invoices',
          tabBarLabel: ({ focused }) => <TabLabel label="Invoices" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="quotes"
        options={{
          title: 'Quotes',
          tabBarLabel: ({ focused }) => <TabLabel label="Quotes" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="new"
        options={{
          title: 'New Invoice',
          tabBarLabel: ({ focused }) => <TabLabel label="+ New" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          tabBarLabel: ({ focused }) => <TabLabel label="Clients" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarLabel: ({ focused }) => <TabLabel label="Settings" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
