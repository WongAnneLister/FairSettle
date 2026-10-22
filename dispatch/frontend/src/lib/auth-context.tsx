'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, UserRole } from './types';
import { getApolloClient } from './apollo-client';
import { ME_QUERY } from './graphql/queries';
import { LOGIN_MUTATION, CREATE_ACCOUNT_MUTATION } from './graphql/mutations';
import { useToast } from './toast-context';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, role: UserRole) => Promise<boolean>;
  logout: () => void;
  quickDemoLogin: (role: UserRole) => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { success, error } = useToast();

  const apollo = getApolloClient();

  const refreshUser = useCallback(async () => {
    const currentToken = localStorage.getItem('token');
    if (!currentToken) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const res = await apollo.query({
        query: ME_QUERY,
        fetchPolicy: 'network-only',
      });
      if (res.data?.me) {
        setUser(res.data.me);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.warn('Failed to fetch current user profile:', err);
    } finally {
      setLoading(false);
    }
  }, [apollo]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedToken = localStorage.getItem('token');
      if (savedToken) {
        setToken(savedToken);
        refreshUser();
      } else {
        setLoading(false);
      }
    }
  }, [refreshUser]);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      setLoading(true);
      const res = await apollo.mutate({
        mutation: LOGIN_MUTATION,
        variables: { input: { email, password } },
      });

      const { ok, error: errMessage, token: receivedToken } = res.data.login;
      if (ok && receivedToken) {
        localStorage.setItem('token', receivedToken);
        setToken(receivedToken);
        await apollo.resetStore();
        await refreshUser();
        success('登录成功', `欢迎回来，${email}`);
        return true;
      } else {
        error('登录失败', errMessage || '账号或密码不正确');
        return false;
      }
    } catch (err: any) {
      error('网络或服务器错误', err.message || '请检查后端服务是否已启动');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const register = async (
    email: string,
    password: string,
    role: UserRole
  ): Promise<boolean> => {
    try {
      setLoading(true);
      const res = await apollo.mutate({
        mutation: CREATE_ACCOUNT_MUTATION,
        variables: { input: { email, password, role } },
      });

      const { ok, error: errMessage } = res.data.createAccount;
      if (ok) {
        success('注册成功', '已为您自动登录');
        // Auto login after registration
        return await login(email, password);
      } else {
        error('注册失败', errMessage || '邮箱可能已被注册');
        return false;
      }
    } catch (err: any) {
      error('注册失败', err.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    apollo.clearStore();
    success('已退出登录');
  };

  // Quick 1-click test helper that seamlessly registers if missing, then logs in
  const quickDemoLogin = async (role: UserRole): Promise<boolean> => {
    const demoCredentials: Record<UserRole, { email: string; pass: string }> = {
      [UserRole.Client]: { email: 'client@demo.com', pass: 'demo123456' },
      [UserRole.Owner]: { email: 'owner@demo.com', pass: 'demo123456' },
      [UserRole.Delivery]: { email: 'driver@demo.com', pass: 'demo123456' },
    };

    const target = demoCredentials[role];
    const loggedIn = await login(target.email, target.pass);
    if (loggedIn) return true;

    // If account does not exist, auto create it
    const created = await register(target.email, target.pass, role);
    return created;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        logout,
        quickDemoLogin,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
