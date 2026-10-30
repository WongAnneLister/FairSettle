'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMutation } from '@apollo/client';
import { Order } from '@/lib/types';
import { paymentView, rememberCheckoutOrder } from '@/lib/payment';
import { REFRESH_ORDER_PAYMENT_MUTATION } from '@/lib/graphql/mutations';
import { formatCents } from '@/lib/currency';
import { useToast } from '@/lib/toast-context';
import { Button } from '@/components/ui/button';

interface OrderPaymentCardProps {
  order: Order;
  isCustomer: boolean;
  autoPay: boolean;
  canceled: boolean;
  onRefreshed: () => void;
}

const toneClasses = {
  neutral: 'text-slate-700 bg-slate-500/10 border border-slate-500/20',
  waiting: 'text-amber-700 bg-amber-500/10 border border-amber-500/20',
  success: 'text-emerald-700 bg-emerald-500/10 border border-emerald-500/20',
  danger: 'text-rose-700 bg-rose-500/10 border border-rose-500/20',
};

export function OrderPaymentCard({ order, isCustomer, autoPay, canceled, onRefreshed }: OrderPaymentCardProps): JSX.Element | null {
  const view = paymentView(order);
  const { error } = useToast();
  const [refreshOrderPayment, { loading }] = useMutation(REFRESH_ORDER_PAYMENT_MUTATION);
  const autoPayStarted = useRef(false);
  const mountRefreshed = useRef(false);
  const refreshing = useRef(false);

  const goToPayPal = () => {
    if (!view?.canPay || !order.checkoutUrl) return;
    rememberCheckoutOrder(window.localStorage, order.id);
    window.history.replaceState(null, '', `/orders/${order.id}`);
    window.location.assign(order.checkoutUrl);
  };

  useEffect(() => {
    if (autoPay && isCustomer && view?.canPay && !autoPayStarted.current) {
      autoPayStarted.current = true;
      goToPayPal();
    }
  }, [autoPay, isCustomer, view?.canPay]);

  const refresh = useCallback(async () => {
    if (!isCustomer || !view?.canRefresh || refreshing.current) return;
    refreshing.current = true;
    try {
      const { data } = await refreshOrderPayment({ variables: { input: { orderId: order.id } } });
      const result = data?.refreshOrderPayment;
      if (result?.ok) {
        onRefreshed();
      } else {
        error('暂时无法确认付款状态', `请稍后再试（${result?.code ?? 'UNKNOWN'}）`);
      }
    } catch {
      error('暂时无法确认付款状态', '请稍后再试（NETWORK）');
    } finally {
      refreshing.current = false;
    }
  }, [isCustomer, view?.canRefresh, order.id, refreshOrderPayment, onRefreshed, error]);

  // On a fresh load the order can arrive before the signed-in user: wait until the customer can refresh.
  useEffect(() => {
    if (!autoPay && isCustomer && view?.canRefresh && !mountRefreshed.current) {
      mountRefreshed.current = true;
      void refresh();
    }
  }, [autoPay, isCustomer, view?.canRefresh, refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refresh]);

  if (!view) return null;

  return (
    <div className="glass-card rounded-3xl p-6 border border-white/90 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-slate-900">PayPal 付款</h2>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${toneClasses[view.tone]}`}>
          {view.label}
        </span>
      </div>
      <p className="text-sm text-slate-600">金额 {formatCents(order.totalCents ?? 0)}（PayPal 沙盒）</p>
      {canceled && (
        <p className="text-sm text-amber-700">您已取消 PayPal 付款，可以随时重新前往付款。</p>
      )}
      {isCustomer && view.canPay && (
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={goToPayPal}>前往 PayPal 付款</Button>
          <Button variant="secondary" onClick={() => void refresh()} loading={loading}>
            我已完成付款，刷新状态
          </Button>
        </div>
      )}
    </div>
  );
}
