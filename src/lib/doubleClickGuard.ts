import { useEffect, useRef, useState } from 'react';

/** Wait long enough that a first click can select without eating the second click. */
export const DOUBLE_CLICK_GUARD_MS = 300;

export function inspectorRevealDelayMs(input: {
  show: boolean;
  alreadyRevealed: boolean;
  immediate: boolean;
  fromCanvasPointer: boolean;
}): number | null {
  if (!input.show) return null;
  if (input.alreadyRevealed || input.immediate || !input.fromCanvasPointer) return 0;
  return DOUBLE_CLICK_GUARD_MS;
}

/** True when the latest pointer-down landed inside the React Flow canvas. */
export function useCanvasPointerFlag() {
  const fromCanvasRef = useRef(false);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      fromCanvasRef.current = !!(event.target as HTMLElement | null)?.closest('.react-flow');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);
  return fromCanvasRef;
}

/** Keep the inspector from covering a canvas double-click that just selected something. */
export function useDelayedInspectorReveal(show: boolean, immediate: boolean) {
  const [revealed, setRevealed] = useState(show);
  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const fromCanvasRef = useCanvasPointerFlag();

  useEffect(() => {
    const delay = inspectorRevealDelayMs({
      show,
      alreadyRevealed: revealedRef.current,
      immediate,
      fromCanvasPointer: fromCanvasRef.current,
    });
    if (delay == null) {
      setRevealed(false);
      return;
    }
    if (delay === 0) {
      setRevealed(true);
      return;
    }
    const timer = window.setTimeout(() => setRevealed(true), delay);
    return () => window.clearTimeout(timer);
  }, [fromCanvasRef, immediate, show]);

  return revealed;
}
