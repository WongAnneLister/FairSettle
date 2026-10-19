'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from '@apollo/client';
import {
  Sparkles,
  ArrowLeft,
  CheckCircle,
  CreditCard,
  Store,
  ShieldCheck,
  Calendar,
  Zap,
} from 'lucide-react';
import { MY_RESTAURANTS_QUERY, GET_PAYMENTS_QUERY } from '@/lib/graphql/queries';
import { CREATE_PAYMENT_MUTATION } from '@/lib/graphql/mutations';
import { Restaurant, Payment } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/lib/toast-context';

export default function PromotionsPage() {
  const { success, error } = useToast();

  const { data: restData, loading: restLoading, refetch: refetchRest } = useQuery(
    MY_RESTAURANTS_QUERY,
    { errorPolicy: 'all' }
  );

  const { data: payData, refetch: refetchPay } = useQuery(GET_PAYMENTS_QUERY, {
    errorPolicy: 'all',
  });

  const [createPayment, { loading: paying }] = useMutation(CREATE_PAYMENT_MUTATION);

  const restaurants: Restaurant[] = restData?.myRestaurants?.restaurants || [];
  const payments: Payment[] = payData?.getPayments?.payments || [];

  const handlePromote = async (restaurantId: number) => {
    try {
      const txId = 'TX-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      const res = await createPayment({
        variables: {
          input: {
            restaurantId,
            transactionId: txId,
          },
        },
      });

      if (res.data?.createPayment?.ok) {
        success('置顶推广开通成功！', '该餐厅将在平台首页享受 7 天专属推荐黄金曝光位');
        refetchRest();
        refetchPay();
      } else {
        error('推广未成功', res.data?.createPayment?.error);
      }
    } catch (err: any) {
      error('支付推广异常', err.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6 relative">
      {/* Header */}
      <div className="flex items-center gap-3.5">
        <Link
          href="/owner"
          className="p-2.5 rounded-2xl glass-card hover:bg-white transition-all text-slate-600 shadow-sm border border-white/80"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            餐厅曝光与置顶推广
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            开启首页置顶特权，为您的店铺带来数倍外卖进店客流与爆单机会
          </p>
        </div>
      </div>

      {/* Plans info Banner */}
      <div className="relative overflow-hidden bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 rounded-[32px] p-6 sm:p-10 text-white shadow-2xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="absolute -left-20 -top-20 w-60 h-60 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col gap-2.5 relative z-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-500/30 backdrop-blur-xl border border-purple-400/30 text-purple-200 text-xs font-bold w-fit shadow-sm">
            <Sparkles className="w-4 h-4 text-purple-300" />
            <span>黄金推荐位特权套餐</span>
          </div>
          <h2 className="text-xl sm:text-3xl font-black tracking-tight text-white">
            7 天全城首页置顶曝光
          </h2>
          <p className="text-xs sm:text-sm text-purple-200/90 max-w-lg leading-relaxed">
            开通后系统自动在首页「店长力荐」展位第一屏展示，附带金色尊享皇冠标。后端 NestJS 定时任务每日 00:00 自动巡检过期状态。
          </p>
        </div>

        <div className="p-6 rounded-3xl bg-white/10 backdrop-blur-2xl border border-white/15 text-center shrink-0 shadow-xl relative z-10">
          <span className="text-xs text-purple-200 font-semibold tracking-wider uppercase">特惠推广计划</span>
          <p className="text-3xl sm:text-4xl font-black text-white mt-1">$49.90</p>
          <span className="text-[11px] text-purple-300 font-medium mt-1 block">有效期 7 天 · 即刻生效</span>
        </div>
      </div>

      {/* Select Restaurant to promote */}
      <div className="flex flex-col gap-4">
        <h3 className="font-black text-slate-900 text-lg">
          选择要推广的店铺
        </h3>

        {restLoading ? (
          <div className="py-16 flex justify-center">
            <Spinner className="w-8 h-8 text-purple-500" />
          </div>
        ) : restaurants.length === 0 ? (
          <div className="p-10 glass-panel rounded-[32px] text-center border border-white/80">
            <p className="text-xs text-slate-500 mb-4">您目前名下没有餐厅，请先创建您的第一家餐厅</p>
            <Link href="/owner/restaurants">
              <Button variant="primary" size="sm">
                去创建餐厅
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {restaurants.map((rest) => (
              <div
                key={rest.id}
                className="glass-card glass-card-hover rounded-[28px] p-6 flex flex-col justify-between gap-5 group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-black text-slate-900 text-base group-hover:text-purple-600 transition-colors">
                      {rest.name}
                    </h4>
                    {rest.isPromoted ? (
                      <span className="text-[11px] bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-sm shrink-0">
                        <Sparkles className="w-3 h-3" />
                        已置顶
                      </span>
                    ) : (
                      <span className="text-[11px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full shrink-0">
                        常规展示
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-2 truncate">
                    {rest.address}
                  </p>
                  {rest.promotedUntil && (
                    <div className="mt-2.5 p-2 rounded-xl bg-amber-50 border border-amber-200/60 text-[11px] text-amber-800 font-semibold flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-600" />
                      <span>有效期至：{new Date(rest.promotedUntil).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                <Button
                  variant={rest.isPromoted ? 'secondary' : 'primary'}
                  size="sm"
                  loading={paying}
                  onClick={() => handlePromote(rest.id)}
                  className={`w-full gap-2 font-bold ${
                    !rest.isPromoted ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-md shadow-purple-500/20' : ''
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{rest.isPromoted ? '续期推广 7 天' : '立即开通置顶 ($49.90)'}</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment History */}
      {payments.length > 0 && (
        <div className="glass-panel rounded-[28px] p-6 border border-white/80 flex flex-col gap-4">
          <h3 className="font-black text-slate-900 text-base">
            历史推广交易单据
          </h3>
          <div className="divide-y divide-slate-100 text-xs">
            {payments.map((p) => (
              <div key={p.id} className="py-3.5 flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center font-bold">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="font-mono font-black text-slate-800">
                      {p.transactionId}
                    </span>
                    <span className="text-slate-400 ml-2">
                      店铺 #{p.restaurantId}
                    </span>
                  </div>
                </div>
                <span className="text-slate-500 font-medium">
                  {new Date(p.createdAt || Date.now()).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
