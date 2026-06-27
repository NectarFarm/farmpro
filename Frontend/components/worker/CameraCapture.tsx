'use client';
// DS-6: Camera + GPS from device API (never EXIF). Photo + GPS stored as separate fields.
import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface CaptureResult {
  dataUrl: string; // compressed ~300KB
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracy?: number;
  gpsTimestamp?: string;
}

interface Props {
  onCapture: (r: CaptureResult) => void;
  onRemove?: () => void;
  captured?: CaptureResult | null;
  required?: boolean;
  label?: string;
  className?: string;
}

export function CameraCapture({ onCapture, onRemove, captured, required, label, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle'|'capturing'|'ok'|'unavailable'>('idle');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // GPS from device API at moment of capture — DS-6
    setGpsStatus('capturing');
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setGpsStatus('ok');
        compressAndCapture(file, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
      },
      () => {
        setGpsStatus('unavailable');
        compressAndCapture(file); // DS-8: proceed without GPS
      },
      { timeout: 5000, maximumAge: 10000 }
    );
  };

  const compressAndCapture = (file: File, lat?: number, lng?: number, accuracy?: number) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1200;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // ~300KB
        onCapture({
          dataUrl,
          gpsLat: lat,
          gpsLng: lng,
          gpsAccuracy: accuracy,
          gpsTimestamp: lat ? new Date().toISOString() : undefined,
        });
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {required && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">REQUIRED</span>}
        </div>
      )}
      {captured ? (
        <div className="relative rounded-xl overflow-hidden border-2 border-green-400">
          { }
          <img src={captured.dataUrl} alt="Captured" className="w-full max-h-48 object-cover" />
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-3 py-1 flex items-center gap-2">
            <span>📍</span>
            {captured.gpsLat
              ? <span>GPS ✓ {new Date(captured.gpsTimestamp!).toLocaleTimeString()}</span>
              : <span>geo: unavailable</span>
            }
            {onRemove && (
              <button type="button" onClick={onRemove} className="ml-auto text-red-300 hover:text-red-100">✕ Remove</button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'min-h-[56px] w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed text-base font-semibold transition-colors',
            required ? 'border-red-400 text-red-600 animate-pulse bg-red-50' : 'border-gray-300 text-gray-600 bg-gray-50 hover:bg-gray-100'
          )}
        >
          <span>📷</span>
          {required ? 'TAKE PHOTO (Required)' : 'Take Photo (Optional)'}
        </button>
      )}
      {gpsStatus === 'capturing' && (
        <p className="text-xs text-blue-600 flex items-center gap-1"><span className="animate-spin">↻</span> Capturing GPS…</p>
      )}
      {gpsStatus === 'unavailable' && (
        <p className="text-xs text-amber-600">⚠ GPS unavailable — record tagged geo: unavailable</p>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
    </div>
  );
}
