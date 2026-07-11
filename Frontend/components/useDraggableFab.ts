'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

interface DragPos { x: number; y: number }

// Below this many px of movement, a pointer gesture is treated as a tap (opens
// the panel) rather than a drag — otherwise the slightest finger tremor on a
// touch screen would repeatedly "drag" a button the user only meant to press.
const DRAG_THRESHOLD = 6;
const EDGE_MARGIN = 4;

// Draggable floating-action-button positioning, shared by AIAdvisor and
// SetupGuide. Until the user first drags it, the button keeps its original
// Tailwind fixed-corner classes (no measurement needed, fully responsive
// across breakpoints). The first drag switches it to an explicit pixel
// position that's clamped to the viewport and remembered per-device.
export function useDraggableFab(storageKey: string) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<DragPos | null>(null);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setPos(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [storageKey]);

  const clampToViewport = useCallback((x: number, y: number) => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
    return { x: Math.min(Math.max(EDGE_MARGIN, x), maxX), y: Math.min(Math.max(EDGE_MARGIN, y), maxY) };
  }, []);

  // Keep a previously-dragged position on-screen across resizes/rotation.
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clampToViewport(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, clampToViewport]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    drag.current = { startX: e.clientX, startY: e.clientY, originX: rect.left, originY: rect.top, moved: false };
    el.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setPos(clampToViewport(d.originX + dx, d.originY + dy));
  }, [clampToViewport]);

  const onPointerUp = useCallback(() => {
    const d = drag.current;
    if (d?.moved) {
      setPos((p) => {
        try { if (p) localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* ignore */ }
        return p;
      });
    }
  }, [storageKey]);

  // Read right after a gesture (in the onClick that immediately follows
  // pointerup) to suppress opening the panel when that gesture was a drag.
  const wasDragged = () => drag.current?.moved ?? false;

  const style: React.CSSProperties | undefined = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', touchAction: 'none' }
    : { touchAction: 'none' };

  return { ref, style, onPointerDown, onPointerMove, onPointerUp, wasDragged };
}
