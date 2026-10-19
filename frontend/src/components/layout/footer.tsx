import React from 'react';
import Link from 'next/link';
import { UtensilsCrossed, ShieldCheck, Zap, Heart } from 'lucide-react';

export function Footer() {
  return (
    <footer className="mt-20 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 py-12 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Col 1 */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-brand-500 flex items-center justify-center text-white">
                <UtensilsCrossed className="w-4 h-4" />
              </div>
              <span className="font-black text-slate-900 dark:text-white tracking-tight">
                Craving<span className="text-brand-500">Fast</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              现代化即时外卖派单平台。采用并发硬化状态机、基于 Redis 分布式订阅、毫秒级抢单架构。
            </p>
            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
              <ShieldCheck className="w-4 h-4" />
              <span>TypeORM 事务隔离 & 原子抢单保护</span>
            </div>
          </div>

          {/* Col 2 */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-1">
              快捷点餐
            </h4>
            <Link href="/" className="text-xs text-slate-500 hover:text-brand-500 transition-colors">
              全部餐厅
            </Link>
            <Link href="/orders" className="text-xs text-slate-500 hover:text-brand-500 transition-colors">
              我的历史订单
            </Link>
            <Link href="/profile" className="text-xs text-slate-500 hover:text-brand-500 transition-colors">
              账户与设置
            </Link>
          </div>

          {/* Col 3 */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-1">
              商家与配送工作台
            </h4>
            <Link href="/owner" className="text-xs text-slate-500 hover:text-brand-500 transition-colors">
              餐厅店长后台
            </Link>
            <Link href="/owner/restaurants" className="text-xs text-slate-500 hover:text-brand-500 transition-colors">
              菜单与菜品配置
            </Link>
            <Link href="/owner/orders" className="text-xs text-slate-500 hover:text-brand-500 transition-colors">
              后厨实时出单大屏
            </Link>
            <Link href="/driver" className="text-xs text-slate-500 hover:text-brand-500 transition-colors">
              骑手抢单与配送大厅
            </Link>
          </div>

          {/* Col 4 */}
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-1">
              技术架构
            </h4>
            <p className="text-xs text-slate-500">
              前端：Next.js 14, React 18, TypeScript, Tailwind CSS, Apollo Client, graphql-ws
            </p>
            <p className="text-xs text-slate-500">
              后端：NestJS 11, GraphQL, PostgreSQL 16, Redis 7, Transactional Outbox
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-200/60 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <p>© {new Date().getFullYear()} CravingFast Dispatch API Frontend. All rights reserved.</p>
          <div className="flex items-center gap-1">
            <span>Crafted with</span>
            <Heart className="w-3.5 h-3.5 text-red-500 fill-current" />
            <span>for high-concurrency food delivery</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
