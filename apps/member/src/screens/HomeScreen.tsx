import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api, getPass, type MeResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState } from '../components/ErrorState';
import { Card, Loading, Muted, OfflineBanner, StatusBadge, Title } from '../components/ui';
import { theme } from '../lib/theme';

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${d}-${months[Number(m) - 1]}-${y}`;
}

export function HomeScreen() {
  const { t, setBrandColor } = useAuth();
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
  }, [setBrandColor]);

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
    ? (t.membership.statuses[membership.status as keyof typeof t.membership.statuses] ??
      membership.status)
    : t.members.statuses.expired;

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
          <Muted>#{me.member.membershipNumber}</Muted>
        </View>
      </Card>

      {membership ? (
        <Card>
          <Text style={styles.plan}>{membership.planName}</Text>
          <Muted>
            {formatDate(membership.startDate)} → {formatDate(membership.endDate)}
          </Muted>
          {membership.daysRemaining >= 0 ? (
            <Text style={styles.days}>
              {membership.daysRemaining} {t.members.daysRemaining}
            </Text>
          ) : (
            <Text style={[styles.days, { color: theme.color.danger }]}>
              {t.attendance.memberExpired}
            </Text>
          )}
        </Card>
      ) : (
        <Card>
          <Text style={styles.days}>{t.attendance.memberExpired}</Text>
          {me.gym.supportPhone ? <Muted>{me.gym.supportPhone}</Muted> : null}
        </Card>
      )}

      <Card style={styles.qrCard}>
        {pass ? (
          <>
            <QRCode value={pass} size={200} />
            <Muted>{t.attendance.scanQr}</Muted>
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
});
