'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@apollo/client';
import {
  ShoppingBag,
  Clock,
  ArrowRight,
  Store,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { GET_ORDERS_QUERY } from '@/lib/graphql/queries';
import { Order, OrderStatus } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { OrderStatusBadge } from '@/components/order/order-status-badge';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';

export default function OrdersHistoryPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const { data, loading, refetch } = useQuery(GET_ORDERS_QUERY, {
    variables: { input: { page: 1 } },
    skip: !user,
    errorPolicy: 'all',
  });

  const orders: Order[] = data?.getOrders?.orders || [];

  const filteredOrders = orders.filter((o) => {
    if (filter === 'active') {
      return o.status !== OrderStatus.Delivered;
    }
    if (filter === 'completed') {
      return o.status === OrderStatus.Delivered;
    }
    return true;
  });

  if (!user) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-3xl glass-pill flex items-center justify-center mb-4 shadow-sm">
          <ShoppingBag className="w-8 h-8 text-brand-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">
          登录查看您的历史订单
        </h2>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          登录后即可实时追踪正在配送的美食订单，并随时回顾您的历史外卖记录。
        </p>
        <Link href="/login" className="w-full">
          <Button variant="primary" size="lg" className="w-full text-xs font-bold">
            立即登录
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            我的美食订单
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            实时查看配送轨迹、出餐进度与历史消费账单
          </p>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl glass-pill text-xs font-semibold">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-xl transition-all duration-200 ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            全部 ({orders.length})
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-3 py-1.5 rounded-xl transition-all duration-200 ${
              filter === 'active'
                ? 'bg-white text-brand-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            进行中
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1.5 rounded-xl transition-all duration-200 ${
              filter === 'completed'
                ? 'bg-white text-emerald-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            已送达
          </button>
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Spinner className="w-8 h-8 text-brand-500" />
          <p className="text-xs text-slate-400">正在获取您的订单列表...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="py-16 glass-card rounded-3xl text-center p-8 flex flex-col items-center justify-center border border-white/90">
          <ShoppingBag className="w-12 h-12 text-slate-300 mb-3" />
          <h3 className="font-bold text-slate-800 text-base">
            暂无相关订单记录
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1 mb-6">
            快去挑选您中意的手作餐厅，体验高并发极速派单吧！
          </p>
          <Link href="/">
            <Button variant="primary" size="md">
              去发现美食
            </Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              className="glass-card glass-card-hover rounded-3xl p-6 border border-white/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-500/10 text-brand-600 flex items-center justify-center font-bold text-sm shrink-0 border border-brand-500/15">
                  <Store className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-base">
                      {order.restaurant?.name || '品质合作餐厅'}
                    </h3>
                    <OrderStatusBadge status={order.status} size="sm" />
                  </div>

                  <p className="text-xs text-slate-400 mt-1">
                    订单号 #{order.id} · 下单于{' '}
                    {new Date(order.createdAt || Date.now()).toLocaleDateString()}{' '}
                    {new Date(order.createdAt || Date.now()).toLocaleTimeString()}
                  </p>

                  {/* Summary of items */}
                  {order.items && order.items.length > 0 && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-1">
                      {order.items
                        .map((i) => i.dish?.name || '精选美食')
                        .join('、')}{' '}
                      等共 {order.items.length} 件商品
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-4 pt-3 sm:pt-0 border-t sm:border-0 border-slate-200/50">
                <div className="text-left sm:text-right">
                  <span className="text-xs text-slate-400 block">合计金额</span>
                  <span className="text-base font-black text-slate-900">
                    {formatCents(order.totalCents)}
                  </span>
                </div>

                <Link href={`/orders/${order.id}`}>
                  <Button variant="primary" size="sm" className="gap-1 rounded-2xl text-xs">
                    <span>实时追踪</span>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
