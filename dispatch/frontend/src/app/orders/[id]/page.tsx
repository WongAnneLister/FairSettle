'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery, useSubscription, useMutation } from '@apollo/client';
import {
  ArrowLeft,
  Store,
  Bike,
  Clock,
  RefreshCw,
  Sparkles,
  PhoneCall,
  ChefHat,
  PackageCheck,
} from 'lucide-react';
import { GET_ORDER_QUERY } from '@/lib/graphql/queries';
import { ORDER_UPDATES_SUBSCRIPTION } from '@/lib/graphql/subscriptions';
import { EDIT_ORDER_MUTATION, TAKE_ORDER_MUTATION } from '@/lib/graphql/mutations';
import { DeliveryFailureReason, Order, OrderStatus, UserRole } from '@/lib/types';
import { DELIVERY_FAILURE_REASONS, ORDER_STATUS_LABELS, markFailedInput, quickActionsFor } from '@/lib/order-actions';
import { formatCents } from '@/lib/currency';
import { OrderPaymentCard } from '@/components/order/order-payment-card';
import { OrderTimeline } from '@/components/order/order-timeline';
import { OrderStatusBadge } from '@/components/order/order-status-badge';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';

function OrderDetail() {
  const params = useParams();
  const searchParams = useSearchParams();
  const autoPay = searchParams.get('pay') === '1';
  const canceled = searchParams.get('payment') === 'canceled';
  const orderId = parseInt(params.id as string, 10);
  const { user } = useAuth();
  const { success, error } = useToast();

  // Polling query fallback
  const { data, loading, refetch } = useQuery(GET_ORDER_QUERY, {
    variables: { input: { id: orderId } },
    pollInterval: 4000,
    fetchPolicy: 'network-only',
  });

  // WebSocket real-time subscription
  const { data: subData } = useSubscription(ORDER_UPDATES_SUBSCRIPTION, {
    variables: { input: { id: orderId } },
  });

  // Status mutation helpers
  const [editOrder, { loading: updating }] = useMutation(EDIT_ORDER_MUTATION);
  const [takeOrder, { loading: claiming }] = useMutation(TAKE_ORDER_MUTATION);

  const rawOrder: Order | undefined = subData?.orderUpdates || data?.getOrder?.order;

  const order = rawOrder;

  if (loading && !data && !rawOrder) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <Spinner className="w-8 h-8 text-brand-500" />
        <p className="text-xs text-slate-400">Connecting to order updates…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="glass-card rounded-3xl p-8 mx-auto my-8 max-w-lg text-center flex flex-col items-center gap-4">
        <p className="font-bold text-slate-900">Order not found or access denied</p>
        <Link href="/orders" className="text-brand-600 font-semibold">Back to my orders</Link>
      </div>
    );
  }

  const actions = quickActionsFor(order, user);
  const isCustomer = user?.role === UserRole.Client && order.customer?.id === user.id;

  const handleAdvanceStatus = async (nextStatus: OrderStatus, reason?: DeliveryFailureReason) => {
    try {
      const res = await editOrder({
        variables: {
          input: reason ? markFailedInput(order.id, reason) : {
            id: order.id,
            status: nextStatus,
          },
        },
      });
      if (res.data.editOrder.ok) {
        success('Order updated', `Order moved to ${ORDER_STATUS_LABELS[nextStatus]}`);
        refetch();
      } else {
        error('Not allowed', res.data.editOrder.error || "You can't make this change.");
      }
    } catch (e: any) {
      error('Not allowed', e.message || "You can't make this change.");
    }
  };

  const handleTakeOrder = async () => {
    try {
      const res = await takeOrder({
        variables: { input: { id: order.id } },
      });
      if (res.data.takeOrder.ok) {
        success('Order claimed', 'You are now the driver for this order.');
        refetch();
      } else {
        error('Claim failed', res.data.takeOrder.error || 'Another driver took it first.');
      }
    } catch (e: any) {
      error('Claim failed', e.message || 'Another driver took it first.');
    }
  };


  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/orders"
            className="p-2 rounded-2xl glass-pill text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                Order #{order.id}
              </h1>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 px-3 py-0.5 rounded-full backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>Live</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Placed at {new Date(order.createdAt || Date.now()).toLocaleTimeString('en-US')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5 glass-pill"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh status</span>
          </Button>
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      <OrderPaymentCard
        order={order}
        isCustomer={isCustomer}
        autoPay={autoPay}
        canceled={canceled}
        onRefreshed={() => refetch()}
      />

      {/* Visual Step Progress Frosted Glass Card */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-white/90 shadow-[0_20px_50px_0_rgba(15,23,42,0.06)] flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Order progress
          </span>
          <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Estimated arrival in 15–20 minutes
          </span>
        </div>

        <OrderTimeline status={order.status} />

        {/* Dynamic status alert box */}
        <div className="p-4 rounded-2xl glass-card flex items-center justify-between text-xs border border-white/90">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-brand-500/10 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-brand-500" />
            </div>
            <span className="text-slate-700 font-medium">
              {order.status === OrderStatus.Pending && 'The restaurant has your order and will start cooking soon.'}
              {order.status === OrderStatus.Cooking && 'The kitchen is preparing your food.'}
              {order.status === OrderStatus.Cooked && 'Your food is ready and waiting for a driver.'}
              {order.status === OrderStatus.PickedUp && 'Your driver has picked up your food and is on the way.'}
              {order.status === OrderStatus.Delivered && 'Delivered. Enjoy your meal!'}
              {order.status === OrderStatus.DeliveryFailed && 'This delivery failed. Our support team has been notified.'}
            </span>
          </div>
        </div>

        {/* Role Quick Simulation Controls */}
        {actions.length > 0 && (
          <div className="pt-3 border-t border-slate-200/50 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-slate-400 font-medium text-[11px]">Demo controls</span>
            <div className="flex flex-wrap items-center gap-2">
              {actions.includes('startCooking') && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={updating}
                  onClick={() => handleAdvanceStatus(OrderStatus.Cooking)}
                  className="gap-1 glass-pill border-brand-200 text-brand-700 hover:bg-brand-50"
                >
                  <ChefHat className="w-3.5 h-3.5 text-brand-500" />
                  Start cooking
                </Button>
              )}

              {actions.includes('finishCooking') && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={updating}
                  onClick={() => handleAdvanceStatus(OrderStatus.Cooked)}
                  className="gap-1 glass-pill border-blue-200 text-blue-700 hover:bg-blue-50"
                >
                  <ChefHat className="w-3.5 h-3.5 text-blue-500" />
                  Mark ready
                </Button>
              )}

              {actions.includes('takeOrder') && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={claiming}
                  onClick={handleTakeOrder}
                  className="gap-1 glass-pill border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                >
                  <Bike className="w-3.5 h-3.5 text-emerald-500" />
                  Claim order
                </Button>
              )}

              {actions.includes('pickUp') && (
                <Button
                  variant="outline"
                  size="sm"
                  loading={updating}
                  onClick={() => handleAdvanceStatus(OrderStatus.PickedUp)}
                  className="gap-1 glass-pill border-purple-200 text-purple-700 hover:bg-purple-50"
                >
                  <Bike className="w-3.5 h-3.5 text-purple-500" />
                  Picked up
                </Button>
              )}

              {actions.includes('deliver') && (
                <Button
                  variant="emerald"
                  size="sm"
                  loading={updating}
                  onClick={() => handleAdvanceStatus(OrderStatus.Delivered)}
                  className="gap-1.5"
                >
                  <PackageCheck className="w-3.5 h-3.5" />
                  Delivered
                </Button>
              )}
              {actions.includes('markFailed') && DELIVERY_FAILURE_REASONS.map(({ value, label }) => (
                <Button
                  key={value}
                  variant="danger"
                  size="sm"
                  loading={updating}
                  onClick={() => handleAdvanceStatus(OrderStatus.DeliveryFailed, value)}
                  className="gap-1.5"
                >
                  Failed: {label.toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Driver Card if assigned */}
        <div className="glass-card rounded-3xl p-6 flex flex-col justify-between gap-4 border border-white/90">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Driver details
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Bike className="w-4 h-4" />
            </div>
          </div>

          {order.driver ? (
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white font-black text-sm flex items-center justify-center shadow-md shadow-emerald-500/20">
                {order.driver.email.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-slate-900">
                  Delivery driver
                </h4>
                <p className="text-xs text-slate-400 truncate">{order.driver.email}</p>
                <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                  Identity and health checks completed
                </p>
              </div>
              <button className="p-2.5 rounded-2xl glass-pill text-slate-600 hover:text-emerald-600 transition-colors">
                <PhoneCall className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="py-2 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-2xl glass-pill flex items-center justify-center text-slate-300">
                <Bike className="w-5 h-5" />
              </div>
              <p>A driver can claim your order when the food is ready.</p>
            </div>
          )}
        </div>

        {/* Restaurant Card */}
        <div className="glass-card rounded-3xl p-6 flex flex-col justify-between gap-4 border border-white/90">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Restaurant
            </span>
            <div className="w-8 h-8 rounded-xl bg-brand-500/10 text-brand-600 flex items-center justify-center">
              <Store className="w-4 h-4" />
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden border border-white/90">
              <Store className="w-6 h-6 text-brand-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {order.restaurant?.name || 'Restaurant'}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                {order.restaurant?.address || '88 Food Street'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Items Breakdown */}
      <div className="glass-card rounded-3xl p-6 sm:p-7 flex flex-col gap-4 border border-white/90">
        <h3 className="font-bold text-slate-900 text-base">
          Order items
        </h3>

        <div className="divide-y divide-slate-200/50">
          {order.items?.map((item) => (
            <div key={item.id} className="py-3.5 flex justify-between items-start gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {item.dish?.name || 'Dish'}
                </p>
                {item.options && item.options.length > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {item.options
                      .map((o) => `${o.name}: ${o.choice || 'Selected'}`)
                      .join(', ')}
                  </p>
                )}
              </div>
              <span className="text-sm font-bold text-slate-900">
                {formatCents(item.dish?.priceCents)}
              </span>
            </div>
          ))}
        </div>

        <div className="pt-4 border-t border-slate-200/60 flex justify-between items-baseline">
          <span className="text-xs font-semibold text-slate-500">Total paid</span>
          <span className="text-2xl font-black text-brand-600">
            {formatCents(order.totalCents)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  return <Suspense fallback={null}><OrderDetail /></Suspense>;
}
