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

export default function RestaurantDetailPage() {
  const params = useParams();
  const restaurantId = parseInt(params.id as string, 10);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const { itemCount, totalCents, setIsOpen } = useCart();

  const { data, loading } = useQuery(RESTAURANT_QUERY, {
    variables: { input: { restaurantId } },
    skip: !(restaurantId > 0),
    errorPolicy: 'all',
  });

  const backendRestaurant = data?.restaurant?.restaurant;

  if (loading && !backendRestaurant) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Spinner className="w-8 h-8 text-brand-500" />
        <p className="text-xs text-slate-400">Loading restaurant and menu...</p>
      </div>
    );
  }

  if (!backendRestaurant) {
    return (
      <div className="glass-card rounded-3xl p-8 mx-auto my-8 max-w-lg text-center flex flex-col items-center gap-4">
        <p className="font-bold text-slate-900">Restaurant not found or unavailable</p>
        <Link href="/" className="text-brand-600 font-semibold">Back to home</Link>
      </div>
    );
  }

  const restaurant: Restaurant = backendRestaurant;
  const menuDishes: Dish[] = backendRestaurant.menu ?? [];

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
            <span>Back to restaurants</span>
          </Link>
        </div>

        {/* Banner Details */}
        <div className="absolute bottom-6 left-4 sm:left-8 right-4 sm:right-8 z-10 text-white flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {restaurant.isPromoted && (
              <span className="flex items-center gap-1 bg-gradient-to-r from-amber-500 to-amber-600 text-white px-3 py-1 rounded-full text-xs font-black shadow-md border border-white/20">
                <Sparkles className="w-3 h-3 text-amber-200" />
                Featured
              </span>
            )}
            {restaurant.category && (
              <span className="glass-pill text-white px-3 py-1 rounded-full text-xs font-semibold">
                {restaurant.category.name}
              </span>
            )}
            <div className="flex items-center gap-1 bg-black/40 backdrop-blur-md border border-white/10 px-2.5 py-1 rounded-full text-xs text-amber-300 font-bold">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span>4.9 (500+ reviews)</span>
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
              <span>Freshly prepared, delivered in 25-35 minutes</span>
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
                  Menu
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Made to order with your choice of options and extras
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-600 glass-pill px-3 py-1 rounded-full">
                {menuDishes.length} {menuDishes.length === 1 ? 'dish' : 'dishes'}
              </span>
            </div>

            {menuDishes.length === 0 ? (
              <div className="glass-card rounded-3xl p-8 text-center text-slate-500">
                No dishes available yet
              </div>
            ) : (
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
            )}
          </div>

          {/* Right sidebar: Notice & Security guarantees */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="glass-card p-6 rounded-3xl flex flex-col gap-3">
              <div className="flex items-center gap-2 text-brand-600 font-bold text-sm">
                <Info className="w-4 h-4" />
                <span>Ordering information</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                The restaurant prepares your order, then a driver picks it up for delivery.
              </p>
              <div className="pt-3 border-t border-slate-200/60 flex items-center gap-2 text-xs text-emerald-600 font-semibold">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Support for damaged or delayed deliveries</span>
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
                <p className="text-xs font-bold text-slate-900 leading-tight">View cart</p>
                <p className="text-[10px] text-slate-400">Includes selected options and extras</p>
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
