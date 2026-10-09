'use client';
// ── Platform-admin re-issue of a set-password link ──────────────────────────
// Used by the admin Users screen (per user) and the approved onboarding
// request. Calls POST /api/admin/users/[id]/set-password-link and shows the
// one-time link in a copy modal — there is no email sending here.
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Key } from './icons';
import { apiClient } from '@/lib/request';

export interface SignInWait {
  state: 'waiting' | 'expired';
  issuedAt: string;
  expiresAt: string;
}

function days(ms: number) {
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'}`;
  const h = Math.max(1, Math.floor(ms / 3_600_000));
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** "Not signed in yet · waiting 3 days · link expired" — null when not waiting. */
export function signInWaitText(w: SignInWait | null | undefined, now = Date.now()): string | null {
  if (!w) return null;
  const since = days(Math.max(0, now - new Date(w.issuedAt).getTime()));
  return `Not signed in yet · waiting ${since} · ${w.state === 'expired' ? 'link expired' : 'link still valid'}`;
}

export function SignInWaitBadge({ wait }: { wait: SignInWait | null | undefined }) {
  const text = signInWaitText(wait);
  if (!text || !wait) return null;
  const expired = wait.state === 'expired';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-2xs)', fontWeight: 700,
        padding: '3px 9px', borderRadius: 100,
        background: expired ? 'rgba(var(--critical-rgb),0.1)' : 'rgba(var(--info-rgb),0.1)',
        color: expired ? 'var(--status-critical)' : 'var(--accent-blue)',
        border: `1px solid ${expired ? 'rgba(var(--critical-rgb),0.3)' : 'rgba(var(--info-rgb),0.3)'}`,
      }}
    >
      <Clock size={10} /> {text}
    </span>
  );
}

export function AdminSetPasswordLinkModal({ email, url, expiresAt, onClose }: { email: string; url: string; expiresAt?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20 }} onClick={onClose}>
      <div className="farm-card" style={{ width: '100%', maxWidth: 420, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <CheckCircle2 size={18} color="var(--status-ok)" />
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>New set-password link</div>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Send this one-time link to <strong>{email}</strong> through a channel you trust. They use it to choose their own password. Any earlier link no longer works.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
          <code style={{ fontFamily: 'monospace', fontSize: 'var(--fs-xs)', flex: 1, wordBreak: 'break-all', color: 'var(--text-primary)' }}>{url}</code>
          <button
            onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(url); setCopied(true); }}
            style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'rgba(var(--primary-rgb),0.1)', border: '1px solid rgba(var(--primary-rgb),0.3)', color: 'var(--primary-green)', cursor: 'pointer', flexShrink: 0 }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 'var(--fs-2xs)', color: 'var(--status-warning)', marginBottom: 16, lineHeight: 1.4 }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This link cannot be shown again once you close this dialog.{expiresAt ? ` It expires ${new Date(expiresAt).toLocaleString('en-GB')}.` : ' It expires in 48 hours.'}</span>
        </div>
        <button onClick={onClose} className="btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 'var(--fs-base)', padding: 10 }}>Done</button>
      </div>
    </div>
  );
}

/** Button + modal. `onIssued` lets the caller refresh its waiting state. */
export function ReissueLinkButton({ userId, email, label = 'Re-issue sign-in link', onIssued, style }: {
  userId: string;
  email: string;
  label?: string;
  onIssued?: () => void;
  style?: React.CSSProperties;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt?: string } | null>(null);

  async function issue() {
    setBusy(true);
    setError('');
    const res = await apiClient.post<{ setPasswordUrl: string; expiresAt?: string }>(`/api/admin/users/${userId}/set-password-link`, {});
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not issue a link.'); return; }
    setLink({ url: res.data.setPasswordUrl, expiresAt: res.data.expiresAt });
    onIssued?.();
  }

  return (
    <>
      <button
        onClick={() => void issue()}
        disabled={busy}
        style={{ padding: 11, borderRadius: 12, fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'rgba(var(--primary-rgb),0.12)', border: '1px solid rgba(var(--primary-rgb),0.3)', color: 'var(--primary-green)', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...style }}
      >
        <Key size={13} /> {busy ? 'Issuing…' : label}
      </button>
      {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginTop: 6 }}>{error}</div>}
      {link && <AdminSetPasswordLinkModal email={email} url={link.url} expiresAt={link.expiresAt} onClose={() => setLink(null)} />}
    </>
  );
}
