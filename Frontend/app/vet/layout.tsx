import { SignedInTopBar } from '@/components/SignedInTopBar';

export default function VetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <SignedInTopBar />
      <main>{children}</main>
    </div>
  );
}
