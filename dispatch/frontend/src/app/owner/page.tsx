'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@apollo/client';
import {
  ChefHat,
  Store,
  Flame,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Clock,
  Radio,
  Layers,
} from 'lucide-react';
import { MY_RESTAURANTS_QUERY, GET_ORDERS_QUERY } from '@/lib/graphql/queries';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@/lib/types';
import { Button } from '@/components/ui/button';

export default function OwnerDashboardPage() {
  const { user } = useAuth();

  const { data: restData } = useQuery(MY_RESTAURANTS_QUERY, {
    skip: !user || user.role !== UserRole.Owner,
    errorPolicy: 'all',
  });

  const { data: ordersData } = useQuery(GET_ORDERS_QUERY, {
    variables: { input: { page: 1 } },
    skip: !user || user.role !== UserRole.Owner,
    errorPolicy: 'all',
  });

  const restaurants = restData?.myRestaurants?.restaurants || [];
  const orders = ordersData?.getOrders?.orders || [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8 relative">
      {/* Top Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-amber-600 via-brand-500 to-orange-600 rounded-[32px] p-6 sm:p-10 text-white shadow-2xl shadow-brand-500/20 border border-white/20">
        <div className="absolute -right-16 -top-16 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
          <div className="flex flex-col gap-2.5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/20 backdrop-blur-xl border border-white/25 text-xs font-semibold w-fit tracking-wide shadow-sm">
              <ChefHat className="w-4 h-4 text-amber-200" />
              <span>Owner dashboard</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white drop-shadow-sm">
              Kitchen and restaurant dashboard
            </h1>
            <p className="text-xs sm:text-sm text-white/90 max-w-xl leading-relaxed">
              Track orders, manage your kitchen and customize your menu.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link href="/owner/orders">
              <Button
                variant="secondary"
                size="md"
                className="bg-white/95 text-slate-900 hover:bg-white font-bold gap-2 shadow-xl shadow-black/10 backdrop-blur-md border border-white"
              >
                <Flame className="w-4 h-4 text-brand-500 animate-pulse" />
                <span>Open kitchen orders</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Cards with Glassmorphism */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="glass-card rounded-[28px] p-6 flex items-center justify-between group hover:shadow-glass-hover transition-all duration-300">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Your restaurants</p>
            <h3 className="text-3xl sm:text-4xl font-black text-slate-900 mt-1.5 tracking-tight">
              {restaurants.length}
              <span className="text-sm font-bold text-slate-500 ml-1">restaurants</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">Listed and accepting orders</p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500/10 to-amber-500/20 text-amber-600 flex items-center justify-center font-bold border border-amber-500/20 shadow-inner group-hover:scale-110 transition-transform">
            <Store className="w-7 h-7" />
          </div>
        </div>

        <div className="glass-card rounded-[28px] p-6 flex items-center justify-between group hover:shadow-glass-hover transition-all duration-300">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total orders</p>
            <h3 className="text-3xl sm:text-4xl font-black text-slate-900 mt-1.5 tracking-tight">
              {orders.length}
              <span className="text-sm font-bold text-slate-500 ml-1">orders</span>
            </h3>
            <p className="text-[11px] text-emerald-600 font-medium flex items-center gap-1 mt-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Updated as orders arrive</span>
            </p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-500/10 to-brand-500/20 text-brand-600 flex items-center justify-center font-bold border border-brand-500/20 shadow-inner group-hover:scale-110 transition-transform">
            <TrendingUp className="w-7 h-7" />
          </div>
        </div>

        <div className="glass-card rounded-[28px] p-6 flex items-center justify-between group hover:shadow-glass-hover transition-all duration-300">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Kitchen updates</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-emerald-600 tracking-tight">
                Live updates ready
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">WebSocket updates and polling</p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500/10 to-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold border border-emerald-500/20 shadow-inner group-hover:scale-110 transition-transform">
            <Radio className="w-7 h-7 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Navigation Panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link
          href="/owner/restaurants"
          className="group glass-card glass-card-hover rounded-[28px] p-7 flex flex-col justify-between gap-6 relative overflow-hidden"
        >
          <div className="flex flex-col gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100/80 text-amber-600 flex items-center justify-center font-bold border border-amber-200/50 shadow-sm">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-amber-600 transition-colors">
                Restaurants and dish options
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-1">
                Create restaurants, add dishes and customize options and extras.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 group-hover:translate-x-1.5 transition-transform pt-2 border-t border-slate-100">
            <span>Manage restaurants</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>

        <Link
          href="/owner/orders"
          className="group glass-card glass-card-hover rounded-[28px] p-7 flex flex-col justify-between gap-6 relative overflow-hidden ring-1 ring-brand-500/20"
        >
          <div className="flex flex-col gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-50 to-brand-100/80 text-brand-600 flex items-center justify-center font-bold border border-brand-200/50 shadow-sm">
              <Flame className="w-6 h-6 text-brand-500" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-brand-600 transition-colors">
                Kitchen order board
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-1">
                Track orders from new to cooking to ready for pickup.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-brand-600 group-hover:translate-x-1.5 transition-transform pt-2 border-t border-slate-100">
            <span>Open kitchen orders</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>

        <Link
          href="/owner/promotions"
          className="group glass-card glass-card-hover rounded-[28px] p-7 flex flex-col justify-between gap-6 relative overflow-hidden"
        >
          <div className="flex flex-col gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-50 to-indigo-100/80 text-purple-600 flex items-center justify-center font-bold border border-purple-200/50 shadow-sm">
              <Sparkles className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-purple-600 transition-colors">
                Featured promotions
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed mt-1">
                Feature your restaurant on the home page for 7 days with a gold crown badge.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-purple-600 group-hover:translate-x-1.5 transition-transform pt-2 border-t border-slate-100">
            <span>Manage promotions</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>
      </div>
    </div>
  );
}
