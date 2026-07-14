'use client';
// Encrypts data at rest in the worker's local IndexedDB store (queued records,
// cached reference data) — previously plaintext, readable by anyone who could
// inspect the device's browser profile (e.g. a lost/stolen phone plugged into
// a PC, or its files copied off via a backup tool), even while OS-locked or
// with the IFMS app logged out.
//
// Key design: one AES-256-GCM key PER DEVICE, generated once and stored as a
// non-extractable CryptoKey object directly in IndexedDB (browsers natively
// structured-clone CryptoKey — this is exactly why the Web Crypto spec made it
// clonable). Not derived from the worker's PIN: the worker's session never
// re-prompts for the PIN after first login (persisted across reloads/restarts
// so the offline-first app "just works"), so a PIN-derived, in-memory-only key
// would be lost on every routine background-kill/reload with no way to
// re-derive it — breaking the app's ability to read its own cache. A
// non-extractable device key survives exactly as long as the session already
// does, with zero extra user friction.
//
// Threat model, stated plainly: this protects a lost/stolen device that's
// locked or logged out — the ciphertext and the wrapped key are both useless
// outside the original device/browser profile (Chromium wraps the underlying
// key bytes under OS-level protection). It does NOT and cannot protect a
// device that's unlocked and already logged in — at that point the running
// page can call decrypt itself, same as any client-side scheme.
import { getDB } from './db';

async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const db = getDB();
  const row = await db.keyStore.get('device-key');
  if (row) return row.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await db.keyStore.put({ id: 'device-key', key, createdAt: new Date().toISOString() });
  return key;
}

export interface EncryptedEnvelope {
  iv: string; // base64
  ct: string; // base64
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptString(plaintext: string): Promise<EncryptedEnvelope> {
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ctBuf)) };
}

export async function decryptString(env: EncryptedEnvelope): Promise<string> {
  const key = await getOrCreateDeviceKey();
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv) }, key, fromBase64(env.ct));
  return new TextDecoder().decode(ptBuf);
}
