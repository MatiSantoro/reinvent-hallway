import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ExploreScreen } from './src/screens/ExploreScreen';
import { GroupsScreen } from './src/screens/GroupsScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { WeekScreen } from './src/screens/WeekScreen';
import { AppProvider, useApp } from './src/state/AppState';
import { Icon, IconName } from './src/ui/icons';
import { C } from './src/ui/kit';

const TABS: { key: IconName; label: string; screen: () => React.JSX.Element }[] = [
  { key: 'plan', label: 'Plan', screen: () => <PlanScreen /> },
  { key: 'explore', label: 'Explore', screen: () => <ExploreScreen /> },
  { key: 'week', label: 'My week', screen: () => <WeekScreen /> },
  { key: 'groups', label: 'Groups', screen: () => <GroupsScreen /> },
];
type Tab = IconName;

function Main() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('plan');
  // A screen is built the first time you open it, then kept alive (just hidden), so switching
  // back is instant and keeps its scroll position, filters and typed text.
  const [opened, setOpened] = useState<Set<Tab>>(new Set(['plan']));
  const url = Linking.useURL();

  const go = (t: Tab) => {
    setOpened((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
    setTab(t);
  };

  // An invite link opens the Groups tab.
  useEffect(() => {
    if (url?.includes('join/')) go('groups');
  }, [url]);

  if (app.status !== 'ready') return <SignInScreen />;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {TABS.map((t) =>
          opened.has(t.key) ? (
            <View key={t.key} style={{ flex: 1, display: tab === t.key ? 'flex' : 'none' }}>
              {t.screen()}
            </View>
          ) : null
        )}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => go(t.key)}
              hitSlop={4}
              style={{ flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 8 }}
            >
              <Icon name={t.key} size={30} color={on ? C.accent : C.dim} />
              <Text style={{ fontSize: 12, fontWeight: '700', marginTop: 3, color: on ? C.accent : C.dim }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right', 'bottom']}>
          <StatusBar style="light" />
          <Main />
        </SafeAreaView>
      </AppProvider>
    </SafeAreaProvider>
  );
}
