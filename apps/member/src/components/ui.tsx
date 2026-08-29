import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { theme, statusColors } from '../lib/theme';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const colors = statusColors[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { brandColor } = useAuth();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        // The gym's own colour, not GymFlow's. Falls back to the product
        // green when the gym has not set one.
        { backgroundColor: brandColor },
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.color.primary} />
    </View>
  );
}

export function OfflineBanner({ text }: { text: string }) {
  return (
    <View style={styles.offline}>
      <Text style={styles.offlineText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.surfaceMuted, padding: theme.spacing.md },
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  title: { fontSize: 22, fontWeight: '700', color: theme.color.text, marginBottom: 8 },
  muted: { fontSize: 13, color: theme.color.textMuted },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: theme.radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  button: {
    backgroundColor: theme.color.primary,
    borderRadius: theme.radius.md,
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  offline: {
    backgroundColor: '#fef3c7',
    borderRadius: theme.radius.sm,
    padding: 8,
    marginBottom: theme.spacing.md,
  },
  offlineText: { color: '#92400e', fontSize: 12, textAlign: 'center' },
});
