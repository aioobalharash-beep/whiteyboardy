import { Crosshair, Maximize, Minus, Plus } from "lucide-react";
import { useValue, type Editor } from "tldraw";

interface ZoomHudProps {
  visible: boolean;
  editor: Editor | null;
}

/**
 * tldraw plays animated camera moves on its own animation clock. We deliberately
 * use the immediate variants instead: they never depend on that clock running,
 * so the HUD is always responsive. Center-anchored calls keep the point under the
 * cursor steady while zooming.
 */

/**
 * A floating navigation HUD pinned to the bottom-right of the canvas.
 *
 * It surfaces the current zoom level (so you always know how far in or out you
 * are) and gives one-click ways back to a known view: reset to 100 %, fit every
 * shape on the page, or jump to the current selection.
 */
export function ZoomHud({ visible, editor }: ZoomHudProps) {
  const zoomLevel = useValue(
    "zoom-level",
    () => (editor ? editor.getZoomLevel() : 1),
    [editor],
  );
  const selectionCount = useValue(
    "zoom-selection-count",
    () => (editor ? editor.getSelectedShapeIds().length : 0),
    [editor],
  );

  if (!visible || !editor) return null;

  const percentage = Math.round(zoomLevel * 100);

  const buttonClass =
    "flex h-7 w-7 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="wb-animate-in fixed right-4 bottom-4 z-30 flex items-center gap-0.5 rounded-2xl border border-neutral-200/80 bg-white/85 p-1.5 shadow-lg shadow-neutral-900/5 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => editor.zoomOut(editor.getViewportScreenCenter(), ZOOM_ANIMATION)}
        title="Zoom out"
        aria-label="Zoom out"
        className={buttonClass}
      >
        <Minus className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => editor.resetZoom(editor.getViewportScreenCenter(), ZOOM_ANIMATION)}
        title="Reset zoom to 100%"
        aria-label="Reset zoom to 100%"
        className="flex h-7 min-w-[52px] items-center justify-center rounded-lg px-1 text-[12px] font-medium tabular-nums text-neutral-700 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
      >
        {percentage}%
      </button>

      <button
        type="button"
        onClick={() => editor.zoomIn(editor.getViewportScreenCenter(), ZOOM_ANIMATION)}
        title="Zoom in"
        aria-label="Zoom in"
        className={buttonClass}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>

      <span className="mx-1 h-5 w-px bg-neutral-200/80" aria-hidden />

      <button
        type="button"
        onClick={() => editor.zoomToFit(ZOOM_ANIMATION)}
        title="Zoom to fit everything on this board"
        aria-label="Zoom to fit"
        className={buttonClass}
      >
        <Maximize className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        disabled={selectionCount === 0}
        onClick={() => editor.zoomToSelection(ZOOM_ANIMATION)}
        title="Zoom to the current selection"
        aria-label="Zoom to selection"
        className={buttonClass}
      >
        <Crosshair className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
