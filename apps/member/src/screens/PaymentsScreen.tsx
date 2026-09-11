import { useCallback } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { renderTemplate } from '@gymflow/i18n';
import { api } from '../lib/api';
import { memberDate } from '../lib/format';
import { useResource } from '../lib/use-resource';
import { ErrorState } from '../components/ErrorState';
import { useAuth } from '../lib/auth';
import { Card, EmptyNote, Loading, Muted, OfflineBanner, Screen } from '../components/ui';
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
  // Two decimals always, matching the admin app's formatMoney and the printed
  // receipt. Without them 250050 paise rendered as "₹2,500.5", which a member
  // comparing the app against their receipt reads as a different number.
  return `₹${(Number(minor) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PaymentsScreen() {
  const { t } = useAuth();
  const {
    data: rows,
    stale,
    failed,
    loading,
    reload,
  } = useResource<PaymentRow[]>(
    useCallback(async () => {
      const r = await api.payments();
      return { data: r.data.payments, stale: r.stale };
    }, []),
  );

  if (loading && !rows) return <Loading />;
  if (failed || !rows) {
    return (
      <ErrorState message={t.common.loadFailed} retryLabel={t.common.retry} onRetry={reload} />
    );
  }

  return (
    <Screen>
      {stale ? <OfflineBanner text={t.common.offline} /> : null}
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <EmptyNote title={t.member.noPayments} hint={t.member.noPaymentsHint} />
        }
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <View style={styles.details}>
              {/* The API has always sent `status`; the screen never showed it,
                  so a refunded payment appeared to the member as money the gym
                  still holds. */}
              <Text
                style={[styles.amount, item.status === 'refunded' ? styles.amountRefunded : null]}
              >
                {rupees(item.amount)}
              </Text>
              <Muted>
                {renderTemplate(t.member.paidOn, { date: memberDate(item.payment_date, t) })} ·{' '}
                {t.payments.methods[item.method as keyof typeof t.payments.methods] ?? item.method}
              </Muted>
              {item.status === 'refunded' || item.status === 'partially_refunded' ? (
                <Text style={styles.refundNote}>
                  {item.status === 'refunded' ? t.member.refunded : t.member.partlyRefunded}
                </Text>
              ) : null}
            </View>
            {item.receipt_number ? <Text style={styles.receipt}>{item.receipt_number}</Text> : null}
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  details: { flexShrink: 1 },
  amountRefunded: { textDecorationLine: 'line-through', color: theme.color.textMuted },
  refundNote: { marginTop: 2, fontSize: 12, fontWeight: '700', color: theme.color.danger },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: 17, fontWeight: '700', color: theme.color.text },
  receipt: { fontSize: 12, color: theme.color.textMuted, fontVariant: ['tabular-nums'] },
});
