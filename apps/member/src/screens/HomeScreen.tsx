import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api, getPass, type MeResponse } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  const { t } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [stale, setStale] = useState(false);
  const [pass, setPass] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.me();
      setMe(result.data);
      setStale(result.stale);
    } catch {
      /* keep whatever we have */
    }
    const p = await getPass();
    setPass(p?.token ?? null);
  }, []);

  useEffect(() => {
    load();
    // QR pass rotates every 60s; refresh a little early.
    const timer = setInterval(async () => {
      const p = await getPass();
      if (p) setPass(p.token);
    }, 50_000);
    return () => clearInterval(timer);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!me) return <Loading />;
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
