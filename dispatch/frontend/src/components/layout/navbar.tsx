'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  UtensilsCrossed,
  ShoppingBag,
  User as UserIcon,
  ChefHat,
  Bike,
  LogOut,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { UserRole } from '@/lib/types';
import { Badge } from '../ui/badge';

export function Navbar() {
  const { user, logout } = useAuth();
  const { itemCount, setIsOpen } = useCart();
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="sticky top-3 z-40 w-full px-4 sm:px-6 max-w-7xl mx-auto transition-all">
      <div className="glass-panel rounded-3xl h-16 px-4 sm:px-6 flex items-center justify-between gap-4 border border-white/80 shadow-[0_12px_40px_0_rgba(15,23,42,0.05),inset_0_1px_1.5px_0_rgba(255,255,255,0.95)]">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-600 via-brand-500 to-amber-400 flex items-center justify-center text-white shadow-md shadow-brand-500/25 group-hover:scale-105 group-hover:rotate-1 transition-all duration-300">
            <UtensilsCrossed className="w-5 h-5 drop-shadow" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-1">
              Craving<span className="text-brand-500">Fast</span>
            </span>
            <span className="hidden sm:block text-[9px] text-slate-400 tracking-wider uppercase font-bold -mt-1">
              On-Demand Dispatch
            </span>
          </div>
        </Link>

        {/* Center Nav Links in a Frosted Pill Dock */}
        <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-full bg-slate-100/60 backdrop-blur-md border border-white/60 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] text-xs font-bold">
          <Link
            href="/"
            className={`px-4 py-1.5 rounded-full transition-all duration-200 ${
              pathname === '/'
                ? 'bg-white text-brand-600 shadow-sm shadow-slate-200/50'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
            }`}
          >
            Explore restaurants
          </Link>
          <Link
            href="/orders"
            className={`px-4 py-1.5 rounded-full transition-all duration-200 ${
              pathname.startsWith('/orders')
                ? 'bg-white text-brand-600 shadow-sm shadow-slate-200/50'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
            }`}
          >
            My orders
          </Link>

          {/* Role specific portals */}
          {user?.role === UserRole.Owner && (
            <Link
              href="/owner"
              className={`px-4 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5 ${
                pathname.startsWith('/owner')
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-sm'
                  : 'text-amber-700 hover:bg-amber-100/60'
              }`}
            >
              <ChefHat className="w-3.5 h-3.5" />
              <span>Kitchen</span>
            </Link>
          )}

          {user?.role === UserRole.Delivery && (
            <Link
              href="/driver"
              className={`px-4 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5 ${
                pathname.startsWith('/driver')
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-sm'
                  : 'text-emerald-700 hover:bg-emerald-100/60'
              }`}
            >
              <Bike className="w-3.5 h-3.5" />
              <span>Driver dashboard</span>
            </Link>
          )}
        </nav>

        {/* Right side: Cart & User profile */}
        <div className="flex items-center gap-3">
          {/* Cart Button with Frosted Glow */}
          <button
            onClick={() => setIsOpen(true)}
            className="relative flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-gradient-to-br from-brand-50/80 to-amber-50/60 hover:from-brand-100/90 hover:to-amber-100/80 text-brand-700 border border-brand-200/50 shadow-sm shadow-brand-500/10 backdrop-blur-md transition-all active:scale-95 group"
            aria-label="Cart"
          >
            <ShoppingBag className="w-4 h-4 text-brand-500 group-hover:scale-110 transition-transform" />
            <span className="hidden sm:inline text-xs font-bold">Cart</span>
            {itemCount > 0 ? (
              <span className="w-5 h-5 rounded-full bg-gradient-to-r from-brand-500 to-amber-500 text-white text-[11px] font-black flex items-center justify-center shadow-sm">
                {itemCount}
              </span>
            ) : null}
          </button>

          {/* User Auth or Menu */}
          {user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2.5 p-1 pl-3 rounded-2xl bg-white/60 hover:bg-white/90 border border-white/80 shadow-sm backdrop-blur-md transition-all duration-200"
              >
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-xs font-bold text-slate-800 max-w-[110px] truncate leading-tight">
                    {user.email.split('@')[0]}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">
                    {user.role === UserRole.Owner
                      ? 'Restaurant owner'
                      : user.role === UserRole.Delivery
                      ? 'Driver'
                      : 'Customer'}
                  </span>
                </div>
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-200 via-slate-100 to-white flex items-center justify-center text-slate-700 font-bold text-xs border border-white/80 shadow-xs">
                  {user.email.substring(0, 2).toUpperCase()}
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 mr-1" />
              </button>

              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-3 w-60 glass-panel rounded-3xl p-2 z-20 shadow-2xl animate-in fade-in zoom-in-95 duration-150 border border-white/90">
                    <div className="px-4 py-2.5 border-b border-slate-100/80">
                      <p className="text-[11px] text-slate-400 font-medium">Signed in as</p>
                      <p className="text-xs font-bold text-slate-900 truncate mt-0.5">
                        {user.email}
                      </p>
                    </div>

                    <div className="py-1">
                      {user.role === UserRole.Owner && (
                        <Link
                          href="/owner"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                        >
                          <ChefHat className="w-4 h-4 text-amber-500" />
                          <span>Owner dashboard</span>
                        </Link>
                      )}

                      {user.role === UserRole.Delivery && (
                        <Link
                          href="/driver"
                          onClick={() => setUserMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                        >
                          <Bike className="w-4 h-4 text-emerald-500" />
                          <span>Driver dashboard</span>
                        </Link>
                      )}

                      <Link
                        href="/orders"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-600 transition-colors"
                      >
                        <ShoppingBag className="w-4 h-4 text-brand-500" />
                        <span>Order history</span>
                      </Link>

                      <Link
                        href="/profile"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100/70 transition-colors"
                      >
                        <UserIcon className="w-4 h-4 text-slate-400" />
                        <span>Account settings</span>
                      </Link>
                    </div>

                    <div className="my-1 border-t border-slate-100/80" />

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="text-xs font-bold text-slate-700 hover:text-brand-600 px-3 py-2 rounded-xl transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="text-xs font-bold text-white bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 px-4 py-2 rounded-2xl shadow-md shadow-brand-500/20 transition-all active:scale-95"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
