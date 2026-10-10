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
import { C } from './src/ui/kit';

const TABS = [
  { key: 'plan', label: 'Plan', icon: '✦' },
  { key: 'explore', label: 'Explore', icon: '⌕' },
  { key: 'week', label: 'My week', icon: '▦' },
  { key: 'groups', label: 'Groups', icon: '◎' },
] as const;
type Tab = (typeof TABS)[number]['key'];

function Main() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>('plan');
  const url = Linking.useURL();

  // An invite link opens the Groups tab.
  useEffect(() => {
    if (url?.includes('join/')) setTab('groups');
  }, [url]);

  if (app.status !== 'ready') return <SignInScreen />;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {tab === 'plan' && <PlanScreen />}
        {tab === 'explore' && <ExploreScreen />}
        {tab === 'week' && <WeekScreen />}
        {tab === 'groups' && <GroupsScreen />}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10 }}>
            <Text style={{ fontSize: 18, color: tab === t.key ? C.accent : C.dim }}>{t.icon}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', marginTop: 2, color: tab === t.key ? C.accent : C.dim }}>{t.label}</Text>
          </Pressable>
        ))}
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
