import { useCallback } from 'react';
import { FlatList, StyleSheet, Text } from 'react-native';
import { api } from '../lib/api';
import { useResource } from '../lib/use-resource';
import { ErrorState } from '../components/ErrorState';
import { useAuth } from '../lib/auth';
import { Card, Loading, Muted, OfflineBanner, Screen } from '../components/ui';
import { theme } from '../lib/theme';

interface Visit {
  checked_in_at: string;
  method: string;
}

export function AttendanceScreen() {
  const { t } = useAuth();
  const {
    data: attendance,
    stale,
    failed,
    loading,
    reload,
  } = useResource<Visit[]>(
    useCallback(async () => {
      const r = await api.attendance();
      return { data: r.data.attendance, stale: r.stale };
    }, []),
  );

  if (loading && !attendance) return <Loading />;
  if (failed || !attendance) {
    return (
      <ErrorState message={t.common.loadFailed} retryLabel={t.common.retry} onRetry={reload} />
    );
  }
  const rows = attendance;

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthCount = rows.filter((r) => r.checked_in_at.startsWith(thisMonth)).length;

  return (
    <Screen>
      {stale ? <OfflineBanner text={t.common.offline} /> : null}
      <Card>
        <Text style={styles.big}>{monthCount}</Text>
        <Muted>{t.attendance.title}</Muted>
      </Card>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.checked_in_at}
        ListEmptyComponent={<Muted>—</Muted>}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <Text style={styles.when}>
              {new Date(item.checked_in_at).toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
            <Muted>{item.method}</Muted>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 36, fontWeight: '800', color: theme.color.primaryDark },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  when: { fontSize: 15, color: theme.color.text },
});
