'use client';

import React, { useMemo } from 'react';
import { ApolloProvider } from '@apollo/client';
import { getApolloClient } from '@/lib/apollo-client';
import { ToastProvider } from '@/lib/toast-context';
import { AuthProvider } from '@/lib/auth-context';
import { CartProvider } from '@/lib/cart-context';
import { CartDrawer } from '@/components/cart/cart-drawer';

export function Providers({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => getApolloClient(), []);

  return (
    <ApolloProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <CartProvider>
            {children}
            <CartDrawer />
          </CartProvider>
        </AuthProvider>
      </ToastProvider>
    </ApolloProvider>
  );
}
