'use client';

import React from 'react';
import { OrderStatus } from '@/lib/types';
import { Check, Clock, Flame, CheckCircle, Bike, HeartHandshake, XCircle } from 'lucide-react';

interface OrderTimelineProps {
  status: OrderStatus;
}

const STEPS = [
  {
    key: OrderStatus.Pending,
    label: 'Order placed',
    desc: 'The restaurant has been notified',
    icon: Clock,
  },
  {
    key: OrderStatus.Cooking,
    label: 'Cooking',
    desc: 'The kitchen is preparing your food',
    icon: Flame,
  },
  {
    key: OrderStatus.Cooked,
    label: 'Ready',
    desc: 'Packed and waiting for a driver',
    icon: CheckCircle,
  },
  {
    key: OrderStatus.PickedUp,
    label: 'On the way',
    desc: 'Your driver has picked it up',
    icon: Bike,
  },
  {
    key: OrderStatus.Delivered,
    label: 'Delivered',
    desc: 'Enjoy your meal',
    icon: HeartHandshake,
  },
];

const ORDER_RANK: Record<OrderStatus, number> = {
  [OrderStatus.Pending]: 0,
  [OrderStatus.Cooking]: 1,
  [OrderStatus.Cooked]: 2,
  [OrderStatus.PickedUp]: 3,
  [OrderStatus.Delivered]: 4,
  [OrderStatus.DeliveryFailed]: 4,
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
          const isFailed = status === OrderStatus.DeliveryFailed && idx === 4;
          const Icon = isFailed ? XCircle : step.icon;

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
                    ? isFailed ? 'bg-red-500 text-white shadow-red-500/20' : 'bg-gradient-to-tr from-brand-500 to-amber-500 text-white shadow-brand-500/30 scale-110 ring-4 ring-brand-500/20 animate-pulse-subtle'
                    : 'bg-white dark:bg-slate-800 text-slate-300 dark:text-slate-600 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isDone ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
              </div>
              <span
                className={`text-xs font-bold mt-2.5 ${
                  isCurrent
                    ? isFailed ? 'text-red-600' : 'text-brand-600 dark:text-brand-400'
                    : isDone
                    ? 'text-slate-800 dark:text-slate-200'
                    : 'text-slate-400'
                }`}
              >
                {isFailed ? 'Delivery failed' : step.label}
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5 leading-tight line-clamp-1">
                {isFailed ? 'The order could not be delivered' : step.desc}
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
          const isFailed = status === OrderStatus.DeliveryFailed && idx === 4;
          const Icon = isFailed ? XCircle : step.icon;

          return (
            <div key={step.key} className="flex items-start gap-3 relative">
              <div
                className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs -ml-[23px] transition-all shadow-sm ${
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isCurrent
                    ? isFailed ? 'bg-red-500 text-white shadow-red-500/20' : 'bg-brand-500 text-white ring-2 ring-brand-400/30 scale-110'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700'
                }`}
              >
                {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div>
                <h4
                  className={`text-xs font-bold ${
                    isCurrent
                      ? isFailed ? 'text-red-600' : 'text-brand-600 dark:text-brand-400'
                      : isDone
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {isFailed ? 'Delivery failed' : step.label}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">{isFailed ? 'The order could not be delivered' : step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
