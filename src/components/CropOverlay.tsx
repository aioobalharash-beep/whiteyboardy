import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** A rectangle in screen (viewport) coordinates. */
export interface ScreenRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface CropOverlayProps {
  onComplete: (rect: ScreenRect) => void;
}

const MIN_DRAG = 8;

/**
 * Full-screen marquee used for section exports. It only reports screen-space
 * coordinates; the caller converts them to scene space with
 * `viewportCoordsToSceneCoords()`.
 */
export function CropOverlay({ onComplete }: CropOverlayProps) {
  const [rect, setRect] = useState<ScreenRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY };
    setRect(null);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    setRect({ x1: start.x, y1: start.y, x2: event.clientX, y2: event.clientY });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;

    if (!start) return;

    const next: ScreenRect = {
      x1: start.x,
      y1: start.y,
      x2: event.clientX,
      y2: event.clientY,
    };

    if (Math.abs(next.x2 - next.x1) < MIN_DRAG || Math.abs(next.y2 - next.y1) < MIN_DRAG) {
      // Ignore stray clicks so a mis-tap doesn't export a sliver of canvas.
      setRect(null);
      return;
    }

    onComplete(next);
  };

  return (
    <div
      role="presentation"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        startRef.current = null;
        setRect(null);
      }}
      className="crop-cursor fixed inset-0 z-50 touch-none bg-neutral-900/5 select-none"
    >
      <div className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 rounded-full border border-neutral-200/80 bg-white/90 px-4 py-1.5 text-[12px] font-medium text-neutral-700 shadow-lg shadow-neutral-900/5 backdrop-blur-xl">
        Drag to export section
        <span className="mx-2 text-neutral-300">•</span>
        Esc to cancel
      </div>

      {rect && (
        <div
          className="pointer-events-none fixed rounded-sm border-2 border-dashed border-neutral-900 bg-neutral-900/10"
          style={{
            left: Math.min(rect.x1, rect.x2),
            top: Math.min(rect.y1, rect.y2),
            width: Math.abs(rect.x2 - rect.x1),
            height: Math.abs(rect.y2 - rect.y1),
          }}
        />
      )}
    </div>
  );
}
