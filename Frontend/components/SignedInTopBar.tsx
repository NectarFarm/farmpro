'use client';
// Minimal signed-in chrome for single-page persona dashboards (manager/vet/auditor):
// back + identity + logout, so no authenticated screen is ever a dead end.
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/auth';
import { useBranding } from '@/lib/useBranding';
import { ChevronLeft, Wheat } from 'lucide-react';

export function SignedInTopBar({ loginPath = '/owner/login' }: { loginPath?: string }) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const brand = useBranding();
  const handleLogout = () => { logout(); router.replace(loginPath); };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
      <button onClick={() => router.back()} aria-label="Back"
        className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100"><ChevronLeft className="w-5 h-5" /></button>
      {brand.logoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={brand.logoUrl} alt={brand.appName} className="w-7 h-7 object-contain" />
        : <Wheat className="w-6 h-6 text-green-700" />}
      <span className="font-bold text-green-800">{brand.appName}</span>
      <div className="flex-1" />
      {user && <span className="hidden sm:inline text-xs text-gray-400 capitalize">{user.name} · {user.role}</span>}
      <button onClick={handleLogout}
        className="text-sm font-semibold text-gray-600 hover:text-red-600 border border-gray-200 rounded-lg px-3 py-1.5">Logout</button>
    </header>
  );
}
