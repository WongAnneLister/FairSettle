'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@apollo/client';
import {
  User as UserIcon,
  ShieldCheck,
  Mail,
  Lock,
  CheckCircle2,
  AlertCircle,
  Save,
  KeyRound,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast-context';
import { EDIT_PROFILE_MUTATION } from '@/lib/graphql/mutations';
import { UserRole } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { success, error } = useToast();

  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');

  const [editProfile, { loading }] = useMutation(EDIT_PROFILE_MUTATION);

  if (!user) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-3xl glass-card text-brand-500 flex items-center justify-center mb-4">
          <UserIcon className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2">
          Sign in to your account
        </h2>
        <p className="text-xs text-slate-500 mb-6">Manage your profile and account security after signing in</p>
        <Link href="/login">
          <Button variant="primary" size="md" className="shadow-lg shadow-brand-500/20">
            Sign in
          </Button>
        </Link>
      </div>
    );
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const input: any = {};
      if (email && email !== user.email) input.email = email;
      if (password) input.password = password;

      if (Object.keys(input).length === 0) {
        error('No changes to save');
        return;
      }

      const res = await editProfile({
        variables: { input },
      });

      if (res.data?.editProfile?.ok) {
        success('Profile updated');
        setPassword('');
        await refreshUser();
      } else {
        error('Update failed', res.data?.editProfile?.error || 'Please try again later');
      }
    } catch (err: any) {
      error('Save failed', err.message);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col gap-6 relative">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          Account and security
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Manage your email, role and password
        </p>
      </div>

      {/* Profile Overview Card */}
      <div className="glass-card rounded-[28px] p-6 flex items-center justify-between gap-4 border border-white/90 shadow-glass">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-500 via-orange-500 to-amber-500 text-white font-black text-lg flex items-center justify-center shadow-lg shadow-brand-500/25 border border-white/30">
            {user.email.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="font-black text-slate-900 text-base">
                {user.email}
              </h3>
              <Badge
                variant={
                  user.role === UserRole.Owner
                    ? 'amber'
                    : user.role === UserRole.Delivery
                    ? 'emerald'
                    : 'brand'
                }
                size="sm"
              >
                {user.role === UserRole.Owner
                  ? 'Restaurant owner'
                  : user.role === UserRole.Delivery
                  ? 'Driver'
                  : 'Customer'}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-1 font-mono">User ID: #{user.id}</p>
          </div>
        </div>

        <div>
          {user.emailVerified ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-bold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl backdrop-blur-md">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Email verified</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 font-bold bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl backdrop-blur-md">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <span>Not verified</span>
            </span>
          )}
        </div>
      </div>

      {/* Edit Profile Form */}
      <form
        onSubmit={handleUpdate}
        className="glass-card rounded-[28px] p-7 flex flex-col gap-5 border border-white/90 shadow-glass"
      >
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <KeyRound className="w-4 h-4 text-brand-500" />
          <h3 className="font-black text-slate-900 text-base">
            Update email and password
          </h3>
        </div>

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="New email address"
          icon={<Mail className="w-4 h-4 text-slate-400" />}
        />

        <Input
          label="New password (leave blank to keep current password)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          icon={<Lock className="w-4 h-4 text-slate-400" />}
        />

        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            className="gap-2 shadow-lg shadow-brand-500/20 font-bold"
          >
            <Save className="w-4 h-4" />
            <span>Save changes</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
