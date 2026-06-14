'use client';

import { useEffect } from 'react';
import { useFarmStore } from '@/lib/store';
import AppShell from '@/components/AppShell';
import LoginPage from '@/components/LoginPage';
import CustomerPortalPage from '@/components/pages/CustomerPortalPage';
import EmployeeShell from '@/components/EmployeeShell';

export default function Home() {
  const { session, initialized, initialize, loading } = useFarmStore();

  useEffect(() => {
    if (!initialized && !loading) {
      // Check for an active server session and load all data
      fetch('/api/auth/session')
        .then((r) => r.json())
        .then(async (serverSession) => {
          if (serverSession) {
            const s = serverSession as {
              userType: string;
              userId?: string;
              userName?: string;
            };
            useFarmStore.setState({
              session: {
                type: s.userType as 'owner' | 'employee' | 'customer',
                employeeId: s.userType === 'employee' ? s.userId : undefined,
                employeeName: s.userType === 'employee' ? s.userName : undefined,
                customerId: s.userType === 'customer' ? s.userId : undefined,
                customerName: s.userType === 'customer' ? s.userName : undefined,
                loginAt: new Date().toISOString(),
              },
            });
            await initialize();
          } else {
            useFarmStore.setState({ initialized: true });
          }
        })
        .catch(() => useFarmStore.setState({ initialized: true }));
    }
  }, [initialized, loading, initialize]);

  if (!initialized) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!session) return <LoginPage />;
  if (session.type === 'customer') return <CustomerPortalPage />;
  if (session.type === 'employee') return <EmployeeShell />;
  return <AppShell />;
}
