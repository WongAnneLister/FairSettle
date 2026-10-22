'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  UtensilsCrossed,
  Mail,
  Lock,
  ArrowRight,
  User,
  ChefHat,
  Bike,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function RegisterPage() {
  const router = useRouter();
  const { register, loading } = useAuth();

  const [role, setRole] = useState<UserRole>(UserRole.Client);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await register(email, password, role);
    if (success) {
      if (role === UserRole.Owner) {
        router.push('/owner');
      } else if (role === UserRole.Delivery) {
        router.push('/driver');
      } else {
        router.push('/');
      }
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-md glass-panel rounded-3xl p-6 sm:p-8 border border-white/90 shadow-[0_20px_50px_0_rgba(15,23,42,0.08)] flex flex-col gap-6">
        {/* Header */}
        <div className="text-center flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 via-brand-500 to-amber-400 flex items-center justify-center text-white shadow-md shadow-brand-500/25">
            <UtensilsCrossed className="w-6 h-6 drop-shadow" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            创建您的账户
          </h1>
          <p className="text-xs text-slate-400">
            加入 CravingFast 高速派单调度平台
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Role selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-700">
              请选择您的身份角色
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRole(UserRole.Client)}
                className={`flex flex-col items-center justify-center p-3 rounded-2xl text-xs font-bold transition-all duration-200 ${
                  role === UserRole.Client
                    ? 'glass-pill-active shadow-md'
                    : 'glass-pill text-slate-600 hover:text-slate-900'
                }`}
              >
                <User className="w-4 h-4 mb-1" />
                <span>美食顾客</span>
              </button>

              <button
                type="button"
                onClick={() => setRole(UserRole.Owner)}
                className={`flex flex-col items-center justify-center p-3 rounded-2xl text-xs font-bold transition-all duration-200 ${
                  role === UserRole.Owner
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-md'
                    : 'glass-pill text-slate-600 hover:text-slate-900'
                }`}
              >
                <ChefHat className="w-4 h-4 mb-1" />
                <span>餐厅店长</span>
              </button>

              <button
                type="button"
                onClick={() => setRole(UserRole.Delivery)}
                className={`flex flex-col items-center justify-center p-3 rounded-2xl text-xs font-bold transition-all duration-200 ${
                  role === UserRole.Delivery
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md'
                    : 'glass-pill text-slate-600 hover:text-slate-900'
                }`}
              >
                <Bike className="w-4 h-4 mb-1" />
                <span>配送骑手</span>
              </button>
            </div>
          </div>

          <Input
            label="注册邮箱"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="name@example.com"
            icon={<Mail className="w-4 h-4" />}
          />

          <Input
            label="设置密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="至少 6 位字符"
            icon={<Lock className="w-4 h-4" />}
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            className="w-full mt-2 text-xs font-bold gap-2"
          >
            <span>注册并自动登录</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <div className="text-center text-xs text-slate-500">
          已有账户？{' '}
          <Link
            href="/login"
            className="font-bold text-brand-600 hover:text-brand-700 underline underline-offset-4"
          >
            直接登录
          </Link>
        </div>
      </div>
    </div>
  );
}
