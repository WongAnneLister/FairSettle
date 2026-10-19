'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@apollo/client';
import {
  Bike,
  Flame,
  CheckCircle,
  Clock,
  ArrowRight,
  ShieldCheck,
  Zap,
  PackageCheck,
  TrendingUp,
  Radio,
} from 'lucide-react';
import { GET_ORDERS_QUERY } from '@/lib/graphql/queries';
import { OrderStatus, Order } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { Button } from '@/components/ui/button';

export default function DriverDashboardPage() {
  const { data: cookedData } = useQuery(GET_ORDERS_QUERY, {
    variables: { input: { status: OrderStatus.Cooked, page: 1 } },
    pollInterval: 3000,
    errorPolicy: 'all',
  });

  const { data: myRidesData } = useQuery(GET_ORDERS_QUERY, {
    variables: { input: { page: 1 } },
    pollInterval: 3000,
    errorPolicy: 'all',
  });

  const availableOrders: Order[] = (cookedData?.getOrders?.orders || []).filter((o: Order) => !o.driver);
  const myOrders: Order[] = myRidesData?.getOrders?.orders || [];

  const activeDeliveries = myOrders.filter(
    (o) => o.status === OrderStatus.PickedUp || o.status === OrderStatus.Cooked
  );
  const completedDeliveries = myOrders.filter(
    (o) => o.status === OrderStatus.Delivered
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 relative">
      {/* Top Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-800 rounded-[32px] p-6 sm:p-10 text-white shadow-2xl shadow-emerald-500/20 border border-white/20">
        <div className="absolute -right-16 -top-16 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
          <div className="flex flex-col gap-2.5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/20 backdrop-blur-xl border border-white/25 text-xs font-semibold w-fit tracking-wide shadow-sm">
              <Bike className="w-4 h-4 text-emerald-200" />
              <span>骑手极速配送中枢</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white drop-shadow-sm">
              高并发原子抢单与极速配送
            </h1>
            <p className="text-xs sm:text-sm text-white/90 max-w-xl leading-relaxed">
              后厨制作完毕（Cooked）的订单实时就绪广播。单行 SQL 条件写锁保护，杜绝重复接单冲突。
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link href="/driver/available">
              <Button
                variant="secondary"
                size="md"
                className="bg-white/95 text-slate-900 hover:bg-white font-bold gap-2 shadow-xl shadow-black/10 backdrop-blur-md border border-white"
              >
                <Zap className="w-4 h-4 text-emerald-600 fill-emerald-600" />
                <span>进入待抢单大厅 ({availableOrders.length})</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Metrics Cards with Glassmorphism */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="glass-card rounded-[28px] p-6 flex items-center justify-between group hover:shadow-glass-hover transition-all duration-300">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">待抢单池 (Cooked)</p>
            <h3 className="text-3xl sm:text-4xl font-black text-slate-900 mt-1.5 tracking-tight">
              {availableOrders.length}
              <span className="text-sm font-bold text-slate-500 ml-1">单</span>
            </h3>
            <p className="text-[11px] text-amber-600 font-medium flex items-center gap-1 mt-1">
              <Radio className="w-3 h-3 animate-pulse" />
              <span>实时可抢</span>
            </p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500/10 to-amber-500/20 text-amber-600 flex items-center justify-center font-bold border border-amber-500/20 shadow-inner group-hover:scale-110 transition-transform">
            <Zap className="w-7 h-7" />
          </div>
        </div>

        <div className="glass-card rounded-[28px] p-6 flex items-center justify-between group hover:shadow-glass-hover transition-all duration-300">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">我的配送中订单</p>
            <h3 className="text-3xl sm:text-4xl font-black text-emerald-600 mt-1.5 tracking-tight">
              {activeDeliveries.length}
              <span className="text-sm font-bold text-emerald-700/60 ml-1">单</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">取餐及配送中</p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500/10 to-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold border border-emerald-500/20 shadow-inner group-hover:scale-110 transition-transform">
            <Bike className="w-7 h-7" />
          </div>
        </div>

        <div className="glass-card rounded-[28px] p-6 flex items-center justify-between group hover:shadow-glass-hover transition-all duration-300">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">今日已送达单量</p>
            <h3 className="text-3xl sm:text-4xl font-black text-slate-900 mt-1.5 tracking-tight">
              {completedDeliveries.length}
              <span className="text-sm font-bold text-slate-500 ml-1">单</span>
            </h3>
            <p className="text-[11px] text-teal-600 font-medium flex items-center gap-1 mt-1">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>完美履约</span>
            </p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-teal-500/10 to-teal-500/20 text-teal-600 flex items-center justify-center font-bold border border-teal-500/20 shadow-inner group-hover:scale-110 transition-transform">
            <PackageCheck className="w-7 h-7" />
          </div>
        </div>
      </div>

      {/* Quick Action Navigation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link
          href="/driver/available"
          className="group glass-card glass-card-hover rounded-[28px] p-8 flex flex-col justify-between gap-6 relative overflow-hidden ring-1 ring-emerald-500/20"
        >
          <div className="flex flex-col gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-100/80 text-emerald-600 flex items-center justify-center font-bold border border-emerald-200/50 shadow-sm">
              <Zap className="w-6 h-6 fill-emerald-600 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-emerald-600 transition-colors">
                实时待抢单大厅
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-1">
                实时广播后厨已出餐（Cooked）的订单。抢单接口配备单行 SQL 条件写锁保护，提供确定性并发控制。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 group-hover:translate-x-1.5 transition-transform pt-2 border-t border-slate-100">
            <span>前往抢单大厅</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>

        <Link
          href="/driver/active"
          className="group glass-card glass-card-hover rounded-[28px] p-8 flex flex-col justify-between gap-6 relative overflow-hidden"
        >
          <div className="flex flex-col gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-50 to-emerald-100/80 text-teal-600 flex items-center justify-center font-bold border border-teal-200/50 shadow-sm">
              <PackageCheck className="w-6 h-6 text-teal-600" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-teal-600 transition-colors">
                当前配送任务看板
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-1">
                查看已接单任务，前往餐厅取餐后一键更新为已取餐（PickedUp），送到顾客手中后点击确认送达（Delivered）。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-teal-600 group-hover:translate-x-1.5 transition-transform pt-2 border-t border-slate-100">
            <span>查看当前配送任务</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>
      </div>
    </div>
  );
}
