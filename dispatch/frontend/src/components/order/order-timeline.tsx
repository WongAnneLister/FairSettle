'use client';

import React from 'react';
import { OrderStatus } from '@/lib/types';
import { Check, Clock, Flame, CheckCircle, Bike, HeartHandshake } from 'lucide-react';

interface OrderTimelineProps {
  status: OrderStatus;
}

const STEPS = [
  {
    key: OrderStatus.Pending,
    label: '下单成功',
    desc: '系统已通知商家接单',
    icon: Clock,
  },
  {
    key: OrderStatus.Cooking,
    label: '后厨制作',
    desc: '大厨正在精心烹饪',
    icon: Flame,
  },
  {
    key: OrderStatus.Cooked,
    label: '制作完成',
    desc: '打包完毕，呼叫骑手',
    icon: CheckCircle,
  },
  {
    key: OrderStatus.PickedUp,
    label: '骑手配送',
    desc: '骑手已取餐，快速配送中',
    icon: Bike,
  },
  {
    key: OrderStatus.Delivered,
    label: '美食送达',
    desc: '订单已完成，请慢用',
    icon: HeartHandshake,
  },
];

const ORDER_RANK: Record<OrderStatus, number> = {
  [OrderStatus.Pending]: 0,
  [OrderStatus.Cooking]: 1,
  [OrderStatus.Cooked]: 2,
  [OrderStatus.PickedUp]: 3,
  [OrderStatus.Delivered]: 4,
};

export function OrderTimeline({ status }: OrderTimelineProps) {
  const currentRank = ORDER_RANK[status] ?? 0;

  return (
    <div className="w-full py-6">
      {/* Desktop/Tablet Stepper */}
      <div className="hidden sm:flex items-center justify-between relative">
        {/* Progress connecting line */}
        <div className="absolute top-1/2 left-6 right-6 -translate-y-1/2 h-1 bg-slate-100 dark:bg-slate-800 -z-0">
          <div
            className="h-full bg-gradient-to-r from-brand-500 via-amber-400 to-emerald-500 transition-all duration-700"
            style={{ width: `${(currentRank / (STEPS.length - 1)) * 100}%` }}
          />
        </div>

        {STEPS.map((step, idx) => {
          const isDone = idx < currentRank;
          const isCurrent = idx === currentRank;
          const Icon = step.icon;

          return (
            <div
              key={step.key}
              className="flex flex-col items-center z-10 text-center max-w-[100px]"
            >
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-md ${
                  isDone
                    ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                    : isCurrent
                    ? 'bg-gradient-to-tr from-brand-500 to-amber-500 text-white shadow-brand-500/30 scale-110 ring-4 ring-brand-500/20 animate-pulse-subtle'
                    : 'bg-white dark:bg-slate-800 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isDone ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
              </div>
              <span
                className={`text-xs font-bold mt-2.5 ${
                  isCurrent
                    ? 'text-brand-600 dark:text-brand-400'
                    : isDone
                    ? 'text-slate-800 dark:text-slate-200'
                    : 'text-slate-400'
                }`}
              >
                {step.label}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5 leading-tight line-clamp-1">
                {step.desc}
              </span>
            </div>
          );
        })}
      </div>

      {/* Mobile Vertical Timeline */}
      <div className="flex sm:hidden flex-col gap-4 pl-4 border-l-2 border-slate-200 dark:border-slate-800 ml-3">
        {STEPS.map((step, idx) => {
          const isDone = idx < currentRank;
          const isCurrent = idx === currentRank;
          const Icon = step.icon;

          return (
            <div key={step.key} className="flex items-start gap-3 relative">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs -ml-[23px] transition-all shadow-sm ${
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isCurrent
                    ? 'bg-brand-500 text-white ring-2 ring-brand-400/30 scale-110'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div>
                <h4
                  className={`text-xs font-bold ${
                    isCurrent
                      ? 'text-brand-600 dark:text-brand-400'
                      : isDone
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
