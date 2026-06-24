import { SignedInTopBar } from '@/components/SignedInTopBar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      <SignedInTopBar />
      <div className="bg-gray-900 text-white px-6 py-2 text-sm font-semibold">🛡️ Platform Admin</div>
      <main>{children}</main>
    </div>
  );
}
