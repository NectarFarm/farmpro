'use client';

import { useState } from 'react';
import { useFarmStore } from '@/lib/store';
import Sidebar from '@/components/Sidebar';
import AlertsPanel from '@/components/AlertsPanel';
import DashboardPage from '@/components/pages/DashboardPage';
import FlocksPage from '@/components/pages/FlocksPage';
import FinancePage from '@/components/pages/FinancePage';
import SalesPage from '@/components/pages/SalesPage';
import CustomersPage from '@/components/pages/CustomersPage';
import AnalyticsPage from '@/components/pages/AnalyticsPage';
import InventoryPage from '@/components/pages/InventoryPage';
import SettingsPage from '@/components/pages/SettingsPage';
import OrderManagementPage from '@/components/pages/OrderManagementPage';
import { Bell, LogOut, Menu, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import ReportModal from '@/components/ReportModal';

export type PageId = 'dashboard' | 'flocks' | 'finance' | 'sales' | 'customers' | 'analytics' | 'inventory' | 'employee' | 'settings' | 'orders';

export default function AppShell() {
  const { session, setSession, alerts } = useFarmStore();
  const [currentPage, setCurrentPage] = useState<PageId>(
    session?.type === 'employee' ? 'employee' : 'dashboard'
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);

  const unreadAlerts = alerts.filter(a => !a.read).length;

  function handleLogout() {
    setSession(null);
    toast.info('Logged out successfully');
  }

  function navigateTo(page: PageId) {
    setCurrentPage(page);
    setSidebarOpen(false);
  }

  function renderPage() {
    // Owner-only shell — customer and employee are routed before reaching here
    switch (currentPage) {
      case 'dashboard': return <DashboardPage onNavigate={navigateTo} />;
      case 'flocks': return <FlocksPage />;
      case 'finance': return <FinancePage />;
      case 'sales': return <SalesPage />;
      case 'customers': return <CustomersPage />;
      case 'analytics': return <AnalyticsPage />;
      case 'inventory': return <InventoryPage />;
      case 'orders': return <OrderManagementPage />;
      case 'settings': return <SettingsPage />;
      default: return <DashboardPage onNavigate={navigateTo} />;
    }
  }

  const pageTitle: Record<PageId, string> = {
    dashboard: 'Dashboard', flocks: 'Flock Manager', finance: 'Finance & Budget',
    sales: 'Sales Records', customers: 'Customers', analytics: 'Analytics',
    inventory: 'Inventory', employee: 'Employee Entry', settings: 'Settings',
    orders: 'Order Management',
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed lg:static inset-y-0 left-0 z-50 transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar currentPage={currentPage} onNavigate={navigateTo} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-4 border-b border-border/60 bg-card/50 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-accent transition-colors">
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div>
              <h2 className="font-semibold text-sm text-foreground">{pageTitle[currentPage]}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session?.type === 'owner' && (
              <button onClick={() => setReportModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all hover:opacity-90 hidden sm:flex"
                style={{ background: 'oklch(0.42 0.14 148)', boxShadow: '0 2px 6px oklch(0.42 0.14 148 / 0.35)' }}>
                <FileText className="w-3.5 h-3.5" />
                PDF Report
              </button>
            )}
            {session?.type === 'owner' && (
              <button onClick={() => setAlertsPanelOpen(!alertsPanelOpen)}
                className="relative p-2 rounded-lg hover:bg-accent transition-colors">
                <Bell className="w-4 h-4 text-muted-foreground" />
                {unreadAlerts > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                    style={{ background: 'oklch(0.57 0.24 27)' }}>
                    {unreadAlerts > 9 ? '9+' : unreadAlerts}
                  </span>
                )}
              </button>
            )}
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-destructive/10 hover:text-destructive transition-colors text-muted-foreground">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {renderPage()}
        </main>
      </div>

      {/* Alerts panel slide-over */}
      {alertsPanelOpen && (
        <AlertsPanel onClose={() => setAlertsPanelOpen(false)} onNavigate={(page) => { navigateTo(page as PageId); setAlertsPanelOpen(false); }} />
      )}

      {/* PDF Report modal */}
      {reportModalOpen && <ReportModal onClose={() => setReportModalOpen(false)} />}
    </div>
  );
}
