'use client';

import React from 'react';
import Link from 'next/link';
import { X, ShoppingBag, Trash2, Plus, Minus, ArrowRight, Store } from 'lucide-react';
import { useCart } from '@/lib/cart-context';
import { formatCents } from '@/lib/currency';
import { Button } from '../ui/button';

export function CartDrawer() {
  const {
    isOpen,
    setIsOpen,
    restaurantName,
    items,
    itemCount,
    subtotalCents,
    totalCents,
    updateQuantity,
    removeItem,
    clearCart,
  } = useCart();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-md transition-opacity"
        onClick={() => setIsOpen(false)}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md glass-panel shadow-[0_25px_60px_-15px_rgba(15,23,42,0.25)] flex flex-col border-l border-white/80 animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="p-5 border-b border-slate-200/50 flex items-center justify-between bg-white/50 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-brand-500 to-amber-500 text-white flex items-center justify-center font-bold shadow-md shadow-brand-500/20">
                <ShoppingBag className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  Your cart
                </h3>
                <p className="text-[11px] text-slate-400 font-medium">
                  {itemCount} items selected
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-white/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Restaurant Banner if items exist */}
          {restaurantName && items.length > 0 && (
            <div className="px-5 py-2.5 bg-amber-500/10 backdrop-blur-md border-b border-amber-500/15 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-amber-900 font-bold truncate">
                <Store className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                <span className="truncate">{restaurantName}</span>
              </div>
              <button
                onClick={clearCart}
                className="text-amber-700 hover:text-red-500 font-semibold shrink-0 ml-2"
              >
                Clear
              </button>
            </div>
          )}

          {/* Items List */}
          <div className="flex-1 overflow-y-auto p-5 divide-y divide-slate-200/40 space-y-2">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="w-16 h-16 rounded-3xl glass-pill flex items-center justify-center text-slate-300 mb-4 shadow-sm">
                  <ShoppingBag className="w-8 h-8" />
                </div>
                <h4 className="font-bold text-slate-800 text-base mb-1">
                  Your cart is empty
                </h4>
                <p className="text-xs text-slate-400 max-w-xs mb-6">
                  Choose your favorite dishes to get started.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                >
                  Explore restaurants
                </Button>
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="py-3.5 flex gap-3 group">
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                        {item.dish.name}
                      </h4>
                      <span className="text-xs sm:text-sm font-black text-slate-900 shrink-0">
                        {formatCents(item.itemTotalCents)}
                      </span>
                    </div>

                    {/* Options if chosen */}
                    {item.options.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.options.map((opt, i) => (
                          <span
                            key={i}
                            className="inline-block text-[10px] glass-pill text-slate-600 px-2 py-0.5 rounded-md font-medium"
                          >
                            {opt.name}: {opt.choice || 'Selected'}
                            {opt.extraCents ? ` (+${formatCents(opt.extraCents)})` : ''}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Quantity controls & Remove */}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 glass-pill rounded-xl p-0.5">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="w-6 h-6 rounded-lg bg-white flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors shadow-xs"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-xs font-bold w-6 text-center text-slate-800">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="w-6 h-6 rounded-lg bg-white flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors shadow-xs"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1"
                        title="Remove item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer / Summary with Frosted Glass Receipt */}
          {items.length > 0 && (
            <div className="p-5 border-t border-slate-200/50 bg-white/70 backdrop-blur-xl flex flex-col gap-3">
              <div className="space-y-1.5 text-xs text-slate-500">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-semibold text-slate-800">
                    {formatCents(subtotalCents)}
                  </span>
                </div>
                <div className="border-t border-slate-200/60 pt-2 flex justify-between text-sm font-black text-slate-900">
                  <span>Total</span>
                  <span className="text-brand-600 text-lg">
                    {formatCents(totalCents)}
                  </span>
                </div>
              </div>

              <Link
                href="/checkout"
                onClick={() => setIsOpen(false)}
                className="w-full"
              >
                <Button variant="primary" size="lg" className="w-full gap-2">
                  <span>Checkout</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
