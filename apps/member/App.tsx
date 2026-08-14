import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/lib/auth';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PaymentsScreen } from './src/screens/PaymentsScreen';
import { AttendanceScreen } from './src/screens/AttendanceScreen';
import { PtScreen } from './src/screens/PtScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { Loading } from './src/components/ui';
import { theme } from './src/lib/theme';

type Tab = 'home' | 'payments' | 'attendance' | 'pt' | 'profile';

function Shell() {
  const { ready, signedIn, t } = useAuth();
  const [tab, setTab] = useState<Tab>('home');

  if (!ready) return <Loading />;
  if (!signedIn) return <LoginScreen />;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'home', label: t.nav.dashboard },
    { key: 'payments', label: t.payments.title },
    { key: 'attendance', label: t.attendance.title },
    { key: 'pt', label: 'PT' },
    { key: 'profile', label: t.members.overview },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'home' ? <HomeScreen /> : null}
        {tab === 'payments' ? <PaymentsScreen /> : null}
        {tab === 'attendance' ? <AttendanceScreen /> : null}
        {tab === 'pt' ? <PtScreen /> : null}
        {tab === 'profile' ? <ProfileScreen /> : null}
      </View>
      <View style={styles.tabBar} accessibilityRole="tablist">
        {tabs.map(({ key, label }) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={styles.tabItem}
          >
            <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <Shell />
      </SafeAreaView>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.surfaceMuted },
  root: { flex: 1 },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
    backgroundColor: '#fff',
  },
  tabItem: {
    flex: 1,
    minHeight: theme.touchTarget + 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: { fontSize: 12, color: theme.color.textMuted },
  tabLabelActive: { color: theme.color.primary, fontWeight: '700' },
});
