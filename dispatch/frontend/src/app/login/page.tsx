'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  UtensilsCrossed,
  Mail,
  Lock,
  ArrowRight,
  Sparkles,
  ChefHat,
  Bike,
  User,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect') || '/';

  const { login, quickDemoLogin, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [demoLoading, setDemoLoading] = useState<UserRole | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await login(email, password);
    if (success) {
      router.push(redirectUrl);
    }
  };

  const handleDemoLogin = async (role: UserRole) => {
    setDemoLoading(role);
    const success = await quickDemoLogin(role);
    setDemoLoading(null);
    if (success) {
      if (role === UserRole.Owner) {
        router.push('/owner');
      } else if (role === UserRole.Delivery) {
        router.push('/driver');
      } else {
        router.push(redirectUrl);
      }
    }
  };

  return (
    <div className="w-full max-w-md glass-panel rounded-3xl p-6 sm:p-8 border border-white/90 shadow-[0_20px_50px_0_rgba(15,23,42,0.08)] flex flex-col gap-6">
      {/* Header */}
      <div className="text-center flex flex-col items-center gap-2">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 via-brand-500 to-amber-400 flex items-center justify-center text-white shadow-md shadow-brand-500/25">
          <UtensilsCrossed className="w-6 h-6 drop-shadow" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          欢迎回到 CravingFast
        </h1>
        <p className="text-xs text-slate-400">
          即时外卖派单与智能调度管理中心
        </p>
      </div>

      {/* 1-Click Quick Demo Login Section with Frosted Glass styling */}
      <div className="p-4 rounded-2xl glass-card border border-white/90 flex flex-col gap-2.5">
        <div className="flex items-center gap-1.5 text-xs font-bold text-brand-900">
          <Sparkles className="w-3.5 h-3.5 text-brand-500" />
          <span>一键免密体验（自动注登新账号）</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled={loading || demoLoading !== null}
            onClick={() => handleDemoLogin(UserRole.Client)}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl glass-pill text-slate-800 hover:text-brand-600 hover:border-brand-300 transition-all text-xs font-bold shadow-xs active:scale-95"
          >
            <User className="w-4 h-4 text-brand-500 mb-1" />
            <span>顾客视角</span>
          </button>

          <button
            type="button"
            disabled={loading || demoLoading !== null}
            onClick={() => handleDemoLogin(UserRole.Owner)}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl glass-pill text-slate-800 hover:text-amber-600 hover:border-amber-300 transition-all text-xs font-bold shadow-xs active:scale-95"
          >
            <ChefHat className="w-4 h-4 text-amber-500 mb-1" />
            <span>店长视角</span>
          </button>

          <button
            type="button"
            disabled={loading || demoLoading !== null}
            onClick={() => handleDemoLogin(UserRole.Delivery)}
            className="flex flex-col items-center justify-center p-2.5 rounded-xl glass-pill text-slate-800 hover:text-emerald-600 hover:border-emerald-300 transition-all text-xs font-bold shadow-xs active:scale-95"
          >
            <Bike className="w-4 h-4 text-emerald-500 mb-1" />
            <span>骑手视角</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-200/60" />
        <span className="text-[11px] text-slate-400 font-medium">或使用常规账号密码登录</span>
        <div className="flex-1 h-px bg-slate-200/60" />
      </div>

      {/* Regular Login Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="登录邮箱"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="name@example.com"
          icon={<Mail className="w-4 h-4" />}
        />

        <Input
          label="登录密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="输入您的登录密码"
          icon={<Lock className="w-4 h-4" />}
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading && demoLoading === null}
          className="w-full mt-2 text-xs font-bold gap-2"
        >
          <span>登录系统</span>
          <ArrowRight className="w-4 h-4" />
        </Button>
      </form>

      <div className="text-center text-xs text-slate-500">
        还没有账户？{' '}
        <Link
          href="/register"
          className="font-bold text-brand-600 hover:text-brand-700 underline underline-offset-4"
        >
          免费注册新角色
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <Suspense
        fallback={
          <div className="flex justify-center p-12">
            <Spinner className="w-8 h-8 text-brand-500" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
