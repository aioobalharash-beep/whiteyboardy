import { useEffect, useState } from "react";
import { Crosshair, Maximize, Minus, Plus } from "lucide-react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw";

interface ZoomHudProps {
  visible: boolean;
  api: ExcalidrawImperativeAPI | null;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 30;
const ZOOM_STEP = 1.25;
/** How often the HUD refreshes its reading of the editor's app state. */
const POLL_MS = 200;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/**
 * Changes the zoom while keeping whatever is in the middle of the viewport in
 * the middle of the viewport.
 *
 * Excalidraw has no zoom helpers on its imperative API, so the scroll offset is
 * recomputed from the scene coordinate under the viewport's centre.
 */
function zoomAroundCentre(api: ExcalidrawImperativeAPI, nextZoom: number): void {
  const { zoom, scrollX, scrollY, width, height } = api.getAppState();
  const value = clampZoom(nextZoom);
  if (value === zoom.value) return;

  const centreX = (width / 2 - scrollX) / zoom.value;
  const centreY = (height / 2 - scrollY) / zoom.value;

  api.updateScene({
    appState: {
      zoom: { value },
      scrollX: width / 2 - centreX * value,
      scrollY: height / 2 - centreY * value,
    },
  });
}

/**
 * A floating navigation HUD pinned to the bottom-right of the canvas.
 *
 * It surfaces the current zoom level (so you always know how far in or out you
 * are) and gives one-click ways back to a known view: reset to 100 %, fit
 * everything on the board, or jump to the current selection.
 *
 * Excalidraw's imperative API has no subscribe-to-app-state hook, so the HUD
 * polls it. A 200 ms interval is far cheaper than re-rendering the whole app on
 * every pointer move, and it keeps the readout live while pinch-zooming.
 */
export function ZoomHud({ visible, api }: ZoomHudProps) {
  const [zoom, setZoom] = useState(1);
  const [selectionCount, setSelectionCount] = useState(0);

  useEffect(() => {
    if (!visible || !api) return;

    const read = () => {
      const state = api.getAppState();
      setZoom(state.zoom.value);
      setSelectionCount(
        Object.values(state.selectedElementIds).filter(Boolean).length,
      );
    };

    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => window.clearInterval(timer);
  }, [visible, api]);

  if (!visible || !api) return null;

  const zoomToFit = () => {
    const elements = api.getSceneElements().filter((element) => !element.isDeleted);
    if (elements.length === 0) {
      zoomAroundCentre(api, 1);
      return;
    }
    api.scrollToContent(elements, { fitToContent: true });
  };

  const zoomToSelection = () => {
    const state = api.getAppState();
    const selected = api
      .getSceneElements()
      .filter((element) => !element.isDeleted && state.selectedElementIds[element.id]);
    if (selected.length === 0) return;
    api.scrollToContent(selected, { fitToContent: true });
  };

  const buttonClass =
    "flex h-7 w-7 items-center justify-center rounded-lg text-neutral-600 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="wb-animate-in fixed right-4 bottom-4 z-30 flex items-center gap-0.5 rounded-2xl border border-neutral-200/80 bg-white/85 p-1.5 shadow-lg shadow-neutral-900/5 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => zoomAroundCentre(api, zoom / ZOOM_STEP)}
        title="Zoom out"
        aria-label="Zoom out"
        className={buttonClass}
      >
        <Minus className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => zoomAroundCentre(api, 1)}
        title="Reset zoom to 100%"
        aria-label="Reset zoom to 100%"
        className="flex h-7 min-w-[52px] items-center justify-center rounded-lg px-1 text-[12px] font-medium tabular-nums text-neutral-700 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
      >
        {Math.round(zoom * 100)}%
      </button>

      <button
        type="button"
        onClick={() => zoomAroundCentre(api, zoom * ZOOM_STEP)}
        title="Zoom in"
        aria-label="Zoom in"
        className={buttonClass}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>

      <span className="mx-1 h-5 w-px bg-neutral-200/80" aria-hidden />

      <button
        type="button"
        onClick={zoomToFit}
        title="Zoom to fit everything on this board"
        aria-label="Zoom to fit"
        className={buttonClass}
      >
        <Maximize className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        disabled={selectionCount === 0}
        onClick={zoomToSelection}
        title="Zoom to the current selection"
        aria-label="Zoom to selection"
        className={buttonClass}
      >
        <Crosshair className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
