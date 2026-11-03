'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useSubscription, useMutation } from '@apollo/client';
import {
  ChefHat,
  Flame,
  Clock,
  CheckCircle,
  Bike,
  PackageCheck,
  Radio,
  RefreshCw,
  ArrowLeft,
  Sparkles,
  AlertCircle,
  Bell,
  UtensilsCrossed,
} from 'lucide-react';
import { GET_ORDERS_QUERY } from '@/lib/graphql/queries';
import { PENDING_ORDERS_SUBSCRIPTION } from '@/lib/graphql/subscriptions';
import { EDIT_ORDER_MUTATION } from '@/lib/graphql/mutations';
import { Order, OrderStatus } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { OrderStatusBadge } from '@/components/order/order-status-badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/lib/toast-context';

export default function KitchenOrdersDispatchPage() {
  const { success, error, info } = useToast();

  const { data, loading, refetch } = useQuery(GET_ORDERS_QUERY, {
    variables: { input: { page: 1 } },
    pollInterval: 3000,
    errorPolicy: 'all',
  });

  // Real-time pending orders subscription
  const { data: pendingData } = useSubscription(PENDING_ORDERS_SUBSCRIPTION);

  const [editOrder, { loading: updating }] = useMutation(EDIT_ORDER_MUTATION);

  useEffect(() => {
    if (pendingData?.pendingOrders) {
      info(
        '🔔 New order received',
        `Order #${pendingData.pendingOrders.id}, total ${formatCents(
          pendingData.pendingOrders.totalCents
        )}`
      );
      refetch();
    }
  }, [pendingData, info, refetch]);

  const orders: Order[] = data?.getOrders?.orders || [];

  const pendingOrders = orders.filter((o) => o.status === OrderStatus.Pending);
  const cookingOrders = orders.filter((o) => o.status === OrderStatus.Cooking);
  const cookedOrders = orders.filter((o) => o.status === OrderStatus.Cooked);
  const activeDeliveryOrders = orders.filter((o) => o.status === OrderStatus.PickedUp);

  const handleUpdateStatus = async (orderId: number, nextStatus: OrderStatus) => {
    try {
      const res = await editOrder({
        variables: {
          input: {
            id: orderId,
            status: nextStatus,
          },
        },
      });

      if (res.data?.editOrder?.ok) {
        success('Order updated', `Order #${orderId} moved to ${nextStatus}`);
        refetch();
      } else {
        error('Action failed', res.data?.editOrder?.error || 'This status change is not allowed');
      }
    } catch (err: any) {
      error('Submission failed', err.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6 relative">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Link
            href="/owner"
            className="p-2.5 rounded-2xl glass-card hover:bg-white transition-all text-slate-600 shadow-sm border border-white/80"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Kitchen orders
              </h1>
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 backdrop-blur-md">
                <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-600" />
                <span>Live orders</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Track new orders, manage cooking and request a driver
            </p>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => refetch()}
          className="gap-2 glass-panel hover:bg-white/90 shadow-sm text-slate-700 border-white/80 font-semibold"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh orders</span>
        </Button>
      </div>

      {/* Kanban dispatch columns with Glassmorphism */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: Pending (Waiting to start cooking) */}
        <div className="glass-panel rounded-[28px] p-5 flex flex-col gap-4 border border-amber-200/50 bg-gradient-to-b from-amber-500/[0.04] to-transparent">
          <div className="flex items-center justify-between pb-3 border-b border-amber-200/40">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-400 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-amber-500/20">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-sm">
                  New orders
                </h3>
                <p className="text-[10px] text-slate-400">Paid and waiting for the kitchen</p>
              </div>
            </div>
            <span className="min-w-[24px] h-6 px-2 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-800 text-xs font-black flex items-center justify-center">
              {pendingOrders.length}
            </span>
          </div>

          <div className="flex flex-col gap-3.5 overflow-y-auto max-h-[620px] pr-1">
            {pendingOrders.length === 0 ? (
              <div className="py-14 text-center flex flex-col items-center justify-center gap-2 text-slate-400">
                <UtensilsCrossed className="w-8 h-8 stroke-1 text-slate-300" />
                <span className="text-xs">No new orders</span>
              </div>
            ) : (
              pendingOrders.map((order) => (
                <div
                  key={order.id}
                  className="glass-card rounded-2xl p-4.5 flex flex-col gap-3.5 border-amber-200/60 hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-amber-600 tracking-wide">
                          #{order.id}
                        </span>
                        <span className="text-[10px] bg-amber-500/10 text-amber-700 font-bold px-1.5 py-0.5 rounded">
                          New
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {new Date(order.createdAt || Date.now()).toLocaleTimeString('en-US')}
                      </p>
                    </div>
                    <span className="text-sm font-black text-slate-900">
                      {formatCents(order.totalCents)}
                    </span>
                  </div>

                  {/* Items List */}
                  <div className="space-y-1.5 text-xs text-slate-700 bg-white/50 rounded-xl p-2.5 border border-white/60">
                    {order.items?.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-start gap-2">
                        <span className="font-semibold text-slate-800">
                          {item.dish?.name}
                        </span>
                        {item.options && item.options.length > 0 && (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {item.options.map((o, optIdx) => (
                              <span
                                key={optIdx}
                                className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium"
                              >
                                {o.choice}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    loading={updating}
                    onClick={() => handleUpdateStatus(order.id, OrderStatus.Cooking)}
                    className="w-full gap-2 shadow-md shadow-brand-500/20"
                  >
                    <Flame className="w-4 h-4" />
                    <span>Accept and start cooking</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 2: Cooking (Preparing in the kitchen) */}
        <div className="glass-panel rounded-[28px] p-5 flex flex-col gap-4 border border-brand-200/50 bg-gradient-to-b from-brand-500/[0.04] to-transparent">
          <div className="flex items-center justify-between pb-3 border-b border-brand-200/40">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-500 to-orange-500 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-brand-500/20">
                <Flame className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-sm">
                  Cooking
                </h3>
                <p className="text-[10px] text-slate-400">Preparing food for packing</p>
              </div>
            </div>
            <span className="min-w-[24px] h-6 px-2 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-800 text-xs font-black flex items-center justify-center">
              {cookingOrders.length}
            </span>
          </div>

          <div className="flex flex-col gap-3.5 overflow-y-auto max-h-[620px] pr-1">
            {cookingOrders.length === 0 ? (
              <div className="py-14 text-center flex flex-col items-center justify-center gap-2 text-slate-400">
                <Flame className="w-8 h-8 stroke-1 text-slate-300" />
                <span className="text-xs">No orders cooking</span>
              </div>
            ) : (
              cookingOrders.map((order) => (
                <div
                  key={order.id}
                  className="glass-card rounded-2xl p-4.5 flex flex-col gap-3.5 border-brand-200/60 hover:shadow-md transition-all ring-1 ring-brand-500/15"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-brand-600 tracking-wide">
                          #{order.id}
                        </span>
                        <span className="text-[10px] bg-brand-500/10 text-brand-700 font-bold px-1.5 py-0.5 rounded">
                          Cooking
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {new Date(order.createdAt || Date.now()).toLocaleTimeString('en-US')}
                      </p>
                    </div>
                    <span className="text-sm font-black text-slate-900">
                      {formatCents(order.totalCents)}
                    </span>
                  </div>

                  {/* Items List */}
                  <div className="space-y-1.5 text-xs text-slate-700 bg-white/50 rounded-xl p-2.5 border border-white/60">
                    {order.items?.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-start gap-2">
                        <span className="font-semibold text-slate-800">
                          {item.dish?.name}
                        </span>
                        {item.options && item.options.length > 0 && (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {item.options.map((o, optIdx) => (
                              <span
                                key={optIdx}
                                className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium"
                              >
                                {o.choice}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="emerald"
                    size="sm"
                    loading={updating}
                    onClick={() => handleUpdateStatus(order.id, OrderStatus.Cooked)}
                    className="w-full gap-2 shadow-md shadow-emerald-500/20"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Mark ready and request a driver</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 3: Cooked & Delivering (Ready and delivering) */}
        <div className="glass-panel rounded-[28px] p-5 flex flex-col gap-4 border border-blue-200/50 bg-gradient-to-b from-blue-500/[0.04] to-transparent">
          <div className="flex items-center justify-between pb-3 border-b border-blue-200/40">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-500 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-blue-500/20">
                <Bike className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-sm">
                  Ready and delivering
                </h3>
                <p className="text-[10px] text-slate-400">Driver pickup and delivery</p>
              </div>
            </div>
            <span className="min-w-[24px] h-6 px-2 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-800 text-xs font-black flex items-center justify-center">
              {cookedOrders.length + activeDeliveryOrders.length}
            </span>
          </div>

          <div className="flex flex-col gap-3.5 overflow-y-auto max-h-[620px] pr-1">
            {cookedOrders.length === 0 && activeDeliveryOrders.length === 0 ? (
              <div className="py-14 text-center flex flex-col items-center justify-center gap-2 text-slate-400">
                <Bike className="w-8 h-8 stroke-1 text-slate-300" />
                <span className="text-xs">No orders ready or delivering</span>
              </div>
            ) : (
              <>
                {cookedOrders.map((order) => (
                  <div
                    key={order.id}
                    className="glass-card rounded-2xl p-4 flex flex-col gap-2.5 border-blue-200/60"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-blue-600">
                        #{order.id}
                      </span>
                      <OrderStatusBadge status={OrderStatus.Cooked} size="sm" />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed bg-blue-50/50 rounded-xl p-2 border border-blue-100">
                      Packed and ready for a driver to claim...
                    </p>
                  </div>
                ))}

                {activeDeliveryOrders.map((order) => (
                  <div
                    key={order.id}
                    className="glass-card rounded-2xl p-4 flex flex-col gap-2.5 border-purple-200/60"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-purple-600">
                        #{order.id}
                      </span>
                      <OrderStatusBadge status={OrderStatus.PickedUp} size="sm" />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed bg-purple-50/50 rounded-xl p-2 border border-purple-100">
                      The driver has picked up the food and is on the way to the customer.
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
