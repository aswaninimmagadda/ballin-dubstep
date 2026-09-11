import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { PRODUCT } from '@gymflow/config';
import type { TranslationTree } from '@gymflow/i18n';
import { useAuth } from '../lib/auth';
import { ApiError, NetworkError } from '../lib/api';
import { PrimaryButton } from '../components/ui';
import { LanguagePicker } from '../components/LanguagePicker';
import { theme } from '../lib/theme';

/**
 * Turn a failed sign-in into something a member can act on.
 *
 * Every failure except a lockout used to collapse to "Something went wrong.
 * Please try again." — a member whose gym had never switched the app on for
 * them, a member whose gym's own subscription had lapsed, and a member
 * standing in a basement with no signal all read the same sentence, and none
 * of them could do anything with it.
 *
 * What this deliberately does NOT do is distinguish "no such member" from
 * "wrong password". The login route pays the same scrypt cost either way so
 * that the endpoint cannot be used to find out who is a member of a gym, and
 * a friendlier message here would hand that back.
 */
function signInMessage(err: unknown, t: TranslationTree): string {
  if (err instanceof NetworkError) return t.member.errOffline;
  if (!(err instanceof ApiError)) return t.member.errServer;
  switch (err.code) {
    case 'gym_not_found':
      return t.member.errGymNotFound;
    case 'locked':
      return t.member.errLocked;
    case 'account_unavailable':
      return t.member.errAccountUnavailable;
    case 'invalid_credentials':
      return t.member.errCredentials;
    default:
      // invalid_input / invalid_json are our own bugs, and a 5xx is the
      // gym's server. Neither is the member's to fix.
      return err.status >= 500 ? t.member.errServer : t.member.errCredentials;
  }
}

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
      setError(signInMessage(err, t));
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
        <Text style={styles.sub}>{t.member.signInHint}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder={t.member.gymCode}
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
        <Text style={styles.hint}>{t.member.gymCodeHint}</Text>
        <PrimaryButton
          label={busy ? t.common.loading : t.auth.signIn}
          onPress={submit}
          disabled={busy || !gymCode || !mobile || password.length < 6}
        />
      </View>
      {/* Below the card, not inside it: a member who cannot read the form
          needs to find this without reading the form. */}
      <View style={styles.langWrap}>
        <LanguagePicker compact />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.color.surfaceMuted,
    justifyContent: 'center',
    padding: 24,
  },
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
  hint: { fontSize: 12, color: theme.color.textMuted, marginTop: -4, marginBottom: 12 },
  langWrap: { marginTop: 20, alignItems: 'center' },
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
