// ── Client-side photo compression (several-photos-per-record task) ──────────
// The mortality photo step used to hand POST /api/records whatever the
// camera produced, straight out of FileReader — a modern phone camera photo
// easily runs 3–8MB, and one already blew right past what a request body
// should carry; four of them never would. This draws the photo to a canvas
// at a capped size and re-encodes it as a moderate-quality JPEG before it
// ever reaches an API call, for both the single- and multi-photo paths.
//
// Browser-only (Image/canvas/FileReader) — only ever imported from a 'use
// client' component, never from a route handler.
export interface CompressOptions {
  /** Longest edge, in device pixels, after resizing. Anything already
   * smaller is left at its own size — this only ever shrinks. */
  maxEdge?: number
  /** JPEG quality, 0–1. */
  quality?: number
}

const DEFAULTS: Required<CompressOptions> = { maxEdge: 1280, quality: 0.7 }

/** Reads a File (from an `<input type="file">`) and resolves to a compressed
 * JPEG data URL. Rejects with a plain, farmer-facing message on any failure
 * — a corrupt file or a browser that refuses canvas export should read as
 * "try again", not a stack trace. */
export function compressImageFile(file: File, opts: CompressOptions = {}): Promise<string> {
  const { maxEdge, quality } = { ...DEFAULTS, ...opts }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Couldn't read that photo — try again"))
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) { reject(new Error("Couldn't read that photo — try again")); return }
      const img = new Image()
      img.onerror = () => reject(new Error("That file doesn't look like a photo"))
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
        const width = Math.max(1, Math.round(img.naturalWidth * scale))
        const height = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return } // no canvas support — fall back to the original rather than fail the capture
        ctx.drawImage(img, 0, 0, width, height)
        try {
          resolve(canvas.toDataURL('image/jpeg', quality))
        } catch {
          resolve(dataUrl)
        }
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}
