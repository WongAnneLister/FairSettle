'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { SafeImage } from '@/components/ui/safe-image';
import { DEFAULT_DISH_PHOTO } from '@/lib/image-helper';
import { useParams } from 'next/navigation';
import { useQuery, useMutation } from '@apollo/client';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Utensils,
  DollarSign,
  Layers,
  X,
  PlusCircle,
  ChefHat,
  Sparkles,
} from 'lucide-react';
import { MY_RESTAURANT_QUERY } from '@/lib/graphql/queries';
import { CREATE_DISH_MUTATION, DELETE_DISH_MUTATION } from '@/lib/graphql/mutations';
import { Dish, DishOption } from '@/lib/types';
import { formatCents } from '@/lib/currency';
import { createDishInput, DishOptionForm } from '@/lib/dish-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/lib/toast-context';

export default function RestaurantMenuManagerPage() {
  const params = useParams();
  const restaurantId = parseInt(params.id as string, 10);
  const { success, error } = useToast();

  const { data, loading, refetch } = useQuery(MY_RESTAURANT_QUERY, {
    variables: { input: { id: restaurantId } },
    errorPolicy: 'all',
  });

  const [createDish, { loading: creating }] = useMutation(CREATE_DISH_MUTATION);
  const [deleteDish, { loading: deleting }] = useMutation(DELETE_DISH_MUTATION);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState('');

  // Dynamic Options state
  const [options, setOptions] = useState<DishOptionForm[]>([]);

  const restaurant = data?.myRestaurant?.restaurant;
  const menu: Dish[] = restaurant?.menu || [];

  const handleAddOptionGroup = () => {
    setOptions((prev) => [
      ...prev,
      {
        name: 'Options',
        choices: [
          { name: 'Standard', extraDollars: '0.00' },
          { name: 'Premium', extraDollars: '3.00' },
        ],
      },
    ]);
  };

  const handleRemoveOptionGroup = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddChoice = (groupIndex: number) => {
    setOptions((prev) => {
      const copy = [...prev];
      copy[groupIndex].choices.push({ name: 'New option', extraDollars: '1.00' });
      return copy;
    });
  };

  const handleRemoveChoice = (groupIndex: number, choiceIndex: number) => {
    setOptions((prev) => {
      const copy = [...prev];
      copy[groupIndex].choices = copy[groupIndex].choices.filter(
        (_, i) => i !== choiceIndex
      );
      return copy;
    });
  };

  const handleCreateDish = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = createDishInput({ restaurantId, name, priceDollars, description, photo, options });
    if (!result.ok) {
      error('Check the dish details', result.error);
      return;
    }

    try {
      const res = await createDish({
        variables: { input: result.input },
      });

      if (res.data?.createDish?.ok) {
        success('Dish added', `${name} is now on the menu`);
        setIsModalOpen(false);
        setName('');
        setPriceDollars('');
        setDescription('');
        setPhoto('');
        setOptions([]);
        refetch();
      } else {
        error('Could not add dish', res.data?.createDish?.error || 'Please try again later');
      }
    } catch (err: any) {
      error('Submission failed', err.message);
    }
  };

  const handleDeleteDish = async (dishId: number, dishName: string) => {
    if (!confirm(`Delete the dish "${dishName}"?`)) return;

    try {
      const res = await deleteDish({
        variables: { input: { dishId } },
      });

      if (res.data?.deleteDish?.ok) {
        success('Dish deleted');
        refetch();
      } else {
        error('Delete failed', res.data?.deleteDish?.error);
      }
    } catch (err: any) {
      error('Action failed', err.message);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Link
            href="/owner/restaurants"
            className="p-2.5 rounded-2xl glass-card hover:bg-white transition-all text-slate-600 shadow-sm border border-white/80"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {restaurant?.name ? `${restaurant.name} · Menu management` : 'Dishes and menu'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Add dishes, customize options and set prices
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => setIsModalOpen(true)}
          className="gap-2 shadow-lg shadow-brand-500/20"
        >
          <Plus className="w-4 h-4" />
          <span>Add dish</span>
        </Button>
      </div>

      {/* Dishes List */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3">
          <Spinner className="w-8 h-8 text-amber-500" />
          <p className="text-xs text-slate-400">Loading menu...</p>
        </div>
      ) : menu.length === 0 ? (
        <div className="py-20 glass-panel rounded-[32px] text-center p-8 flex flex-col items-center justify-center border border-white/80">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-4 border border-amber-500/20">
            <Utensils className="w-8 h-8" />
          </div>
          <h3 className="font-black text-slate-900 text-lg">
            No dishes on the menu yet
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1 mb-6 leading-relaxed">
            Add your first dish so customers can order it from your restaurant.
          </p>
          <Button
            variant="primary"
            size="md"
            onClick={() => setIsModalOpen(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add your first dish</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {menu.map((dish) => (
            <div
              key={dish.id}
              className="glass-card glass-card-hover rounded-[28px] p-5 flex justify-between gap-4 group"
            >
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-black text-slate-900 text-base group-hover:text-brand-600 transition-colors">
                      {dish.name}
                    </h3>
                    <span className="text-base font-black text-brand-600 shrink-0">
                      {formatCents(dish.priceCents)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {dish.description}
                  </p>

                  {/* Options count */}
                  {dish.options && dish.options.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {dish.options.map((opt, i) => (
                        <span
                          key={i}
                          className="text-[11px] bg-slate-100/90 text-slate-700 px-2 py-0.5 rounded-lg font-medium border border-slate-200/50"
                        >
                          {opt.name} ({opt.choices?.length || 0} options)
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteDish(dish.id, dish.name)}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1.5 text-xs font-semibold"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete dish</span>
                  </Button>
                </div>
              </div>

              {dish.photo && (
                <div className="relative w-28 h-28 rounded-2xl overflow-hidden bg-slate-100 shrink-0 shadow-sm border border-white">
                  <SafeImage
                    src={dish.photo}
                    fallback={DEFAULT_DISH_PHOTO}
                    alt={dish.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Dish Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add a dish and options"
        maxWidth="lg"
      >
        <form onSubmit={handleCreateDish} className="flex flex-col gap-4">
          <Input
            label="Dish name (at least 5 characters)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={5}
            placeholder="For example: Angus beef pizza"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Base price (dollars)"
              inputMode="decimal"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              required
              placeholder="For example: 14.50"
              icon={<DollarSign className="w-4 h-4 text-slate-400" />}
            />

            <Input
              label="Dish photo URL (optional)"
              value={photo}
              onChange={(e) => setPhoto(e.target.value)}
              placeholder="https://images.unsplash.com/..."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-slate-700">
              Dish description (5-256 characters)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={5}
              maxLength={256}
              rows={3}
              placeholder="Describe the ingredients, preparation and flavors..."
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200/80 text-slate-900 text-xs outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Dynamic Option Groups */}
          <div className="pt-3 border-t border-slate-100 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                  Custom options and extras
                </h4>
                <p className="text-[11px] text-slate-400">
                  For example: size, extra cheese or spice level
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddOptionGroup}
                className="gap-1.5 text-xs font-semibold"
              >
                <PlusCircle className="w-3.5 h-3.5 text-brand-500" />
                <span>Add option group</span>
              </Button>
            </div>

            {options.map((optGroup, gIdx) => (
              <div
                key={gIdx}
                className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200/80 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={optGroup.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setOptions((prev) => {
                        const copy = [...prev];
                        copy[gIdx].name = val;
                        return copy;
                      });
                    }}
                    placeholder="Option group name (for example: cheese)"
                    className="font-bold text-xs bg-white border border-slate-200 rounded-xl focus:border-brand-500 outline-none px-3 py-1.5 text-slate-900 w-48 shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveOptionGroup(gIdx)}
                    className="text-slate-400 hover:text-red-500 p-1 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Choices list */}
                <div className="space-y-2 pl-3 border-l-2 border-slate-200">
                  {optGroup.choices.map((choice, cIdx) => (
                    <div key={cIdx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={choice.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOptions((prev) => {
                            const copy = [...prev];
                            copy[gIdx].choices[cIdx].name = val;
                            return copy;
                          });
                        }}
                        placeholder="Option name"
                        className="text-xs bg-white border border-slate-200 rounded-xl px-3 py-1.5 w-36 text-slate-900 shadow-sm outline-none focus:border-brand-500"
                      />
                      <span className="text-xs text-slate-400 font-bold">+ $</span>
                      <input
                        type="text"
                        value={choice.extraDollars}
                        inputMode="decimal"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOptions((prev) => {
                            const copy = [...prev];
                            copy[gIdx].choices[cIdx].extraDollars = val;
                            return copy;
                          });
                        }}
                        placeholder="0.00"
                        className="text-xs bg-white border border-slate-200 rounded-xl px-3 py-1.5 w-20 text-slate-900 shadow-sm outline-none focus:border-brand-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveChoice(gIdx, cIdx)}
                        className="text-slate-400 hover:text-red-500 p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => handleAddChoice(gIdx)}
                    className="text-xs font-bold text-brand-600 hover:underline pt-1 inline-flex items-center gap-1"
                  >
                    + Add choice
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 flex justify-end gap-2.5">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={creating}
            >
              Add dish
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
