'use client';
// ============================================================
// ui-shared.tsx — Shared UI Primitives
// Toast notifications, Confirm dialogs, Logout menu
// Used across all screens for consistent feedback patterns
// ============================================================

import React, { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';
import { X, Check, AlertTriangle, Info, LogOut, ChevronRight } from './icons';

/* ─────────────────────────────────────────────
   TOAST SYSTEM
   Usage:
     const { showToast } = useToast();
     showToast("Saved successfully", "success");
     showToast("Something went wrong", "error");
     showToast("Field required", "warning");
────────────────────────────────────────────── */
type ToastType = 'success' | 'error' | 'warning' | 'info';
interface Toast { id: number; message: string; type: ToastType }

interface ToastCtxType { showToast: (msg: string, type?: ToastType) => void }
const ToastCtx = createContext<ToastCtxType>({ showToast: () => {} });
export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++counterRef.current;
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

  const TOAST_COLORS: Record<ToastType, { bg: string; border: string; color: string; icon: React.ReactNode }> = {
    success: { bg: 'rgba(74,222,128,0.18)', border: 'rgba(74,222,128,0.5)', color: 'var(--status-ok)',       icon: <Check size={14} /> },
    error:   { bg: 'rgba(248,113,113,0.18)', border: 'rgba(248,113,113,0.5)', color: 'var(--status-critical)', icon: <X size={14} /> },
    warning: { bg: 'rgba(251,191,36,0.18)', border: 'rgba(251,191,36,0.5)',  color: 'var(--accent-amber)',   icon: <AlertTriangle size={14} /> },
    info:    { bg: 'rgba(96,165,250,0.18)', border: 'rgba(96,165,250,0.5)',  color: 'var(--accent-blue)',    icon: <Info size={14} /> },
  };

  return (
    <ToastCtx.Provider value={{ showToast }}>
      {children}
      {/* Toast overlay — sits above everything */}
      <div style={{ position: 'fixed', bottom: 90, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, zIndex: 9999, pointerEvents: 'none' }}>
        {toasts.map(t => {
          const c = TOAST_COLORS[t.type];
          return (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '11px 16px', borderRadius: 14, fontSize: 'var(--fs-base)', fontWeight: 700,
              background: c.bg, border: `1px solid ${c.border}`, color: c.color,
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)', maxWidth: 320,
              animation: 'slideUp 0.25s ease',
            }}>
              {c.icon}
              <span style={{ flex: 1, lineHeight: 1.3 }}>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/* ─────────────────────────────────────────────
   CONFIRM DIALOG
   Usage:
     const { confirm } = useConfirm();
     const ok = await confirm("Delete this task?", "danger");
────────────────────────────────────────────── */
interface ConfirmOptions { message: string; detail?: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string }
interface ConfirmCtxType { confirm: (opts: ConfirmOptions | string) => Promise<boolean> }
const ConfirmCtx = createContext<ConfirmCtxType>({ confirm: async () => false });
export function useConfirm() { return useContext(ConfirmCtx); }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions | string): Promise<boolean> => {
    const o: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise(resolve => setPending({ ...o, resolve }));
  }, []);

  function respond(v: boolean) {
    pending?.resolve(v);
    setPending(null);
  }

  const v = pending?.variant ?? 'warning';
  const colorMap = {
    danger:  { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.4)', btnBg: 'rgba(248,113,113,0.2)', btnColor: 'var(--status-critical)', btnBorder: 'rgba(248,113,113,0.5)' },
    warning: { bg: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.3)', btnBg: 'rgba(251,191,36,0.15)', btnColor: 'var(--accent-amber)',    btnBorder: 'rgba(251,191,36,0.4)' },
    info:    { bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.3)', btnBg: 'rgba(96,165,250,0.15)', btnColor: 'var(--accent-blue)',     btnBorder: 'rgba(96,165,250,0.4)' },
  };
  const c = colorMap[v];

  return (
    <ConfirmCtx.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9998, padding: 24 }}>
          <div style={{ background: c.bg, borderRadius: 20, padding: 22, width: '100%', maxWidth: 340, border: `1px solid ${c.border}` }}>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{pending.message}</div>
            {pending.detail && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>{pending.detail}</div>}
            {!pending.detail && <div style={{ marginBottom: 16 }} />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => respond(false)} style={{ flex: 1, padding: '10px', borderRadius: 12, background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 700, fontSize: 'var(--fs-base)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => respond(true)} style={{ flex: 1, padding: '10px', borderRadius: 12, background: c.btnBg, border: `1px solid ${c.btnBorder}`, color: c.btnColor, fontWeight: 700, fontSize: 'var(--fs-base)', cursor: 'pointer' }}>
                {pending.confirmLabel ?? (v === 'danger' ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ─────────────────────────────────────────────
   LOGOUT MENU — bottom sheet on any screen
   Usage:
     <LogoutMenu onLogout={fn} />
────────────────────────────────────────────── */
export function LogoutMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const { confirm } = useConfirm();

  async function handleLogout() {
    setOpen(false);
    const ok = await confirm({ message: 'Sign out?', detail: 'You will return to the login screen.', variant: 'warning', confirmLabel: 'Sign Out' });
    if (ok) onLogout();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        title="Sign out"
      >
        <LogOut size={14} color="var(--status-critical)" />
      </button>

      {open && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 500 }} onClick={() => setOpen(false)}>
          <div style={{ background: 'var(--surface)', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginBottom: 16, color: 'var(--text-primary)' }}>Account</div>
            <button onClick={handleLogout} style={{ width: '100%', padding: '13px 16px', borderRadius: 14, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--status-critical)', fontWeight: 700, fontSize: 'var(--fs-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <LogOut size={16} /> Sign Out
              <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
            <button onClick={() => setOpen(false)} style={{ width: '100%', marginTop: 10, padding: '11px', borderRadius: 12, background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-base)', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   SEARCH BAR — reusable inline search
────────────────────────────────────────────── */
import { Search } from './icons';
export function SearchBar({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
      <input
        className="farm-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ paddingLeft: 34, paddingRight: value ? 34 : 12 }}
      />
      {value && (
        <button onClick={() => onChange('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   SORT HEADER — table column sortable header
────────────────────────────────────────────── */
import { ChevronUp, ChevronDown } from './icons';
export type SortDir = 'asc' | 'desc' | null;
export function SortHeader({ label, field, sortField, sortDir, onSort }: {
  label: string; field: string;
  sortField: string | null; sortDir: SortDir;
  onSort: (f: string) => void;
}) {
  const active = sortField === field;
  return (
    <button onClick={() => onSort(field)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, color: active ? 'var(--primary-green)' : 'var(--text-muted)', fontWeight: active ? 700 : 600, fontSize: 'var(--fs-2xs)', padding: 0 }}>
      {label}
      {active && sortDir === 'asc' && <ChevronUp size={10} />}
      {active && sortDir === 'desc' && <ChevronDown size={10} />}
      {!active && <ChevronDown size={10} style={{ opacity: 0.4 }} />}
    </button>
  );
}

/* ─────────────────────────────────────────────
   GOVERNANCE GATE BANNER
   Shows when a CRUD action requires owner approval
────────────────────────────────────────────── */
import { ShieldCheck } from './icons';
export function GovernanceGateBanner({ action, onRequest, onCancel }: {
  action: string; onRequest: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
        <ShieldCheck size={18} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 3 }}>Owner Approval Required</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Your role requires owner approval for: <strong style={{ color: 'var(--text-secondary)' }}>{action}</strong>. A request will be sent to the owner.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: '9px', borderRadius: 10, background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontWeight: 700, fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>Cancel</button>
        <button onClick={onRequest} style={{ flex: 2, padding: '9px', borderRadius: 10, background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: 'var(--accent-amber)', fontWeight: 700, fontSize: 'var(--fs-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <ShieldCheck size={13} /> Send Approval Request
        </button>
      </div>
    </div>
  );
}
