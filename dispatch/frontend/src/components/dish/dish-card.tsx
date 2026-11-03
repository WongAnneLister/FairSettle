'use client';

import React from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { Dish } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { useCart } from '@/lib/cart-context';
import { SafeImage } from '@/components/ui/safe-image';
import { DEFAULT_DISH_PHOTO } from '@/lib/image-helper';

interface DishCardProps {
  dish: Dish;
  restaurantId: number;
  restaurantName: string;
  onCustomize: (dish: Dish) => void;
}

export function DishCard({
  dish,
  restaurantId,
  restaurantName,
  onCustomize,
}: DishCardProps) {
  const { addItem } = useCart();
  const hasOptions = dish.options && dish.options.length > 0;

  const handleClick = () => {
    if (hasOptions) {
      onCustomize(dish);
    } else {
      addItem(restaurantId, restaurantName, dish, []);
    }
  };

  return (
    <div className="flex glass-card glass-card-hover rounded-3xl p-4 justify-between gap-4 group cursor-pointer border border-white/80">
      <div className="flex-1 flex flex-col justify-between">
        <div>
          <h4 className="font-bold text-slate-900 text-sm sm:text-base group-hover:text-brand-600 transition-colors line-clamp-1">
            {dish.name}
          </h4>
          <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
            {dish.description}
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-base font-black text-slate-900">
            {formatCents(dish.priceCents)}
          </span>

          <button
            onClick={handleClick}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 active:scale-95 ${
              hasOptions
                ? 'glass-pill text-slate-700 hover:text-brand-600 hover:border-brand-300'
                : 'bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white shadow-md shadow-brand-500/20'
            }`}
          >
            {hasOptions ? (
              <>
                <SlidersHorizontal className="w-3.5 h-3.5 text-brand-500" />
                <span>Choose options</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </>
            )}
          </button>
        </div>
      </div>

      {dish.photo && (
        <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-2xl overflow-hidden bg-slate-100 border border-white/90 shadow-inner">
          <SafeImage
            src={dish.photo}
            fallback={DEFAULT_DISH_PHOTO}
            alt={dish.name}
            fill
            className="object-cover group-hover:scale-108 transition-transform duration-500 ease-out"
            sizes="120px"
          />
        </div>
      )}
    </div>
  );
}
