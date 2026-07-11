'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useBranding } from '@/lib/useBranding';
import { Wheat } from 'lucide-react';

export default function RootPage() {
  const router = useRouter();
  const { user, hasHydrated } = useAuthStore();
  const brand = useBranding();

  useEffect(() => {
    // The persisted session hasn't been read from localStorage yet — `user` is
    // null on this very first pass even for an already-signed-in visitor.
    // Deciding anything before hydration finishes would wrongly treat them as
    // logged out and bounce them to the login screen on every refresh.
    if (!hasHydrated) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role === 'super_admin') {
      router.replace('/admin/dashboard');
    } else if (user.role === 'worker') {
      router.replace('/worker/home');
    } else if (user.role === 'owner' || user.role === 'manager') {
      router.replace('/owner/dashboard');
    } else if (user.role === 'vet') {
      router.replace('/vet/units');
    } else if (user.role === 'auditor') {
      router.replace('/auditor/dashboard');
    } else {
      router.replace('/login');
    }
  }, [hasHydrated, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="text-center">
        {brand.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={brand.logoUrl} alt={brand.appName} className="w-16 h-16 object-contain mx-auto mb-4" />
          : <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4"><Wheat className="w-8 h-8 text-green-700" /></div>}
        <h1 className="text-2xl font-bold text-green-800">{brand.appName}</h1>
        <p className="text-green-600 mt-1">{brand.tagline}</p>
        {/* This page never stays put — the effect above always replaces it with
            either the signed-in destination or /login (the actual, unified sign-in
            form), so there is nothing to click here. A "Worker/Owner Login" chooser
            used to render in this spot, duplicating what /login already does on
            its own; it added an extra screen with no purpose and was also where
            the pre-hydration flash was most visible. */}
      </div>
    </div>
  );
}
