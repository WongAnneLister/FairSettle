'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useSubscription, useMutation } from '@apollo/client';
import {
  Zap,
  ArrowLeft,
  Radio,
  RefreshCw,
  Store,
  MapPin,
  Clock,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  Bike,
  Sparkles,
} from 'lucide-react';
import { GET_ORDERS_QUERY } from '@/lib/graphql/queries';
import { COOKED_ORDERS_SUBSCRIPTION } from '@/lib/graphql/subscriptions';
import { TAKE_ORDER_MUTATION } from '@/lib/graphql/mutations';
import { Order, OrderStatus } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/lib/toast-context';

export default function DriverAvailableOrdersPage() {
  const router = useRouter();
  const { success, error, info } = useToast();

  const { data, loading, refetch } = useQuery(GET_ORDERS_QUERY, {
    variables: { input: { status: OrderStatus.Cooked, page: 1 } },
    pollInterval: 3000,
    errorPolicy: 'all',
  });

  // Real-time subscription to new cooked orders
  const { data: cookedSub } = useSubscription(COOKED_ORDERS_SUBSCRIPTION);

  const [takeOrder, { loading: claiming }] = useMutation(TAKE_ORDER_MUTATION);

  useEffect(() => {
    if (cookedSub?.cookedOrders) {
      info(
        '⚡ New order ready to claim',
        `Restaurant ${cookedSub.cookedOrders.restaurant?.name || 'Restaurant'} has an order ready to claim`
      );
      refetch();
    }
  }, [cookedSub, info, refetch]);

  const allCookedOrders: Order[] = data?.getOrders?.orders || [];
  // Only show orders that do not have a driver assigned yet
  const availableOrders = allCookedOrders.filter((o) => !o.driver);

  const handleClaim = async (orderId: number) => {
    try {
      const res = await takeOrder({
        variables: { input: { id: orderId } },
      });

      const { ok, error: errMessage, code } = res.data?.takeOrder || {};

      if (ok) {
        success('🎉 Order claimed', `You claimed order #${orderId}. Head to the restaurant for pickup`);
        router.push('/driver/active');
      } else if (code === 'CONFLICT' || errMessage?.includes('already has a driver')) {
        error(
          'Another driver claimed this order',
          'Available orders have been refreshed'
        );
        refetch();
      } else {
        error('Claim failed', errMessage || 'Please try again later');
      }
    } catch (err: any) {
      error('Network error while claiming order', err.message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Link
            href="/driver"
            className="p-2.5 rounded-2xl glass-card hover:bg-white transition-all text-slate-600 shadow-sm border border-white/80"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                Available orders
              </h1>
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20 backdrop-blur-md">
                <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-600" />
                <span>Live updates</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Claim orders that are ready for pickup
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5 glass-panel hover:bg-white text-slate-700 border-white/80 font-semibold shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh orders</span>
          </Button>
          <Link href="/driver/active">
            <Button variant="emerald" size="sm" className="shadow-md shadow-emerald-500/20">
              My deliveries
            </Button>
          </Link>
        </div>
      </div>

      {/* Info Callout in Frosted Glass */}
      <div className="glass-panel p-4.5 rounded-[22px] border border-emerald-500/20 bg-gradient-to-r from-emerald-500/[0.06] to-teal-500/[0.03] flex items-center justify-between text-xs text-emerald-900">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-700 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="font-medium">
            Each order can be claimed by one driver.
            <code className="bg-white/80 px-2 py-0.5 rounded-lg font-mono text-[11px] ml-1.5 border border-emerald-200/60 text-emerald-800">
              WHERE id = $1 AND driverId IS NULL AND status = Cooked
            </code>
          </span>
        </div>
      </div>

      {/* Order List */}
      {loading && availableOrders.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3">
          <Spinner className="w-8 h-8 text-emerald-500" />
          <p className="text-xs text-slate-400">Loading orders ready for pickup...</p>
        </div>
      ) : availableOrders.length === 0 ? (
        <div className="py-20 glass-panel rounded-[32px] text-center p-8 flex flex-col items-center justify-center border border-white/80">
          <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-4 border border-emerald-500/20">
            <Zap className="w-8 h-8" />
          </div>
          <h3 className="font-black text-slate-900 text-lg">
            No orders available
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1 mb-6 leading-relaxed">
            New orders appear here when restaurants mark them ready for pickup.
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()} className="glass-panel text-slate-700">
            Refresh
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {availableOrders.map((order) => (
            <div
              key={order.id}
              className="glass-card glass-card-hover rounded-[28px] p-6 flex flex-col justify-between gap-5 group border-emerald-200/50 hover:border-emerald-300"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center font-black text-xs border border-emerald-500/20">
                      #{order.id}
                    </span>
                    <div>
                      <h3 className="font-black text-slate-900 text-base group-hover:text-emerald-600 transition-colors">
                        {order.restaurant?.name || 'Restaurant'}
                      </h3>
                      <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        Ready for pickup
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-black text-emerald-600">
                      {formatCents(order.totalCents)}
                    </span>
                    <p className="text-[10px] text-slate-400">Order total</p>
                  </div>
                </div>

                <div className="mt-4 p-3 rounded-2xl bg-slate-50/80 border border-slate-200/60 flex flex-col gap-2 text-xs">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Store className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold truncate">{order.restaurant?.address || 'Restaurant pickup address'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-500">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Ready at: {new Date(order.createdAt || Date.now()).toLocaleTimeString('en-US')}</span>
                  </div>
                </div>

                {/* Items */}
                {order.items && (
                  <div className="mt-3 text-xs text-slate-600 line-clamp-1">
                    <strong className="font-semibold text-slate-700">Dishes: </strong>
                    <span>{order.items.map((i) => i.dish?.name).join(', ')}</span>
                  </div>
                )}
              </div>

              <Button
                variant="emerald"
                size="md"
                loading={claiming}
                onClick={() => handleClaim(order.id)}
                className="w-full gap-2 shadow-lg shadow-emerald-500/25 font-bold text-sm py-3"
              >
                <Zap className="w-4 h-4 fill-white" />
                <span>Claim order</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
