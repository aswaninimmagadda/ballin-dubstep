import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const { ready, signedIn, t, brandColor } = useAuth();
  const [tab, setTab] = useState<Tab>('home');
  // Android 15+ draws edge-to-edge and there is no opt-out, so the app is
  // laid out under the status bar and the gesture/navigation bar. Real insets
  // are the only thing keeping the tab bar above the system navigation —
  // react-native's own SafeAreaView is a plain View on Android (it is
  // deprecated and applies insets on iOS only), which left the 52dp tab bar
  // sitting behind the 48dp navigation bar.
  const insets = useSafeAreaInsets();

  // The sign-in and loading screens are laid out edge-to-edge too, so they
  // need the same insets — otherwise the gym-code field sits under the clock.
  const chrome = {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };
  if (!ready)
    return (
      <View style={[styles.root, chrome]}>
        <Loading />
      </View>
    );
  if (!signedIn)
    return (
      <View style={[styles.root, chrome]}>
        <LoginScreen />
      </View>
    );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'home', label: t.nav.dashboard },
    { key: 'payments', label: t.payments.title },
    { key: 'attendance', label: t.attendance.title },
    { key: 'pt', label: 'PT' },
    { key: 'profile', label: t.members.overview },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.body}>
        {tab === 'home' ? <HomeScreen /> : null}
        {tab === 'payments' ? <PaymentsScreen /> : null}
        {tab === 'attendance' ? <AttendanceScreen /> : null}
        {tab === 'pt' ? <PtScreen /> : null}
        {tab === 'profile' ? <ProfileScreen /> : null}
      </View>
      <View
        style={[
          styles.tabBar,
          // Keep the touch targets their full height and push the whole bar
          // clear of the system navigation, rather than shrinking the labels.
          { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
        accessibilityRole="tablist"
      >
        {tabs.map(({ key, label }) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={styles.tabItem}
          >
            <Text
              style={[
                styles.tabLabel,
                tab === key && styles.tabLabelActive,
                // The active tab picks up the gym's colour too, so the whole
                // shell reads as the gym's app rather than GymFlow's.
                tab === key && { color: brandColor },
              ]}
              numberOfLines={1}
            >
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
    <SafeAreaProvider>
      <AuthProvider>
        <View style={styles.safe}>
          <StatusBar style="dark" />
          <Shell />
        </View>
      </AuthProvider>
    </SafeAreaProvider>
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
