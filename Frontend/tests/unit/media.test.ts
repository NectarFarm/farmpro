import { describe, it, expect } from 'vitest';
import { validatePhotoDataUrl, MAX_PHOTO_DATA_URL_CHARS } from '@/lib/server/media';

describe('validatePhotoDataUrl', () => {
  it('accepts a small jpeg data URL', () => {
    // minimal valid-looking jpeg data URL (tiny base64 payload)
    const data = 'data:image/jpeg;base64,/9j/4AAQ';
    const r = validatePhotoDataUrl(data);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mime).toBe('image/jpeg');
  });

  it('rejects non-strings and empty', () => {
    expect(validatePhotoDataUrl(null).ok).toBe(false);
    expect(validatePhotoDataUrl('').ok).toBe(false);
  });

  it('rejects non-image or wrong mime', () => {
    expect(validatePhotoDataUrl('data:text/plain;base64,aaaa').ok).toBe(false);
    expect(validatePhotoDataUrl('http://example.com/x.jpg').ok).toBe(false);
  });

  it('rejects oversized data URLs', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(MAX_PHOTO_DATA_URL_CHARS)}`;
    expect(validatePhotoDataUrl(huge).ok).toBe(false);
  });
});
