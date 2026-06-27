'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useBranding } from '@/lib/useBranding';

export default function RootPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const brand = useBranding();

  useEffect(() => {
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
  }, [user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="text-center">
        {brand.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={brand.logoUrl} alt={brand.appName} className="w-16 h-16 object-contain mx-auto mb-4" />
          : <div className="text-5xl mb-4">🌾</div>}
        <h1 className="text-2xl font-bold text-green-800">{brand.appName}</h1>
        <p className="text-green-600 mt-1">{brand.tagline}</p>
        <div className="mt-4 flex gap-3 justify-center">
          <a href="/worker/login" className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold text-sm">Worker Login</a>
          <a href="/owner/login" className="px-4 py-2 bg-gray-800 text-white rounded-lg font-semibold text-sm">Owner Login</a>
        </div>
      </div>
    </div>
  );
}
