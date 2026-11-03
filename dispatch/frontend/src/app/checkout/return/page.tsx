'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { returnPath, takeCheckoutOrder } from '@/lib/payment';
import { Spinner } from '@/components/ui/spinner';

function CheckoutReturn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returned = useRef(false);

  useEffect(() => {
    if (returned.current) return;
    returned.current = true;
    const id = takeCheckoutOrder(window.localStorage);
    router.replace(returnPath(searchParams.get('result'), id));
  }, []);

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
      <Spinner className="w-8 h-8 text-brand-500" />
      <p className="text-sm text-slate-500">Returning to your order…</p>
    </div>
  );
}

export default function CheckoutReturnPage() {
  return <Suspense fallback={null}><CheckoutReturn /></Suspense>;
}
