import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { PRODUCT } from '@gymflow/config';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { PrimaryButton } from '../components/ui';
import { theme } from '../lib/theme';

export function LoginScreen() {
  const { signIn, t } = useAuth();
  const [gymCode, setGymCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(gymCode.trim(), mobile.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'locked') setError(t.auth.accountLocked);
      else if (err instanceof ApiError && err.status === 401) setError(t.auth.invalidCredentials);
      else setError(t.common.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.box}>
        <Text style={styles.logo}>{PRODUCT.name}</Text>
        <Text style={styles.sub}>{t.auth.signIn}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder="Gym code (e.g. apfitness)"
          autoCapitalize="none"
          autoCorrect={false}
          value={gymCode}
          onChangeText={setGymCode}
        />
        <TextInput
          style={styles.input}
          placeholder={t.members.mobile}
          keyboardType="phone-pad"
          value={mobile}
          onChangeText={setMobile}
        />
        <TextInput
          style={styles.input}
          placeholder={t.auth.password}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <PrimaryButton
          label={busy ? t.common.loading : t.auth.signIn}
          onPress={submit}
          disabled={busy || !gymCode || !mobile || password.length < 6}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.surfaceMuted, justifyContent: 'center', padding: 24 },
  box: {
    backgroundColor: '#fff',
    borderRadius: theme.radius.lg,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  logo: { fontSize: 28, fontWeight: '800', color: theme.color.primary, textAlign: 'center' },
  sub: { fontSize: 14, color: theme.color.textMuted, textAlign: 'center', marginBottom: 16 },
  error: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    minHeight: theme.touchTarget,
    paddingHorizontal: 12,
    marginBottom: 12,
    fontSize: 16,
  },
});
