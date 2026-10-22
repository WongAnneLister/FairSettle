'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { Dish } from './types';
import { useToast } from './toast-context';

export interface SelectedOption {
  name: string;
  choice?: string;
  extraCents?: number;
}

export interface CartItem {
  id: string; // unique hash
  dish: Dish;
  quantity: number;
  options: SelectedOption[];
  itemUnitCents: number;
  itemTotalCents: number;
}

interface CartContextValue {
  restaurantId: number | null;
  restaurantName: string | null;
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  totalCents: number;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  addItem: (
    restaurantId: number,
    restaurantName: string,
    dish: Dish,
    options?: SelectedOption[],
    quantity?: number
  ) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const { success, info } = useToast();

  // Load cart from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('food_cart');
        if (saved) {
          const parsed = JSON.parse(saved);
          setRestaurantId(parsed.restaurantId || null);
          setRestaurantName(parsed.restaurantName || null);
          setItems(parsed.items || []);
        }
      } catch (e) {
        console.error('Failed to parse saved cart:', e);
      }
    }
  }, []);

  // Save cart to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'food_cart',
        JSON.stringify({ restaurantId, restaurantName, items })
      );
    }
  }, [restaurantId, restaurantName, items]);

  const addItem = useCallback(
    (
      newRestId: number,
      newRestName: string,
      dish: Dish,
      options: SelectedOption[] = [],
      quantity = 1
    ) => {
      // If switching restaurants, clear previous cart items
      if (restaurantId && restaurantId !== newRestId && items.length > 0) {
        if (
          !confirm(
            `您的购物车中有来自「${restaurantName}」的菜品。添加「${newRestName}」的菜品将清空之前的商品，是否继续？`
          )
        ) {
          return;
        }
        setItems([]);
      }

      setRestaurantId(newRestId);
      setRestaurantName(newRestName);

      // Compute item unit price
      const optionsExtra = options.reduce((sum, opt) => sum + (opt.extraCents || 0), 0);
      const unitPrice = dish.priceCents + optionsExtra;

      // Unique identifier based on dish ID and sorted options
      const optKey = options
        .map((o) => `${o.name}:${o.choice || ''}`)
        .sort()
        .join('|');
      const uniqueItemId = `${dish.id}-${optKey}`;

      setItems((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === uniqueItemId);
        if (existingIndex > -1) {
          const updated = [...prev];
          const newQty = updated[existingIndex].quantity + quantity;
          updated[existingIndex] = {
            ...updated[existingIndex],
            quantity: newQty,
            itemTotalCents: newQty * unitPrice,
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id: uniqueItemId,
              dish,
              quantity,
              options,
              itemUnitCents: unitPrice,
              itemTotalCents: unitPrice * quantity,
            },
          ];
        }
      });

      success(`已加入购物车`, `${dish.name} × ${quantity}`);
    },
    [restaurantId, restaurantName, items.length, success]
  );

  const removeItem = useCallback((itemId: string) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== itemId);
      if (next.length === 0) {
        setRestaurantId(null);
        setRestaurantName(null);
      }
      return next;
    });
  }, []);

  const updateQuantity = useCallback((itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== itemId);
        if (next.length === 0) {
          setRestaurantId(null);
          setRestaurantName(null);
        }
        return next;
      });
      return;
    }

    setItems((prev) =>
      prev.map((item) => {
        if (item.id === itemId) {
          return {
            ...item,
            quantity,
            itemTotalCents: quantity * item.itemUnitCents,
          };
        }
        return item;
      })
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setRestaurantId(null);
    setRestaurantName(null);
    info('购物车已清空');
  }, [info]);

  const itemCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const subtotalCents = useMemo(
    () => items.reduce((sum, item) => sum + item.itemTotalCents, 0),
    [items]
  );

  // Delivery fee: $2.50 (250 cents) if under $35, free otherwise
  const deliveryFeeCents = useMemo(() => {
    if (items.length === 0) return 0;
    return subtotalCents >= 3500 ? 0 : 250;
  }, [items.length, subtotalCents]);

  const serviceFeeCents = useMemo(() => {
    if (items.length === 0) return 0;
    return 150; // $1.50 platform packaging and service fee
  }, [items.length]);

  const totalCents = useMemo(
    () => subtotalCents + deliveryFeeCents + serviceFeeCents,
    [subtotalCents, deliveryFeeCents, serviceFeeCents]
  );

  return (
    <CartContext.Provider
      value={{
        restaurantId,
        restaurantName,
        items,
        itemCount,
        subtotalCents,
        deliveryFeeCents,
        serviceFeeCents,
        totalCents,
        isOpen,
        setIsOpen,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
}
