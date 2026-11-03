'use client';

import React from 'react';
import { Category } from '@/lib/types';
import { Pizza, Coffee, Soup, Utensils, Flame, Sparkles } from 'lucide-react';

interface CategoryPillsProps {
  categories: Category[];
  selectedSlug: string | null;
  onSelect: (slug: string | null) => void;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  pizza: <Pizza className="w-3.5 h-3.5" />,
  burger: <Utensils className="w-3.5 h-3.5" />,
  fastfood: <Flame className="w-3.5 h-3.5" />,
  drinks: <Coffee className="w-3.5 h-3.5" />,
  soup: <Soup className="w-3.5 h-3.5" />,
  japanese: <Soup className="w-3.5 h-3.5" />,
  noodles: <Soup className="w-3.5 h-3.5" />,
  chinese: <Flame className="w-3.5 h-3.5" />,
  healthy: <Utensils className="w-3.5 h-3.5" />,
  dessert: <Coffee className="w-3.5 h-3.5" />,
};

export function CategoryPills({
  categories,
  selectedSlug,
  onSelect,
}: CategoryPillsProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none py-1">
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold shrink-0 transition-all duration-200 active:scale-95 ${
          selectedSlug === null
            ? 'glass-pill-active'
            : 'glass-pill text-slate-700 hover:bg-white hover:border-slate-300'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <span>All categories</span>
      </button>

      {categories.map((cat) => {
        const isSelected = selectedSlug === cat.slug;
        const icon = CATEGORY_ICONS[cat.slug.toLowerCase()] || <Utensils className="w-3.5 h-3.5" />;

        return (
          <button
            key={cat.id}
            onClick={() => onSelect(isSelected ? null : cat.slug)}
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold shrink-0 transition-all duration-200 active:scale-95 ${
              isSelected
                ? 'glass-pill-active'
                : 'glass-pill text-slate-700 hover:bg-white hover:border-slate-300'
            }`}
          >
            {icon}
            <span>{cat.name}</span>
            {cat.restaurantCount !== undefined && cat.restaurantCount > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {cat.restaurantCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
