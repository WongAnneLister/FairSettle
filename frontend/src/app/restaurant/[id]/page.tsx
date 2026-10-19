'use client';

import React, { useState } from 'react';
import { SafeImage } from '@/components/ui/safe-image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@apollo/client';
import {
  MapPin,
  Clock,
  Star,
  Sparkles,
  ArrowLeft,
  ShoppingBag,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { RESTAURANT_QUERY } from '@/lib/graphql/queries';
import { Restaurant, Dish } from '@/lib/types';
import { DishCard } from '@/components/dish/dish-card';
import { DishOptionModal } from '@/components/dish/dish-option-modal';
import { useCart } from '@/lib/cart-context';
import { formatCents } from '@/lib/currency';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';

// Fallback menu if freshly created or testing
const FALLBACK_DISHES: Dish[] = [
  {
    id: 101,
    name: '玛格丽特特级黑松露披萨',
    priceCents: 1680,
    photo: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=600&q=80',
    description: '采用水牛马苏里拉芝士、圣马扎诺番茄酱、野生黑松露碎与新鲜罗勒叶。',
    options: [
      {
        name: '饼底规格',
        choices: [
          { name: '9寸意式薄脆', extraCents: 0 },
          { name: '12寸手工厚底', extraCents: 400 },
        ],
      },
      {
        name: '芝士加料',
        choices: [
          { name: '正常芝士', extraCents: 0 },
          { name: '双倍水牛芝士', extraCents: 300 },
          { name: '爆浆芝心卷边', extraCents: 500 },
        ],
      },
    ],
  },
  {
    id: 102,
    name: '经典帕尔马火腿火箭菜披萨',
    priceCents: 1880,
    photo: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80',
    description: '窖藏18个月帕尔马火腿切片，搭配清脆芝麻菜与帕玛森干酪片。',
    options: [
      {
        name: '规格大小',
        choices: [
          { name: '标准9寸', extraCents: 0 },
          { name: '尊享12寸', extraCents: 450 },
        ],
      },
    ],
  },
  {
    id: 103,
    name: '香烤香蒜迷迭香鸡翅 (4只)',
    priceCents: 850,
    photo: 'https://images.unsplash.com/photo-1527477378372-13224b17f8b9?auto=format&fit=crop&w=600&q=80',
    description: '慢烤鲜嫩多汁鸡中翅，佐以新鲜迷迭香与初榨橄榄油。',
    options: [
      {
        name: '蘸酱选择',
        choices: [
          { name: '秘制番茄辣酱', extraCents: 0 },
          { name: '蜂蜜芥末酱', extraCents: 50 },
          { name: '松露蛋黄酱', extraCents: 100 },
        ],
      },
    ],
  },
  {
    id: 104,
    name: '意式经典提拉米苏杯',
    priceCents: 680,
    photo: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=600&q=80',
    description: '马斯卡彭芝士搭配浓缩意式咖啡浸润的手指饼干，可可香气浓郁。',
    options: [],
  },
  {
    id: 105,
    name: '冷萃鲜柠气泡冰茶',
    priceCents: 450,
    photo: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
    description: '手工手打香水柠檬，搭配大吉岭红茶与清爽气泡水。',
    options: [
      {
        name: '甜度与冰量',
        choices: [
          { name: '标准冰·微糖', extraCents: 0 },
          { name: '少冰·无糖', extraCents: 0 },
          { name: '去冰·微糖', extraCents: 0 },
        ],
      },
    ],
  },
];

export default function RestaurantDetailPage() {
  const params = useParams();
  const restaurantId = parseInt(params.id as string, 10);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const { itemCount, totalCents, setIsOpen } = useCart();

  const { data, loading } = useQuery(RESTAURANT_QUERY, {
    variables: { input: { restaurantId: isNaN(restaurantId) ? 1 : restaurantId } },
    errorPolicy: 'all',
  });

  const backendRestaurant = data?.restaurant?.restaurant;

  const restaurant: Restaurant = backendRestaurant || {
    id: isNaN(restaurantId) ? 1 : restaurantId,
    name: '罗马手工披萨屋 Roma Artisan Pizza',
    coverImage: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80',
    address: '美食街88号 意式风情街B座',
    isPromoted: true,
    category: { id: 1, name: '披萨意面', slug: 'pizza' },
    menu: FALLBACK_DISHES,
  };

  const menuDishes: Dish[] =
    restaurant.menu && restaurant.menu.length > 0
      ? restaurant.menu
      : FALLBACK_DISHES;

  if (loading && !backendRestaurant) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Spinner className="w-8 h-8 text-brand-500" />
        <p className="text-xs text-slate-400">正在加载餐厅菜单与详情...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-28">
      {/* Cover Banner with Ambient Blur */}
      <div className="relative w-full h-72 sm:h-88 bg-slate-900 overflow-hidden">
        <SafeImage
          src={restaurant.coverImage}
          fallback="https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80"
          alt={restaurant.name}
          fill
          className="object-cover opacity-90 scale-102"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-transparent" />

        {/* Back Link */}
        <div className="absolute top-6 left-4 sm:left-8 z-10">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl glass-pill text-slate-800 text-xs font-bold shadow-md hover:bg-white transition-all active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回餐厅大厅</span>
          </Link>
        </div>

        {/* Banner Details */}
        <div className="absolute bottom-6 left-4 sm:left-8 right-4 sm:right-8 z-10 text-white flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {restaurant.isPromoted && (
              <span className="flex items-center gap-1 bg-gradient-to-r from-amber-500 to-amber-600 text-white px-3 py-1 rounded-full text-xs font-black shadow-md border border-white/20">
                <Sparkles className="w-3 h-3 text-amber-200" />
                精选置顶
              </span>
            )}
            {restaurant.category && (
              <span className="glass-pill text-white px-3 py-1 rounded-full text-xs font-semibold">
                {restaurant.category.name}
              </span>
            )}
            <div className="flex items-center gap-1 bg-black/40 backdrop-blur-md border border-white/10 px-2.5 py-1 rounded-full text-xs text-amber-300 font-bold">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span>4.9 (500+评价)</span>
            </div>
          </div>

          <h1 className="text-2xl sm:text-4xl font-black tracking-tight drop-shadow-sm text-white">
            {restaurant.name}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-200 mt-1">
            <div className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-brand-400" />
              <span>{restaurant.address}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              <span>预计 25-35 分钟现做现送</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Menu Column */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/60">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  精选菜单
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  所有餐品现点现做，支持自定义配料与规格
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-600 glass-pill px-3 py-1 rounded-full">
                共 {menuDishes.length} 道美味
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {menuDishes.map((dish) => (
                <DishCard
                  key={dish.id}
                  dish={dish}
                  restaurantId={restaurant.id}
                  restaurantName={restaurant.name}
                  onCustomize={(d) => setSelectedDish(d)}
                />
              ))}
            </div>
          </div>

          {/* Right sidebar: Notice & Security guarantees */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="glass-card p-6 rounded-3xl flex flex-col gap-3">
              <div className="flex items-center gap-2 text-brand-600 font-bold text-sm">
                <Info className="w-4 h-4" />
                <span>进店点单须知</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                下单后订单将进入并发硬化调度状态机。商家接单制作完毕后，平台将以毫秒级时延广播至周边认证骑手。
              </p>
              <div className="pt-3 border-t border-slate-200/60 flex items-center gap-2 text-xs text-emerald-600 font-semibold">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>餐损全额赔付 · 准时宝必达保障</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dish Customization Modal */}
      <DishOptionModal
        isOpen={selectedDish !== null}
        onClose={() => setSelectedDish(null)}
        dish={selectedDish}
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
      />

      {/* Bottom Floating Cart Bar for Mobile & Quick Access */}
      {itemCount > 0 && (
        <div className="fixed bottom-5 left-4 right-4 max-w-md mx-auto z-40">
          <button
            onClick={() => setIsOpen(true)}
            className="w-full glass-panel hover:bg-white p-3.5 rounded-3xl shadow-2xl border border-white/95 flex items-center justify-between transition-all duration-200 active:scale-98 animate-in slide-in-from-bottom-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-brand-500 to-amber-500 text-white flex items-center justify-center font-black text-xs shadow-md shadow-brand-500/20">
                {itemCount}
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-900 leading-tight">查看购物车小票</p>
                <p className="text-[10px] text-slate-400">含所选规格加料</p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-black text-base text-brand-600">
              <span>{formatCents(totalCents)}</span>
              <ShoppingBag className="w-4 h-4" />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
