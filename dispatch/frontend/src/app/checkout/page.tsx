'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@apollo/client';
import {
  MapPin,
  Clock,
  ShieldCheck,
  ArrowLeft,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';
import { formatCents } from '@/lib/currency';
import { orderItemsFromCart } from '@/lib/order-items';
import { CREATE_ORDER_MUTATION } from '@/lib/graphql/mutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function CheckoutPage() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    restaurantId,
    restaurantName,
    items,
    subtotalCents,
    totalCents,
    clearCart,
  } = useCart();
  const { success, error } = useToast();

  const [address, setAddress] = useState('99 Innovation Avenue, Building B, Apt 1802');
  const [phone, setPhone] = useState('13800138000');
  const [notes, setNotes] = useState('');

  const [createOrder, { loading }] = useMutation(CREATE_ORDER_MUTATION);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!restaurantId || items.length === 0) {
      error('Your cart is empty', 'Add dishes to your cart first');
      return;
    }

    if (!user) {
      error('Please sign in', 'Sign in as a customer to place an order');
      router.push('/login?redirect=/checkout');
      return;
    }

    try {
      const formattedItems = orderItemsFromCart(items);

      const res = await createOrder({
        variables: {
          input: {
            restaurantId,
            items: formattedItems,
          },
        },
      });

      const { ok, error: errMessage, orderId } = res.data.createOrder;

      if (ok && orderId) {
        clearCart();
        success('Order placed', `Order #${orderId}. Opening PayPal for payment`);
        router.push(`/orders/${orderId}?pay=1`);
      } else {
        error('Order failed', errMessage || 'Please try again later');
      }
    } catch (err: any) {
      error('Could not place order', err.message || 'Network or server error');
    }
  };

  if (items.length === 0) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-3xl glass-pill flex items-center justify-center text-slate-300 mb-4 shadow-sm">
          <ShoppingBag className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">
          Your cart is empty
        </h2>
        <p className="text-xs text-slate-400 max-w-sm mb-6 leading-relaxed">
          Find a restaurant and add your favorite dishes to get started.
        </p>
        <Link href="/">
          <Button variant="primary" size="md">
            Explore restaurants
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={restaurantId ? `/restaurant/${restaurantId}` : '/'}
          className="p-2 rounded-2xl glass-pill text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Checkout
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Freshly prepared by {restaurantName}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Col: Delivery details & Item preview */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Delivery Address Card with Glassmorphism */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 border border-white/90 flex flex-col gap-4">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-base">
              <MapPin className="w-5 h-5 text-brand-500" />
              <span>Delivery address and contact details</span>
            </div>

            <Input
              label="Delivery address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              placeholder="For example: 1 Park Avenue, Apt 802"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                placeholder="Contact phone number"
              />
              <Input
                label="Order notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="For example: less spice, leave at the door"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 rounded-2xl backdrop-blur-md">
              <Clock className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>Estimated delivery: 25-35 minutes after payment</span>
            </div>
          </div>

          {/* Payment Method Card */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 border border-white/90 flex flex-col gap-4">
            <div className="flex items-center gap-2 font-bold text-slate-900 text-base">
              <Sparkles className="w-5 h-5 text-amber-500" />
              <span>Payment method</span>
            </div>

            <p className="text-sm text-slate-600">
              PayPal (sandbox). Place your order to continue to PayPal for payment
            </p>
          </div>

          {/* Ordered Dishes Preview */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 border border-white/90 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-base">
                Order items ({items.length})
              </span>
              <span className="text-xs text-slate-400">{restaurantName}</span>
            </div>

            <div className="divide-y divide-slate-200/50">
              {items.map((item) => (
                <div key={item.id} className="py-3 flex justify-between items-start gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {item.dish.name}
                      <span className="text-brand-500 text-xs ml-2 font-black">
                        × {item.quantity}
                      </span>
                    </p>
                    {item.options.length > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {item.options
                          .map((o) => `${o.name}: ${o.choice || 'Selected'}`)
                          .join(', ')}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-bold text-slate-900 shrink-0">
                    {formatCents(item.itemTotalCents)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Bill summary & Action with Frosted Glass Panel */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div className="sticky top-24 glass-panel rounded-3xl p-6 sm:p-7 border border-white/95 shadow-[0_20px_50px_0_rgba(15,23,42,0.08)] flex flex-col gap-5">
            <h3 className="font-bold text-slate-900 text-base">
              Order summary
            </h3>

            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-900">
                  {formatCents(subtotalCents)}
                </span>
              </div>
              <div className="pt-3 border-t border-slate-200/60 flex justify-between items-baseline text-slate-900">
                <span className="text-sm font-bold">Total due</span>
                <div className="text-right">
                  <span className="text-2xl font-black text-brand-600">
                    {formatCents(totalCents)}
                  </span>
                  <p className="text-[10px] text-slate-400">Final charge is confirmed by PayPal</p>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              className="w-full text-xs font-bold gap-2 shadow-lg shadow-brand-500/25"
            >
              <span>Place order and pay with PayPal</span>
            </Button>

            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Track your order from kitchen to doorstep</span>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
