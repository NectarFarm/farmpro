import 'server-only';
// Photo / media guards. Checks stop oversized or non-image payloads from bloating
// the database or DoS-ing sync. Photos are stored in R2 (object storage) when
// configured, with a base64 data URL fallback for small-scale/local setups.

/** Max length of a data-URL string (~300 KB JPEG after compression ≈ ~400 KB URL). */
export const MAX_PHOTO_DATA_URL_CHARS = 450_000;

/** Max decoded image bytes once base64 is expanded (defense in depth). */
export const MAX_PHOTO_DECODED_BYTES = 350_000;

export type PhotoValidation =
  | { ok: true; mime: string; bytes: Uint8Array }
  | { ok: false; error: string };

/**
 * Validate a client-supplied photo data URL before insert, returning raw bytes
 * for upload to object storage.
 * Accepts only image/* JPEG/PNG/WebP data URLs under size limits.
 */
export function validatePhotoDataUrl(data: unknown): PhotoValidation {
  if (typeof data !== 'string' || !data) {
    return { ok: false, error: 'Photo must be a data URL string.' };
  }
  if (data.length > MAX_PHOTO_DATA_URL_CHARS) {
    return { ok: false, error: `Photo is too large (max ~${Math.round(MAX_PHOTO_DECODED_BYTES / 1024)} KB). Compress and retry.` };
  }
  const m = data.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) {
    return { ok: false, error: 'Photo must be a JPEG, PNG, or WebP data URL.' };
  }
  const b64 = m[3].replace(/\s/g, '');
  // base64 expands ~4/3; reject if decoded would exceed cap
  const decodedApprox = Math.floor((b64.length * 3) / 4);
  if (decodedApprox > MAX_PHOTO_DECODED_BYTES) {
    return { ok: false, error: `Photo is too large (max ~${Math.round(MAX_PHOTO_DECODED_BYTES / 1024)} KB). Compress and retry.` };
  }
  const mime = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  // Decode the base64 payload into raw bytes for object storage.
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { ok: true, mime, bytes };
}

/**
 * Decode a data URL string into raw bytes + mime type.
 * Returns null for invalid or non-image data URLs.
 */
export function decodeDataUrl(data: string): { mime: string; bytes: Uint8Array } | null {
  const m = data.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return { mime: m[1], bytes };
  } catch {
    return null;
  }
}
