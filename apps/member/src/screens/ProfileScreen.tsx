import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { LANGUAGES } from '@gymflow/i18n';
import { API_BASE_URL, api, type MeResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Muted, PrimaryButton, Title } from '../components/ui';
import { theme } from '../lib/theme';

export function ProfileScreen() {
  const { t, language, setLanguage, signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [offers, setOffers] = useState<{ code: string; name: string; valid_to: string }[]>([]);
  const [notifications, setNotifications] = useState<
    { id: string; rendered_body: string; created_at: string }[]
  >([]);

  useEffect(() => {
    api
      .me()
      .then((r) => setMe(r.data))
      .catch(() => null);
    api
      .offers()
      .then((r) => setOffers(r.data.offers))
      .catch(() => null);
    api
      .notifications()
      .then((r) => setNotifications(r.data.notifications))
      .catch(() => null);
  }, []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {me ? (
        <Card>
          <Title>
            {me.member.firstName} {me.member.lastName ?? ''}
          </Title>
          <Muted>
            #{me.member.membershipNumber} · {me.member.branchName}
          </Muted>
        </Card>
      ) : null}

      <Card>
        <Text style={styles.label}>{t.common.language}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.tag}
              onPress={() => setLanguage(lang.tag)}
              style={[styles.langChip, language === lang.tag && styles.langChipActive]}
            >
              <Text style={[styles.langText, language === lang.tag && styles.langTextActive]}>
                {lang.nativeLabel}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </Card>

      {notifications.length > 0 ? (
        <Card>
          <Text style={styles.label}>{t.common.notifications}</Text>
          {notifications.slice(0, 10).map((n) => (
            <Text key={n.id} style={styles.offer}>
              {n.rendered_body}
            </Text>
          ))}
        </Card>
      ) : null}

      {offers.length > 0 ? (
        <Card>
          <Text style={styles.label}>{t.nav.promotions}</Text>
          {offers.map((o) => (
            <Text key={o.code} style={styles.offer}>
              {o.name} · <Text style={styles.code}>{o.code}</Text>
            </Text>
          ))}
        </Card>
      ) : null}

      {me?.gym.supportWhatsapp ? (
        <Card>
          <Text style={styles.label}>{me.gym.name}</Text>
          <Pressable
            onPress={() =>
              Linking.openURL(`https://wa.me/${me.gym.supportWhatsapp!.replace('+', '')}`)
            }
          >
            <Text style={styles.link}>
              {t.members.whatsapp}: {me.gym.supportWhatsapp}
            </Text>
          </Pressable>
        </Card>
      ) : null}

      {/*
        Both stores require the privacy policy to be reachable from inside the
        app, not only from the store listing. It is served from the same origin
        as the API, so a white-label build points at its own operator's copy
        with no code change.
      */}
      <Pressable
        accessibilityRole="link"
        onPress={() => Linking.openURL(`${API_BASE_URL}/privacy`)}
        style={styles.policyRow}
      >
        <Text style={styles.link}>{t.account.privacyPolicy}</Text>
      </Pressable>

      <PrimaryButton label={t.common.signOut} onPress={() => signOut()} />

      {/*
        Required by Apple guideline 5.1.1(v) and Google Play: an app with
        accounts must let the member delete theirs from inside the app. The
        wording is deliberate — the gym must keep payment records by law, so
        we promise only what we actually do.
      */}
      <Pressable
        accessibilityRole="button"
        disabled={deleting}
        onPress={() =>
          Alert.alert(t.account.deleteTitle, t.account.deleteExplain, [
            { text: t.common.cancel, style: 'cancel' },
            {
              text: t.account.deleteConfirm,
              style: 'destructive',
              onPress: async () => {
                setDeleting(true);
                try {
                  await api.deleteAccount();
                  Alert.alert(t.account.deletedTitle, t.account.deletedBody);
                } catch {
                  Alert.alert(t.common.error);
                } finally {
                  setDeleting(false);
                  await signOut();
                }
              },
            },
          ])
        }
        style={styles.deleteBtn}
      >
        <Text style={styles.deleteText}>{deleting ? t.common.loading : t.account.deleteTitle}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  policyRow: { paddingVertical: 12, minHeight: theme.touchTarget },
  scroll: { flex: 1, backgroundColor: theme.color.surfaceMuted },
  content: { padding: theme.spacing.md, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: theme.color.textMuted, marginBottom: 8 },
  deleteBtn: { marginTop: theme.spacing.md, alignItems: 'center', paddingVertical: 12 },
  deleteText: { color: theme.color.danger, fontSize: 14, fontWeight: '600' },
  langChip: {
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
  },
  langChipActive: { backgroundColor: theme.color.primary, borderColor: theme.color.primary },
  langText: { fontSize: 14, color: theme.color.text },
  langTextActive: { color: '#fff', fontWeight: '700' },
  offer: { fontSize: 14, color: theme.color.text, marginBottom: 4 },
  code: { fontWeight: '700', color: theme.color.primaryDark },
  link: { fontSize: 14, color: theme.color.info },
});
