import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';

export const metadata: Metadata = {
  title: 'CravingFast | Food delivery and dispatch',
  description: 'Order food, run the kitchen and dispatch drivers on one platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex flex-col min-h-screen bg-[#FAFAF9] text-slate-900 relative">
        {/* Subtle Ambient Background Light Orbs for Frosted Glass Refraction */}
        <div className="ambient-glow-warm w-[650px] h-[550px] -top-32 -left-32 animate-orb-slow" />
        <div className="ambient-glow-emerald w-[500px] h-[450px] top-[400px] -right-20 animate-float-slow" />
        <div className="ambient-glow-amber w-[600px] h-[500px] top-[1200px] left-1/4 animate-orb-slow" />

        <div className="relative z-10 flex flex-col min-h-screen">
          <Providers>
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </Providers>
        </div>
      </body>
    </html>
  );
}
