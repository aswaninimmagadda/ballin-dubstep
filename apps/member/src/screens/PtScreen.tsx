import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { renderTemplate } from '@gymflow/i18n';
import { api } from '../lib/api';
import { memberDate } from '../lib/format';
import { useResource } from '../lib/use-resource';
import { ErrorState } from '../components/ErrorState';
import { useAuth } from '../lib/auth';
import { Card, Loading, Muted, OfflineBanner, StatusBadge, EmptyNote } from '../components/ui';
import { theme } from '../lib/theme';

type PtData = Awaited<ReturnType<typeof api.pt>>['data'];

export function PtScreen() {
  const { t } = useAuth();
  const { data, stale, failed, loading, reload } = useResource<PtData>(
    useCallback(async () => {
      const r = await api.pt();
      return { data: r.data, stale: r.stale };
    }, []),
  );

  if (loading && !data) return <Loading />;
  if (failed || !data) {
    return (
      <ErrorState message={t.common.loadFailed} retryLabel={t.common.retry} onRetry={reload} />
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {stale ? <OfflineBanner text={t.common.offline} /> : null}
      {data.addons.length === 0 ? (
        <EmptyNote title={t.member.noPt} hint={t.member.noPtHint} />
      ) : (
        data.addons.map((a) => (
          <Card key={a.id}>
            <Text style={styles.name}>{a.name_snapshot}</Text>
            {a.trainer_name ? (
              <Muted>{renderTemplate(t.member.withTrainer, { trainer: a.trainer_name })}</Muted>
            ) : null}
            {a.sessions_total != null ? (
              <Text style={styles.sessions}>
                {renderTemplate(t.member.sessionsUsed, {
                  used: String(a.sessions_used),
                  total: String(a.sessions_total),
                })}
              </Text>
            ) : null}
            <Muted>
              {memberDate(a.start_date, t)} → {memberDate(a.end_date, t)}
            </Muted>
            <StatusBadge
              status={a.state}
              label={t.member.packState[a.state as keyof typeof t.member.packState] ?? a.state}
            />
          </Card>
        ))
      )}
      {data.sessions.map((s, i) => (
        <Card key={`${s.session_date}-${i}`} style={styles.sessionRow}>
          <Text style={styles.when}>
            {memberDate(s.session_date, t)} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
          </Text>
          <Muted>
            {s.trainer_name ? `${s.trainer_name} · ` : ''}
            {t.member.sessionStatus[s.status as keyof typeof t.member.sessionStatus] ?? s.status}
          </Muted>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.color.surfaceMuted },
  content: { padding: theme.spacing.md },
  name: { fontSize: 17, fontWeight: '700', color: theme.color.text },
  sessions: { fontSize: 24, fontWeight: '800', color: theme.color.primaryDark, marginVertical: 4 },
  sessionRow: { paddingVertical: 12 },
  when: { fontSize: 15, color: theme.color.text },
});
