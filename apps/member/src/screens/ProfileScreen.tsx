import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { LANGUAGES } from '@gymflow/i18n';
import { api, type MeResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Muted, PrimaryButton, Title } from '../components/ui';
import { theme } from '../lib/theme';

export function ProfileScreen() {
  const { t, language, setLanguage, signOut } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [offers, setOffers] = useState<{ code: string; name: string; valid_to: string }[]>([]);

  useEffect(() => {
    api
      .me()
      .then((r) => setMe(r.data))
      .catch(() => null);
    api
      .offers()
      .then((r) => setOffers(r.data.offers))
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

      <PrimaryButton label={t.common.signOut} onPress={() => signOut()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.color.surfaceMuted },
  content: { padding: theme.spacing.md, gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: theme.color.textMuted, marginBottom: 8 },
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
