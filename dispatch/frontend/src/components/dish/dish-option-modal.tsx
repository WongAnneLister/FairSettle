'use client';

import React, { useState, useMemo } from 'react';
import { SafeImage } from '../ui/safe-image';
import { DEFAULT_DISH_PHOTO } from '@/lib/image-helper';
import { Plus, Minus, Check } from 'lucide-react';
import { Dish, DishOption } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { SelectedOption, useCart } from '@/lib/cart-context';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';

interface DishOptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  dish: Dish | null;
  restaurantId: number;
  restaurantName: string;
}

export function DishOptionModal({
  isOpen,
  onClose,
  dish,
  restaurantId,
  restaurantName,
}: DishOptionModalProps) {
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [selectedChoices, setSelectedChoices] = useState<Record<string, { choice: string; extraCents: number }>>({});

  // Reset choices on dish change
  React.useEffect(() => {
    if (dish && dish.options) {
      const initial: Record<string, { choice: string; extraCents: number }> = {};
      dish.options.forEach((opt) => {
        if (opt.choices && opt.choices.length > 0) {
          // Select first by default
          initial[opt.name] = {
            choice: opt.choices[0].name,
            extraCents: opt.choices[0].extraCents || opt.extraCents || 0,
          };
        }
      });
      setSelectedChoices(initial);
      setQuantity(1);
    }
  }, [dish]);

  const totalUnitCents = useMemo(() => {
    if (!dish) return 0;
    const extra = Object.values(selectedChoices).reduce(
      (sum, item) => sum + (item.extraCents || 0),
      0
    );
    return dish.priceCents + extra;
  }, [dish, selectedChoices]);

  const handleAddToCart = () => {
    if (!dish) return;

    const formattedOptions: SelectedOption[] = Object.entries(selectedChoices).map(
      ([name, val]) => ({
        name,
        choice: val.choice,
        extraCents: val.extraCents,
      })
    );

    addItem(restaurantId, restaurantName, dish, formattedOptions, quantity);
    onClose();
  };

  if (!dish) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md">
      <div className="flex flex-col gap-5">
        {/* Photo if present */}
        {dish.photo && (
          <div className="relative w-full h-48 rounded-2xl overflow-hidden -mt-2">
            <SafeImage
              src={dish.photo}
              fallback={DEFAULT_DISH_PHOTO}
              alt={dish.name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 500px"
            />
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              {dish.name}
            </h3>
            <span className="text-lg font-black text-brand-600 dark:text-brand-400">
              {formatCents(dish.priceCents)}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            {dish.description}
          </p>
        </div>

        {/* Options Selection */}
        {dish.options && dish.options.length > 0 && (
          <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            {dish.options.map((option: DishOption) => (
              <div key={option.name} className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">
                    {option.name}
                  </h4>
                  <span className="text-[11px] text-slate-400">Choose one</span>
                </div>

                <div className="grid grid-cols-1 gap-1.5">
                  {option.choices && option.choices.length > 0 ? (
                    option.choices.map((choice) => {
                      const isSelected =
                        selectedChoices[option.name]?.choice === choice.name;
                      const extra = choice.extraCents || option.extraCents || 0;

                      return (
                        <button
                          key={choice.name}
                          type="button"
                          onClick={() =>
                            setSelectedChoices((prev) => ({
                              ...prev,
                              [option.name]: { choice: choice.name, extraCents: extra },
                            }))
                          }
                          className={`flex items-center justify-between px-3.5 py-2.5 rounded-2xl border text-xs font-semibold transition-all text-left ${
                            isSelected
                              ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/40 text-brand-900 dark:text-brand-200 shadow-sm'
                              : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                isSelected
                                  ? 'border-brand-500 bg-brand-500 text-white'
                                  : 'border-slate-300 dark:border-slate-600'
                              }`}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5" />}
                            </div>
                            <span>{choice.name}</span>
                          </div>
                          {extra > 0 && (
                            <span className="text-slate-500 font-medium">
                              +{formatCents(extra)}
                            </span>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-xs text-slate-400">No options available</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quantity & Add Action */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-2xl p-1">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-8 h-8 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm font-bold w-8 text-center text-slate-800 dark:text-slate-100">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="w-8 h-8 rounded-xl bg-white dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="flex-1 justify-between"
            onClick={handleAddToCart}
          >
            <span>Add to cart</span>
            <span>{formatCents(totalUnitCents * quantity)}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
