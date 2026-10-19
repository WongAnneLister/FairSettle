'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@apollo/client';
import {
  Bike,
  ArrowLeft,
  MapPin,
  Clock,
  CheckCircle,
  PackageCheck,
  RefreshCw,
  PhoneCall,
  Store,
  Navigation,
  ExternalLink,
} from 'lucide-react';
import { GET_ORDERS_QUERY } from '@/lib/graphql/queries';
import { EDIT_ORDER_MUTATION } from '@/lib/graphql/mutations';
import { Order, OrderStatus } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { OrderStatusBadge } from '@/components/order/order-status-badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/lib/toast-context';

export default function DriverActiveOrdersPage() {
  const { success, error } = useToast();

  const { data, loading, refetch } = useQuery(GET_ORDERS_QUERY, {
    variables: { input: { page: 1 } },
    pollInterval: 3000,
    errorPolicy: 'all',
  });

  const [editOrder, { loading: updating }] = useMutation(EDIT_ORDER_MUTATION);

  const orders: Order[] = data?.getOrders?.orders || [];
  const activeOrders = orders.filter(
    (o) => o.status === OrderStatus.Cooked || o.status === OrderStatus.PickedUp
  );
  const deliveredOrders = orders.filter((o) => o.status === OrderStatus.Delivered);

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
        success('配送进度已更新', `订单 #${orderId} 状态已推进至：${nextStatus}`);
        refetch();
      } else {
        error('操作受限', res.data?.editOrder?.error || '状态流转未获批准');
      }
    } catch (err: any) {
      error('提交失败', err.message);
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
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              当前配送任务看板
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              执行已接单配送任务，确认到店取餐与交付顾客送达
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
            <span>刷新进度</span>
          </Button>
          <Link href="/driver/available">
            <Button variant="emerald" size="sm" className="shadow-md shadow-emerald-500/20">
              去抢单大厅
            </Button>
          </Link>
        </div>
      </div>

      {/* Active Orders Section */}
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-black text-slate-900 tracking-tight">
          正在派送中的任务 ({activeOrders.length})
        </h2>

        {loading && activeOrders.length === 0 ? (
          <div className="py-20 flex justify-center">
            <Spinner className="w-8 h-8 text-emerald-500" />
          </div>
        ) : activeOrders.length === 0 ? (
          <div className="py-20 glass-panel rounded-[32px] text-center p-8 flex flex-col items-center justify-center border border-white/80">
            <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-4 border border-emerald-500/20">
              <Bike className="w-8 h-8" />
            </div>
            <h3 className="font-black text-slate-900 text-lg">
              您当前没有进行中的配送任务
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1 mb-6 leading-relaxed">
              前往待抢单大厅，抢接后厨刚出餐完毕的品质外卖！
            </p>
            <Link href="/driver/available">
              <Button variant="emerald" size="md" className="shadow-lg shadow-emerald-500/25">
                前往抢单大厅
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {activeOrders.map((order) => (
              <div
                key={order.id}
                className="glass-card rounded-[28px] p-6 sm:p-7 flex flex-col gap-5 border border-white/90 shadow-glass"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-2xl bg-emerald-500/15 text-emerald-700 font-black text-xs flex items-center justify-center border border-emerald-500/20">
                      #{order.id}
                    </span>
                    <div>
                      <h3 className="font-black text-slate-900 text-base">
                        {order.restaurant?.name || '品质合作餐厅'}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        接单时间：{new Date(order.createdAt || Date.now()).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-slate-900">
                      {formatCents(order.totalCents)}
                    </span>
                    <OrderStatusBadge status={order.status} size="md" />
                  </div>
                </div>

                {/* Routing Addresses in Frosted Tiles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/60 flex items-start gap-3">
                    <Store className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-slate-400 font-bold block uppercase tracking-wider text-[10px]">
                        取餐地点 (商家)
                      </span>
                      <p className="font-black text-slate-800 mt-1">
                        {order.restaurant?.address || '美食街88号'}
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/60 flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-slate-400 font-bold block uppercase tracking-wider text-[10px]">
                        送达地点 (顾客)
                      </span>
                      <p className="font-black text-slate-800 mt-1">
                        科技大道99号 创新大厦B座 1802室
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        顾客联络：{order.customer?.email}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="pt-2 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
                  <Link href={`/orders/${order.id}`}>
                    <Button variant="secondary" size="md" className="glass-panel text-slate-700 font-semibold gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>查看订单详情</span>
                    </Button>
                  </Link>

                  {order.status === OrderStatus.Cooked && (
                    <Button
                      variant="primary"
                      size="md"
                      loading={updating}
                      onClick={() => handleUpdateStatus(order.id, OrderStatus.PickedUp)}
                      className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-md shadow-purple-500/20 font-bold"
                    >
                      <Bike className="w-4 h-4" />
                      <span>已到店取餐 (PickedUp)</span>
                    </Button>
                  )}

                  {order.status === OrderStatus.PickedUp && (
                    <Button
                      variant="emerald"
                      size="md"
                      loading={updating}
                      onClick={() => handleUpdateStatus(order.id, OrderStatus.Delivered)}
                      className="gap-2 shadow-lg shadow-emerald-500/25 font-bold"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>已送达顾客 (Delivered)</span>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delivered Orders Section */}
      {deliveredOrders.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          <h2 className="text-base font-black text-slate-900 tracking-tight">
            今日已送达履约记录 ({deliveredOrders.length})
          </h2>

          <div className="glass-panel rounded-[28px] p-6 border border-white/80 divide-y divide-slate-100 text-xs">
            {deliveredOrders.map((d) => (
              <div key={d.id} className="py-3.5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-slate-900">
                    #{d.id} · {d.restaurant?.name || '餐厅'}
                  </span>
                  <span className="text-emerald-700 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full text-[11px]">
                    已送达
                  </span>
                </div>
                <span className="font-black text-slate-800">
                  {formatCents(d.totalCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
