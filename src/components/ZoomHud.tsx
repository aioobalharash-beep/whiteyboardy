import { Crosshair, Maximize, Minus, Plus } from "lucide-react";
import { useValue, type Editor } from "tldraw";

interface ZoomHudProps {
  visible: boolean;
  editor: Editor | null;
}

/**
 * A floating navigation HUD pinned to the bottom-right of the canvas.
 *
 * It surfaces the current zoom level (so you always know how far in or out you
 * are) and gives one-click ways back to a known view: reset to 100 %, fit every
 * shape on the page, or jump to the current selection.
 *
 * The buttons call tldraw's immediate camera helpers rather than its animated
 * ones: an animation only advances on tldraw's own frame clock, so an immediate
 * move keeps the HUD responsive no matter what else is happening on the canvas.
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
        onClick={() => editor.zoomOut()}
        title="Zoom out"
        aria-label="Zoom out"
        className={buttonClass}
      >
        <Minus className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => editor.resetZoom()}
        title="Reset zoom to 100%"
        aria-label="Reset zoom to 100%"
        className="flex h-7 min-w-[52px] items-center justify-center rounded-lg px-1 text-[12px] font-medium tabular-nums text-neutral-700 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
      >
        {percentage}%
      </button>

      <button
        type="button"
        onClick={() => editor.zoomIn()}
        title="Zoom in"
        aria-label="Zoom in"
        className={buttonClass}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>

      <span className="mx-1 h-5 w-px bg-neutral-200/80" aria-hidden />

      <button
        type="button"
        onClick={() => editor.zoomToFit()}
        title="Zoom to fit everything on this board"
        aria-label="Zoom to fit"
        className={buttonClass}
      >
        <Maximize className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        disabled={selectionCount === 0}
        onClick={() => editor.zoomToSelection()}
        title="Zoom to the current selection"
        aria-label="Zoom to selection"
        className={buttonClass}
      >
        <Crosshair className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
