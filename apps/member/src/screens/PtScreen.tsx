import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Loading, Muted, OfflineBanner, StatusBadge } from '../components/ui';
import { theme } from '../lib/theme';

type PtData = Awaited<ReturnType<typeof api.pt>>['data'];

export function PtScreen() {
  const { t } = useAuth();
  const [data, setData] = useState<PtData | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    api
      .pt()
      .then((r) => {
        setData(r.data);
        setStale(r.stale);
      })
      .catch(() => setData({ addons: [], sessions: [] }));
  }, []);

  if (!data) return <Loading />;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {stale ? <OfflineBanner text={t.common.offline} /> : null}
      {data.addons.length === 0 ? (
        <Card>
          <Muted>—</Muted>
        </Card>
      ) : (
        data.addons.map((a) => (
          <Card key={a.id}>
            <Text style={styles.name}>{a.name_snapshot}</Text>
            {a.trainer_name ? <Muted>{t.members.trainer}: {a.trainer_name}</Muted> : null}
            {a.sessions_total != null ? (
              <Text style={styles.sessions}>
                {a.sessions_used} / {a.sessions_total}
              </Text>
            ) : null}
            <Muted>
              {a.start_date} → {a.end_date}
            </Muted>
            <StatusBadge status={a.state} label={a.state} />
          </Card>
        ))
      )}
      {data.sessions.map((s, i) => (
        <Card key={`${s.session_date}-${i}`} style={styles.sessionRow}>
          <Text style={styles.when}>
            {s.session_date} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
          </Text>
          <Muted>
            {s.trainer_name ?? ''} · {s.status}
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
