import React, { ButtonHTMLAttributes, forwardRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'emerald';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

    const variants = {
      primary:
        'bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white shadow-md shadow-brand-500/25 focus:ring-brand-500 rounded-2xl',
      secondary:
        'bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 rounded-2xl',
      outline:
        'border border-slate-200 hover:border-brand-500 hover:text-brand-600 text-slate-700 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 rounded-2xl',
      ghost:
        'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 rounded-2xl',
      danger:
        'bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/20 focus:ring-red-500 rounded-2xl',
      emerald:
        'bg-emerald-500 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/25 focus:ring-emerald-500 rounded-2xl',
    };

    const sizes = {
      sm: 'text-xs px-3 py-1.5 gap-1.5',
      md: 'text-sm px-4 py-2.5 gap-2',
      lg: 'text-base px-6 py-3.5 gap-2.5 font-semibold',
      icon: 'p-2.5 rounded-full',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={twMerge(
          clsx(baseStyles, variants[variant], sizes[size], className)
        )}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0 mr-1.5" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
