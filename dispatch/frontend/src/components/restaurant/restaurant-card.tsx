'use client';

import React from 'react';
import Link from 'next/link';
import { Sparkles, Clock, MapPin, Star } from 'lucide-react';
import { Restaurant } from '@/lib/types';
import { SafeImage } from '@/components/ui/safe-image';
import { DEFAULT_RESTAURANT_COVER } from '@/lib/image-helper';

interface RestaurantCardProps {
  restaurant: Restaurant;
}

export function RestaurantCard({ restaurant }: RestaurantCardProps) {
  return (
    <Link
      href={`/restaurant/${restaurant.id}`}
      className="group flex flex-col glass-card glass-card-hover rounded-3xl overflow-hidden cursor-pointer"
    >
      {/* Cover Image Container */}
      <div className="relative w-full h-48 bg-slate-100 overflow-hidden">
        <SafeImage
          src={restaurant.coverImage}
          fallback={DEFAULT_RESTAURANT_COVER}
          alt={restaurant.name}
          fill
          className="object-cover group-hover:scale-108 transition-transform duration-700 ease-out"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />

        {/* Gradient vignette on image */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 via-transparent to-transparent pointer-events-none" />

        {/* Promoted Tag */}
        {restaurant.isPromoted && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-gradient-to-r from-amber-500/95 to-amber-600/95 backdrop-blur-md text-white px-3 py-1 rounded-full text-[11px] font-black shadow-md shadow-amber-500/25 border border-white/20">
            <Sparkles className="w-3 h-3 text-amber-200" />
            <span>Featured</span>
          </div>
        )}

        {/* Category Tag with Frosted Glass */}
        {restaurant.category && (
          <div className="absolute top-3 right-3 bg-white/80 backdrop-blur-md text-slate-800 px-3 py-1 rounded-full text-[11px] font-bold shadow-sm border border-white/90">
            {restaurant.category.name}
          </div>
        )}

        {/* Quick Delivery Time Badge */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-slate-950/60 backdrop-blur-md text-white px-2.5 py-1 rounded-xl text-xs font-semibold border border-white/10">
          <Clock className="w-3.5 h-3.5 text-brand-400" />
          <span>25-35 minutes</span>
        </div>
      </div>

      {/* Info Body */}
      <div className="p-5 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-slate-900 text-base group-hover:text-brand-600 transition-colors line-clamp-1">
            {restaurant.name}
          </h3>
          <div className="flex items-center gap-1 text-xs font-bold text-slate-800 shrink-0 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>4.8</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
          <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{restaurant.address}</span>
        </div>
      </div>
    </Link>
  );
}
