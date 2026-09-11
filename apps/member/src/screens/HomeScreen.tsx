import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { renderTemplate, type TranslationTree } from '@gymflow/i18n';
import { api, getPass, type MeResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
import { memberDate } from '../lib/format';
import { ErrorState } from '../components/ErrorState';
import { Card, Loading, Muted, OfflineBanner, StatusBadge, Title } from '../components/ui';
import { theme } from '../lib/theme';

/**
 * The one line on the card that tells a member where they stand.
 *
 * It used to be "days remaining" or, the moment that number went negative,
 * the check-in desk's "Membership expired — please renew." A member inside
 * their gym's grace period is not expired: they can still train, which is
 * the entire point of a grace period — and the badge right above this line
 * already said "Grace period". The card contradicted itself, and the half a
 * member was likelier to believe was the wrong half.
 */
function MembershipNote({
  membership,
  t,
}: {
  membership: NonNullable<MeResponse['membership']>;
  t: TranslationTree;
}) {
  if (membership.status === 'grace_period') {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>{t.member.graceTitle}</Text>
        <Text style={styles.noteBody}>
          {renderTemplate(t.member.graceBody, {
            ended: memberDate(membership.endDate, t),
            until: memberDate(membership.graceEndDate ?? membership.endDate, t),
          })}
        </Text>
      </View>
    );
  }
  if (membership.status === 'expired' || membership.status === 'cancelled') {
    return (
      <View style={styles.note}>
        <Text style={[styles.noteTitle, { color: theme.color.danger }]}>
          {t.member.expiredTitle}
        </Text>
        <Text style={styles.noteBody}>{t.member.expiredBody}</Text>
      </View>
    );
  }
  if (membership.status === 'pending') {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>
          {renderTemplate(t.member.startsOnTitle, {
            date: memberDate(membership.startDate, t),
          })}
        </Text>
        <Text style={styles.noteBody}>{t.member.startsOnBody}</Text>
      </View>
    );
  }
  if (membership.status === 'frozen') {
    // A paused membership has no meaningful countdown: the days stopped
    // running, and its end date is usually pushed out when it resumes. It
    // used to fall through to the branch below and show "-5 days left" for
    // anything frozen past its original expiry.
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>{t.member.frozenTitle}</Text>
        <Text style={styles.noteBody}>{t.member.frozenBody}</Text>
      </View>
    );
  }
  // Active or ending soon: how long is left, counted in days a member would
  // count them.
  const left = membership.daysRemaining;
  const text =
    left === 0
      ? t.member.endsToday
      : left === 1
        ? t.member.endsTomorrow
        : renderTemplate(t.member.daysLeft, { days: String(left) });
  return <Text style={styles.days}>{text}</Text>;
}

export function HomeScreen() {
  const { t, setBrandColor, setFeatures } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [stale, setStale] = useState(false);
  const [pass, setPass] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.me();
      setMe(result.data);
      setStale(result.stale);
      setFailed(false);
      // The gym's own colour, which the API has always sent and the app has
      // never used. Cached by the provider so it is on screen at first paint
      // next time.
      setBrandColor(result.data.gym?.primaryColor ?? null);
      // Which tabs this gym's members should see at all.
      setFeatures(
        result.data.features
          ? {
              attendance: result.data.features.attendance !== false,
              pt: result.data.features.pt !== false,
            }
          : undefined,
      );
    } catch {
      // Only fatal when there is nothing to show. A refresh that fails must
      // not blank out the membership card the member is holding up at the desk
      // — but a FIRST load that fails used to leave `me` null forever behind
      // an endless spinner, with no error and no way out.
      setMe((current) => {
        if (current === null) setFailed(true);
        return current;
      });
    } finally {
      setLoading(false);
    }
    const p = await getPass();
    setPass(p?.token ?? null);
  }, [setBrandColor, setFeatures]);

  // Keep the displayed pass inside its validity window. The timer only runs
  // while the app is awake, and Android freezes backgrounded processes — so
  // the pass is also refetched whenever the member unlocks the phone, which
  // is exactly what happens between the car park and the reception desk.
  const refreshPass = useCallback(async () => {
    const p = await getPass();
    if (p) {
      setPass(p.token);
      rotateSeconds.current = p.rotatesInSeconds;
    }
  }, []);
  const rotateSeconds = useRef(60);

  useEffect(() => {
    load();
    const timer = setInterval(
      refreshPass,
      // A little early, so the code on screen is never the expiring one.
      Math.max(10, rotateSeconds.current - 10) * 1000,
    );
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPass();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [load, refreshPass]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading && !me) return <Loading />;
  if (failed || !me) {
    return <ErrorState message={t.common.loadFailed} retryLabel={t.common.retry} onRetry={load} />;
  }
  const membership = me.membership;
  const statusLabel = membership
    ? (t.member.status[membership.status as keyof typeof t.member.status] ?? membership.status)
    : t.member.status.expired;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {stale ? <OfflineBanner text={t.common.offline} /> : null}

      <Card>
        <Muted>
          {me.gym.name} · {me.member.branchName}
        </Muted>
        <Title>
          {me.member.firstName} {me.member.lastName ?? ''}
        </Title>
        <View style={styles.row}>
          <StatusBadge status={membership?.status ?? 'expired'} label={statusLabel} />
          <Muted>
            {t.member.memberId} {me.member.membershipNumber}
          </Muted>
        </View>
      </Card>

      {membership ? (
        <Card>
          <Text style={styles.plan}>{membership.planName}</Text>
          <Muted>
            {renderTemplate(t.member.validUntil, { date: memberDate(membership.endDate, t) })}
          </Muted>
          <MembershipNote membership={membership} t={t} />
        </Card>
      ) : (
        <Card>
          <Text style={styles.plan}>{t.member.noMembershipTitle}</Text>
          <Muted>{t.member.noMembershipBody}</Muted>
          {me.gym.supportPhone ? <Muted>{me.gym.supportPhone}</Muted> : null}
        </Card>
      )}

      <Card style={styles.qrCard}>
        {pass ? (
          <>
            <QRCode value={pass} size={200} />
            <Muted>{t.member.showAtDesk}</Muted>
          </>
        ) : (
          <Muted>{t.common.offline}</Muted>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.color.surfaceMuted },
  content: { padding: theme.spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  plan: { fontSize: 18, fontWeight: '700', color: theme.color.text },
  days: { fontSize: 15, fontWeight: '600', color: theme.color.primaryDark, marginTop: 6 },
  qrCard: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  note: { marginTop: 8, gap: 2 },
  noteTitle: { fontSize: 15, fontWeight: '700', color: theme.color.text },
  noteBody: { fontSize: 14, color: theme.color.textMuted, lineHeight: 20 },
});
