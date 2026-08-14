import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Loading, Muted, OfflineBanner, Screen } from '../components/ui';
import { theme } from '../lib/theme';

interface Visit {
  checked_in_at: string;
  method: string;
}

export function AttendanceScreen() {
  const { t } = useAuth();
  const [rows, setRows] = useState<Visit[] | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    api
      .attendance()
      .then((r) => {
        setRows(r.data.attendance);
        setStale(r.stale);
      })
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <Loading />;

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
