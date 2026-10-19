'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useSubscription, useMutation } from '@apollo/client';
import {
  ArrowLeft,
  Store,
  Bike,
  Clock,
  ShieldCheck,
  Radio,
  RefreshCw,
  Sparkles,
  PhoneCall,
  ChefHat,
  PackageCheck,
} from 'lucide-react';
import { GET_ORDER_QUERY } from '@/lib/graphql/queries';
import { ORDER_UPDATES_SUBSCRIPTION } from '@/lib/graphql/subscriptions';
import { EDIT_ORDER_MUTATION, TAKE_ORDER_MUTATION } from '@/lib/graphql/mutations';
import { Order, OrderStatus, UserRole } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { OrderTimeline } from '@/components/order/order-timeline';
import { OrderStatusBadge } from '@/components/order/order-status-badge';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';

export default function OrderDetailPage() {
  const params = useParams();
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

  // Fallback demo order
  const order: Order = rawOrder || {
    id: orderId || 1,
    customerId: user?.id || 1,
    status: OrderStatus.Pending,
    totalCents: 2530,
    createdAt: new Date().toISOString(),
    restaurant: {
      id: 1,
      name: '罗马手工披萨屋 Roma Artisan Pizza',
      coverImage: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=600&q=80',
      address: '美食街88号 意式风情街B座',
      isPromoted: true,
    },
    items: [
      {
        id: 1,
        dish: {
          id: 101,
          name: '玛格丽特特级黑松露披萨',
          priceCents: 1680,
          description: '',
        },
        options: [{ name: '饼底规格', choice: '12寸手工厚底' }],
      },
      {
        id: 2,
        dish: {
          id: 105,
          name: '冷萃鲜柠气泡冰茶',
          priceCents: 450,
          description: '',
        },
        options: [{ name: '甜度与冰量', choice: '标准冰·微糖' }],
      },
    ],
  };

  const handleAdvanceStatus = async (nextStatus: OrderStatus) => {
    try {
      const res = await editOrder({
        variables: {
          input: {
            id: order.id,
            status: nextStatus,
          },
        },
      });
      if (res.data.editOrder.ok) {
        success('状态更新成功', `订单已推进至：${nextStatus}`);
        refetch();
      } else {
        error('操作受限', res.data.editOrder.error || '无权执行该状态变更');
      }
    } catch (e: any) {
      error('更新失败', e.message);
    }
  };

  const handleTakeOrder = async () => {
    try {
      const res = await takeOrder({
        variables: { input: { id: order.id } },
      });
      if (res.data.takeOrder.ok) {
        success('抢单成功！', '您已成为该订单的配送骑手');
        refetch();
      } else {
        error('抢单未成功', res.data.takeOrder.error || '手慢了，该订单已被其他骑手接走');
      }
    } catch (e: any) {
      error('抢单异常', e.message);
    }
  };

  if (loading && !data && !rawOrder) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <Spinner className="w-8 h-8 text-brand-500" />
        <p className="text-xs text-slate-400">正在建立实时订单信道...</p>
      </div>
    );
  }

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
                订单实时追踪 #{order.id}
              </h1>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 px-3 py-0.5 rounded-full backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                <span>实时推流已连线</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              下单时间：{new Date(order.createdAt || Date.now()).toLocaleTimeString()}
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
            <span>刷新状态</span>
          </Button>
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      {/* Visual Step Progress Frosted Glass Card */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-white/90 shadow-[0_20px_50px_0_rgba(15,23,42,0.06)] flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            实时派送生命周期
          </span>
          <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            预计还有 15-20 分钟送达
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
              {order.status === OrderStatus.Pending && '后厨已收到新订单提醒，即将开始烹饪制作。'}
              {order.status === OrderStatus.Cooking && '大厨正在后厨制作您的专属美食，请稍候。'}
              {order.status === OrderStatus.Cooked && '餐品已出餐装袋，周边骑手正在火速抢单接驾！'}
              {order.status === OrderStatus.PickedUp && '骑手已取餐，正在以安全合规的最快路线飞驰而来。'}
              {order.status === OrderStatus.Delivered && '餐品已送达，期待为您带来美妙的美食体验！'}
            </span>
          </div>
        </div>

        {/* Role Quick Simulation Controls */}
        <div className="pt-3 border-t border-slate-200/50 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-slate-400 font-medium text-[11px]">快捷推进演示：</span>
          <div className="flex flex-wrap items-center gap-2">
            {order.status === OrderStatus.Pending && (
              <Button
                variant="outline"
                size="sm"
                loading={updating}
                onClick={() => handleAdvanceStatus(OrderStatus.Cooking)}
                className="gap-1 glass-pill border-brand-200 text-brand-700 hover:bg-brand-50"
              >
                <ChefHat className="w-3.5 h-3.5 text-brand-500" />
                店长接单制作 (Cooking)
              </Button>
            )}

            {order.status === OrderStatus.Cooking && (
              <Button
                variant="outline"
                size="sm"
                loading={updating}
                onClick={() => handleAdvanceStatus(OrderStatus.Cooked)}
                className="gap-1 glass-pill border-blue-200 text-blue-700 hover:bg-blue-50"
              >
                <ChefHat className="w-3.5 h-3.5 text-blue-500" />
                后厨出餐完成 (Cooked)
              </Button>
            )}

            {order.status === OrderStatus.Cooked && (
              <Button
                variant="outline"
                size="sm"
                loading={claiming}
                onClick={handleTakeOrder}
                className="gap-1 glass-pill border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              >
                <Bike className="w-3.5 h-3.5 text-emerald-500" />
                骑手原子抢单 (takeOrder)
              </Button>
            )}

            {order.status === OrderStatus.Cooked && order.driver && (
              <Button
                variant="outline"
                size="sm"
                loading={updating}
                onClick={() => handleAdvanceStatus(OrderStatus.PickedUp)}
                className="gap-1 glass-pill border-purple-200 text-purple-700 hover:bg-purple-50"
              >
                <Bike className="w-3.5 h-3.5 text-purple-500" />
                骑手到店取餐 (PickedUp)
              </Button>
            )}

            {order.status === OrderStatus.PickedUp && (
              <Button
                variant="emerald"
                size="sm"
                loading={updating}
                onClick={() => handleAdvanceStatus(OrderStatus.Delivered)}
                className="gap-1.5"
              >
                <PackageCheck className="w-3.5 h-3.5" />
                确认已送达 (Delivered)
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Driver Card if assigned */}
        <div className="glass-card rounded-3xl p-6 flex flex-col justify-between gap-4 border border-white/90">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              配送骑手信息
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
                  认证即时派送员
                </h4>
                <p className="text-xs text-slate-400 truncate">{order.driver.email}</p>
                <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                  已完成实名与健康证双认证
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
              <p>餐品正在制作中，出餐完成后由认证骑手秒级抢单分配</p>
            </div>
          )}
        </div>

        {/* Restaurant Card */}
        <div className="glass-card rounded-3xl p-6 flex flex-col justify-between gap-4 border border-white/90">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              出餐门店
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
                {order.restaurant?.name || '品质合作餐厅'}
              </h4>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                {order.restaurant?.address || '美食街88号'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Items Breakdown */}
      <div className="glass-card rounded-3xl p-6 sm:p-7 flex flex-col gap-4 border border-white/90">
        <h3 className="font-bold text-slate-900 text-base">
          订单商品明细
        </h3>

        <div className="divide-y divide-slate-200/50">
          {order.items?.map((item) => (
            <div key={item.id} className="py-3.5 flex justify-between items-start gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {item.dish?.name || '精选菜品'}
                </p>
                {item.options && item.options.length > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {item.options
                      .map((o) => `${o.name}: ${o.choice || '已选'}`)
                      .join('，')}
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
          <span className="text-xs font-semibold text-slate-500">实付总计</span>
          <span className="text-2xl font-black text-brand-600">
            {formatCents(order.totalCents)}
          </span>
        </div>
      </div>
    </div>
  );
}
