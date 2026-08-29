import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../lib/theme';

/**
 * What a member sees when a screen could not load. Previously they saw a
 * spinner that never stopped, or an empty list that read as "you have nothing"
 * — both of which send them to the front desk to ask a question the desk
 * cannot answer.
 */
export function ErrorState({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.message}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}>
        <Text style={styles.buttonText}>{retryLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  message: { fontSize: 15, color: theme.color.textMuted, textAlign: 'center' },
  button: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: 24,
    borderRadius: 10,
    backgroundColor: theme.color.primary,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
