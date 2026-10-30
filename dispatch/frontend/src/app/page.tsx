'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@apollo/client';
import {
  Search,
  Sparkles,
  Flame,
  ChefHat,
  Bike,
  Store,
  Compass,
} from 'lucide-react';
import { ALL_RESTAURANTS_QUERY, ALL_CATEGORIES_QUERY } from '@/lib/graphql/queries';
import { Restaurant, Category } from '@/lib/types';
import { RestaurantCard } from '@/components/restaurant/restaurant-card';
import { CategoryPills } from '@/components/restaurant/category-pills';
import { SafeImage } from '@/components/ui/safe-image';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Queries
  const { data: restData, loading: restLoading } = useQuery(ALL_RESTAURANTS_QUERY, {
    variables: { input: { page: 1 } },
    errorPolicy: 'all',
  });

  const { data: catData } = useQuery(ALL_CATEGORIES_QUERY, {
    errorPolicy: 'all',
  });

  const restaurants: Restaurant[] = restData?.restaurants?.results || [];
  const categories: Category[] = catData?.allCategories?.categories || [];

  // Filter restaurants by category and search
  const filteredRestaurants = useMemo(() => {
    return restaurants.filter((r) => {
      const matchSearch =
        searchQuery.trim() === '' ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.category?.name.toLowerCase().includes(searchQuery.toLowerCase());

      const matchCategory =
        !selectedCategory ||
        r.category?.slug.toLowerCase() === selectedCategory.toLowerCase();

      return matchSearch && matchCategory;
    });
  }, [restaurants, searchQuery, selectedCategory]);

  const promotedRestaurants = useMemo(() => {
    return restaurants.filter((r) => r.isPromoted);
  }, [restaurants]);

  return (
    <div className="flex flex-col gap-12 pb-20 relative">
      {/* Hero Section with Layered Glassmorphism */}
      <section className="relative pt-8 pb-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full glass-pill w-fit text-xs font-bold text-slate-800 shadow-sm">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-brand-600 font-black">全城 27 家匠心名店</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-700 font-semibold">538+ 道品质佳肴在线热销</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 tracking-tight leading-[1.12]">
                热气出锅，
                <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-500 via-brand-600 to-amber-500">
                  30分钟直达
                </span>
                您的餐桌
              </h1>

              <p className="text-sm sm:text-base text-slate-600 max-w-lg leading-relaxed font-normal">
                汇聚城中品质手作匠心餐厅。全程透明后厨出餐流水线与骑手原子高并发抢单派送，为您锁住刚出锅的绝佳风味。
              </p>

              {/* Frosted Glass Search Bar */}
              <div className="relative max-w-xl">
                <div className="glass-panel p-2 rounded-3xl flex items-center shadow-[0_16px_40px_-8px_rgba(15,23,42,0.07),inset_0_1px_1.5px_0_rgba(255,255,255,0.95)] border border-white/90">
                  <div className="pl-4 pr-2 text-slate-400">
                    <Search className="w-4 h-4 text-brand-500" />
                  </div>
                  <input
                    type="text"
                    placeholder="搜索餐厅名、披萨、黑松露、炙烤和牛、拉面..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full py-2.5 px-2 text-xs sm:text-sm bg-transparent outline-none text-slate-900 placeholder:text-slate-400 font-medium"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
                    >
                      清空
                    </button>
                  )}
                  <Button
                    variant="primary"
                    size="md"
                    className="rounded-2xl shrink-0 px-5 text-xs font-bold"
                  >
                    探索美味
                  </Button>
                </div>
              </div>

              {/* Quick Role Experience Banners */}
              <div className="flex flex-wrap items-center gap-2.5 pt-1 text-xs">
                <span className="text-slate-400 font-medium text-[11px]">快速角色体验：</span>
                <Link
                  href="/login"
                  className="glass-pill px-3 py-1.5 rounded-xl text-slate-700 hover:text-brand-600 hover:border-brand-200 transition-all font-semibold flex items-center gap-1.5"
                >
                  <Store className="w-3.5 h-3.5 text-brand-500" />
                  <span>一键免密登录</span>
                </Link>
                <Link
                  href="/owner"
                  className="glass-pill px-3 py-1.5 rounded-xl text-amber-800 hover:text-amber-900 hover:border-amber-300 transition-all font-semibold flex items-center gap-1.5"
                >
                  <ChefHat className="w-3.5 h-3.5 text-amber-500" />
                  <span>店长后厨大屏</span>
                </Link>
                <Link
                  href="/driver"
                  className="glass-pill px-3 py-1.5 rounded-xl text-emerald-800 hover:text-emerald-900 hover:border-emerald-300 transition-all font-semibold flex items-center gap-1.5"
                >
                  <Bike className="w-3.5 h-3.5 text-emerald-500" />
                  <span>骑手抢单大厅</span>
                </Link>
              </div>
            </div>

            {/* Right Curated Photo with Floating Glass Elements */}
            <div className="lg:col-span-5 relative">
              <div className="relative w-full h-[360px] sm:h-[420px] rounded-3xl overflow-hidden shadow-[0_24px_60px_-12px_rgba(15,23,42,0.18)] border border-white/80">
                <SafeImage
                  src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1000&q=80"
                  alt="Delicious culinary food"
                  fill
                  className="object-cover"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-black/10" />

                {/* Top Floating Glass Badge */}
                <div className="absolute top-4 right-4 glass-panel px-3.5 py-2 rounded-2xl flex items-center gap-2 border border-white/80 shadow-lg animate-float">
                  <div className="w-6 h-6 rounded-lg bg-brand-500 text-white flex items-center justify-center">
                    <Flame className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-bold text-slate-800 leading-tight">现点现烤出餐中</p>
                    <p className="text-[9px] text-slate-400">平均出餐 12 分钟</p>
                  </div>
                </div>

                {/* Bottom Floating Frosted Glass Dock */}
                <div className="absolute bottom-4 left-4 right-4 p-4 rounded-3xl glass-panel border border-white/90 shadow-2xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white flex items-center justify-center font-bold shadow-md shadow-emerald-500/20">
                      <Bike className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <p className="text-xs font-black text-slate-900">
                          毫秒级原子抢单调度
                        </p>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        TypeORM 状态机 · 零并发重派
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-black text-brand-700 bg-brand-100/80 border border-brand-200/50 px-2.5 py-1 rounded-xl">
                      99.9% 准时率
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories Bar */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Compass className="w-4 h-4 text-brand-500" />
              <span>精选风味分类 ({categories.length} 大品类)</span>
            </h2>
            <span className="text-xs text-slate-400 font-medium">点击分类快速筛选</span>
          </div>

          <CategoryPills
            categories={categories}
            selectedSlug={selectedCategory}
            onSelect={setSelectedCategory}
          />
        </div>
      </section>

      {/* Promoted Section */}
      {promotedRestaurants.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  <span>店长力荐·置顶臻选 ({promotedRestaurants.length} 家名店)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  全城高口碑人气热销外卖合作餐厅，新鲜食材现点现做
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {promotedRestaurants.map((restaurant) => (
                <RestaurantCard key={restaurant.id} restaurant={restaurant} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* All Restaurants Grid (27 Restaurants) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                <Store className="w-5 h-5 text-brand-500" />
                <span>
                  {selectedCategory
                    ? `${categories.find((c) => c.slug === selectedCategory)?.name || '分类'}美食名店`
                    : '全部入驻品质餐厅'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                共有 <strong className="text-slate-800 font-black">{filteredRestaurants.length}</strong> 家餐厅正在营业接单，点击进入可浏览该店完整特色菜单
              </p>
            </div>
          </div>

          {restLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <Spinner className="w-8 h-8 text-brand-500" />
              <p className="text-xs text-slate-400">正在同步全城餐厅列表...</p>
            </div>
          ) : filteredRestaurants.length === 0 ? (
            <div className="py-16 glass-card rounded-3xl text-center p-8 flex flex-col items-center justify-center">
              <Store className="w-12 h-12 text-slate-300 mb-3" />
              <h3 className="font-bold text-slate-800 text-base">
                未找到相关餐厅
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4">
                尝试换一个关键词，或者清除分类筛选条件
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory(null);
                }}
              >
                重置筛选条件
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredRestaurants.map((restaurant) => (
                <RestaurantCard key={restaurant.id} restaurant={restaurant} />
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
