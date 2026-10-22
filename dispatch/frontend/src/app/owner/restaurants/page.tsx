'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { SafeImage } from '@/components/ui/safe-image';
import { DEFAULT_RESTAURANT_COVER } from '@/lib/image-helper';
import { useQuery, useMutation } from '@apollo/client';
import {
  Store,
  Plus,
  ArrowLeft,
  Utensils,
  MapPin,
  Sparkles,
  ExternalLink,
  ChefHat,
  Layers,
} from 'lucide-react';
import { MY_RESTAURANTS_QUERY } from '@/lib/graphql/queries';
import { CREATE_RESTAURANT_MUTATION } from '@/lib/graphql/mutations';
import { Restaurant } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { useToast } from '@/lib/toast-context';

export default function MyRestaurantsPage() {
  const { data, loading, refetch } = useQuery(MY_RESTAURANTS_QUERY, {
    errorPolicy: 'all',
  });
  const [createRestaurant, { loading: creating }] = useMutation(CREATE_RESTAURANT_MUTATION);
  const { success, error } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [coverImage, setCoverImage] = useState(
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80'
  );
  const [address, setAddress] = useState('');
  const [categoryName, setCategoryName] = useState('披萨');

  const restaurants: Restaurant[] = data?.myRestaurants?.restaurants || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createRestaurant({
        variables: {
          input: {
            name,
            coverImage,
            address,
            categoryName,
          },
        },
      });

      if (res.data?.createRestaurant?.ok) {
        success('餐厅创建成功', `${name} 已成功入驻平台！`);
        setIsModalOpen(false);
        setName('');
        setAddress('');
        refetch();
      } else {
        error('创建未成功', res.data?.createRestaurant?.error || '请稍后重试');
      }
    } catch (err: any) {
      error('提交失败', err.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6 relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Link
            href="/owner"
            className="p-2.5 rounded-2xl glass-card hover:bg-white transition-all text-slate-600 shadow-sm border border-white/80"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              名下餐厅与菜单管理
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              配置店铺展示信息、上架菜品菜单与多规格自选加料
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
          <span>创建新入驻餐厅</span>
        </Button>
      </div>

      {/* Restaurant List */}
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3">
          <Spinner className="w-8 h-8 text-amber-500" />
          <p className="text-xs text-slate-400">正在同步您的餐厅数据...</p>
        </div>
      ) : restaurants.length === 0 ? (
        <div className="py-20 glass-panel rounded-[32px] text-center p-8 flex flex-col items-center justify-center border border-white/80">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-4 border border-amber-500/20">
            <Store className="w-8 h-8" />
          </div>
          <h3 className="font-black text-slate-900 text-lg">
            您还没有创建任何餐厅
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1 mb-6 leading-relaxed">
            立即创建您的第一家线上门店，开始配置美食菜单并接入自动化智能接单！
          </p>
          <Button
            variant="primary"
            size="md"
            onClick={() => setIsModalOpen(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>立即创建餐厅</span>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {restaurants.map((restaurant) => (
            <div
              key={restaurant.id}
              className="glass-card glass-card-hover rounded-[28px] overflow-hidden flex flex-col justify-between group"
            >
              <div>
                <div className="relative w-full h-48 bg-slate-100 overflow-hidden">
                  <SafeImage
                    src={restaurant.coverImage}
                    fallback={DEFAULT_RESTAURANT_COVER}
                    alt={restaurant.name}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />

                  {restaurant.isPromoted && (
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-yellow-500 text-white px-3 py-1 rounded-full text-xs font-black shadow-lg shadow-amber-500/30 border border-white/25 backdrop-blur-md">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>首页置顶曝光中</span>
                    </div>
                  )}

                  {restaurant.category && (
                    <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full glass-pill text-xs font-bold text-slate-800 shadow-sm">
                      {restaurant.category.name}
                    </div>
                  )}
                </div>

                <div className="p-6 flex flex-col gap-2.5">
                  <h3 className="font-black text-slate-900 text-lg group-hover:text-brand-600 transition-colors">
                    {restaurant.name}
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{restaurant.address}</span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                    <Layers className="w-3.5 h-3.5" />
                    <span>在架菜品：<strong className="text-slate-700 font-bold">{restaurant.menu?.length || 0}</strong> 道</span>
                  </div>
                </div>
              </div>

              <div className="p-6 pt-0 flex items-center gap-2.5">
                <Link
                  href={`/owner/restaurants/${restaurant.id}/menu`}
                  className="flex-1"
                >
                  <Button variant="primary" size="sm" className="w-full gap-2 shadow-md shadow-brand-500/15">
                    <Utensils className="w-3.5 h-3.5" />
                    <span>管理菜品与规格</span>
                  </Button>
                </Link>

                <Link href={`/restaurant/${restaurant.id}`} target="_blank">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="p-2.5 glass-panel text-slate-700 hover:bg-white"
                    title="在顾客端预览门店"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Restaurant Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="新建外卖入驻餐厅"
        maxWidth="md"
      >
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <Input
            label="餐厅名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="例如：罗马工坊手工披萨"
          />

          <Input
            label="门市详细地址"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            placeholder="例如：朝阳区美食街88号 B座1楼"
          />

          <Input
            label="所属菜系分类"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            required
            placeholder="例如：披萨、汉堡、日料、川湘"
          />

          <Input
            label="门头主图图片 URL"
            value={coverImage}
            onChange={(e) => setCoverImage(e.target.value)}
            required
            placeholder="https://images.unsplash.com/..."
          />

          <div className="pt-3 flex justify-end gap-2.5">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setIsModalOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={creating}
            >
              确认入驻创建
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
