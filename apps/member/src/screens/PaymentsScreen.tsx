import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Loading, Muted, OfflineBanner, Screen } from '../components/ui';
import { theme } from '../lib/theme';

interface PaymentRow {
  id: string;
  amount: string;
  method: string;
  status: string;
  payment_date: string;
  receipt_number: string | null;
}

function rupees(minor: string): string {
  const n = Number(minor) / 100;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function PaymentsScreen() {
  const { t } = useAuth();
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    api
      .payments()
      .then((r) => {
        setRows(r.data.payments);
        setStale(r.stale);
      })
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <Loading />;

  return (
    <Screen>
      {stale ? <OfflineBanner text={t.common.offline} /> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Muted>—</Muted>}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <View>
              <Text style={styles.amount}>{rupees(item.amount)}</Text>
              <Muted>
                {item.payment_date} ·{' '}
                {t.payments.methods[item.method as keyof typeof t.payments.methods] ?? item.method}
              </Muted>
            </View>
            {item.receipt_number ? <Text style={styles.receipt}>{item.receipt_number}</Text> : null}
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: 17, fontWeight: '700', color: theme.color.text },
  receipt: { fontSize: 12, color: theme.color.textMuted, fontVariant: ['tabular-nums'] },
});
