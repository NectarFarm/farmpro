// ── Shared photo rules (several-photos-per-record task) ─────────────────────
// One place for the constants and the pure helpers POST /api/records enforces
// server-side and components/farm/worker.tsx checks before it ever calls the
// API — so a worker sees "too many photos" or "that one's too big" as a plain
// message on the device, not just a 400 the form has to guess how to explain.
//
// No 'server-only'/'use client' here on purpose: this is pure data + pure
// functions (no Node or DOM API), safe to import from both a route handler
// and a client component.

/** A record may carry at most this many photos (mortality's own "several
 * angles for a disease investigation" case, generalised to every record type
 * that accepts a photo). */
export const MAX_RECORD_PHOTOS = 4

// ── Why 500 KB decoded, per photo ───────────────────────────────────────────
// The client always compresses before sending (draw to canvas, longest edge
// ~1280px, JPEG ~0.7 quality — see lib/image-compress.ts), and a photo that
// size typically lands at 80–250KB. 500KB decoded (~667KB once base64
// inflates it by 4/3) is generous headroom for a busy/high-detail shot while
// keeping the real ceiling in view: four photos at the cap plus the rest of
// the JSON body sits at roughly 2.9MB of base64 text, comfortably under the
// ~4.5MB request-body limit this app's production host (Vercel serverless
// functions) enforces and cannot be configured past — a jsonb column would
// happily take far more, but the request would never arrive.
export const MAX_PHOTO_BYTES = 500 * 1024

// data:image/<kind>;base64,<payload> — the exact shape both the mortality
// FileReader path and the new canvas-compression path produce. Anything else
// (a plain https:// link, a non-image mime type, a malformed data URL) is
// refused: a photo the server cannot itself display is not a photo an
// approver's gallery or a worker's own thumbnail strip can render either.
const IMAGE_DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+=*)$/

export function isImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL_RE.test(value)
}

/** Decoded byte size of a data URL's base64 payload, without ever allocating
 * a Buffer for it — this runs in the browser too, where Buffer doesn't
 * exist. Padding (`=`/`==`) is accounted for so the estimate is exact, not
 * just close. */
export function dataUrlByteSize(value: string): number {
  const comma = value.indexOf(',')
  if (comma === -1) return 0
  const base64 = value.slice(comma + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

export interface PhotoValidationError {
  index: number
  message: string
}

/** Validates a normalised photo list against the shared rules. Returns the
 * FIRST problem found (one clear error beats a list of them on a phone
 * screen), or null when every photo is fine. Shared so the worker form can
 * show the same message the server would refuse it with, before it ever
 * makes the request. */
export function firstInvalidPhoto(photoUrls: string[]): PhotoValidationError | null {
  if (photoUrls.length > MAX_RECORD_PHOTOS) {
    return { index: MAX_RECORD_PHOTOS, message: `At most ${MAX_RECORD_PHOTOS} photos are allowed on one record` }
  }
  for (let i = 0; i < photoUrls.length; i++) {
    const url = photoUrls[i]
    if (!isImageDataUrl(url)) {
      return { index: i, message: `Photo ${i + 1} isn't a photo this app can read — retake it` }
    }
    if (dataUrlByteSize(url) > MAX_PHOTO_BYTES) {
      return { index: i, message: `Photo ${i + 1} is too large — retake it and it will be compressed automatically` }
    }
  }
  return null
}
