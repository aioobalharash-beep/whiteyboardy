import { useCallback, useEffect, useRef } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type {
  ActiveTool,
  ExcalidrawImperativeAPI,
  PointerDownState,
} from "@excalidraw/excalidraw/types";
import {
  DRAG_THRESHOLD_PX,
  PEN_CUSTOM_TYPE,
  commitPenPath,
  isNearFirstAnchor,
  snapTo45,
  type PenAnchor,
  type PenStyle,
} from "../lib/pen";
import type { Point } from "../lib/shapes";

/**
 * What the overlay paints: the anchors placed so far, plus the live pointer.
 *
 * The draft deliberately lives *outside* the board: it is never written to the
 * scene, so a half-drawn path cannot be autosaved, cannot land in the undo
 * history and cannot leak into another board. Only a finished path becomes an
 * element.
 */
export interface PenDraft {
  anchors: PenAnchor[];
  /** Scene position of the pointer, for the segment that has not been placed. */
  cursor: Point | null;
  /** The pointer is over the first anchor, so a click would close the path. */
  closing: boolean;
}

const EMPTY_DRAFT: PenDraft = { anchors: [], cursor: null, closing: false };

export type PenListener = (draft: PenDraft) => void;

interface DragState {
  /** The anchor the pointer went down on. */
  index: number;
  /** The pointer moved far enough to be shaping a handle rather than clicking. */
  moved: boolean;
  /** Dragging on the first anchor: releasing closes the path. */
  closing: boolean;
}

interface UsePenToolOptions {
  api: ExcalidrawImperativeAPI | null;
  /** True while the pen is the dock's active tool. */
  active: boolean;
  /** Read when the path is committed, so a style change mid-path is honoured. */
  getStyle: () => PenStyle;
}

export interface PenTool {
  /** Lets the overlay (and only the overlay) re-render as the path grows. */
  subscribe: (listener: PenListener) => () => void;
  getDraft: () => PenDraft;
  /** Handles the keys the pen owns; `true` means the event was consumed. */
  handleKeyDown: (event: KeyboardEvent) => boolean;
}

/** True when Excalidraw's active tool is this pen and not another custom tool. */
function isPenTool(activeTool: {
  type: string;
  customType?: string | null;
}): boolean {
  return activeTool.type === "custom" && activeTool.customType === PEN_CUSTOM_TYPE;
}

/** How far a handle is allowed to be dragged, in scene units. */
const MAX_HANDLE_LENGTH = 400;

/**
 * The pen tool: click to place anchors, drag to curve the segment through the
 * anchor, click the first anchor to close, Enter to finish an open path.
 *
 * Excalidraw hands custom tools a bare pointer stream and nothing else, so the
 * whole interaction — anchors, tangents, the rubber band, closing, undo of the
 * last point — is driven from here. The engine still does the parts that matter
 * for the board: the finished path is an ordinary `line` element.
 */
export function usePenTool({
  api,
  active,
  getStyle,
}: UsePenToolOptions): PenTool {
  const draftRef = useRef<PenDraft>(EMPTY_DRAFT);
  const listenersRef = useRef(new Set<PenListener>());
  const dragRef = useRef<DragState | null>(null);
  const apiRef = useRef(api);
  const activeRef = useRef(active);
  const getStyleRef = useRef(getStyle);

  getStyleRef.current = getStyle;

  const emit = useCallback(() => {
    for (const listener of listenersRef.current) listener(draftRef.current);
  }, []);

  const update = useCallback(
    (draft: PenDraft) => {
      draftRef.current = draft;
      emit();
    },
    [emit],
  );

  const reset = useCallback(() => {
    dragRef.current = null;
    if (draftRef.current !== EMPTY_DRAFT) update(EMPTY_DRAFT);
  }, [update]);

  /** Turns the anchors into a board element and clears the draft. */
  const finish = useCallback(
    (closed: boolean) => {
      const { anchors } = draftRef.current;
      const currentApi = apiRef.current;
      if (currentApi && anchors.length >= 2) {
        commitPenPath(currentApi, anchors, closed, getStyleRef.current());
      }
      reset();
    },
    [reset],
  );

  const subscribe = useCallback((listener: PenListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getDraft = useCallback(() => draftRef.current, []);

  // A new editor instance means a different board: a half-drawn path belongs to
  // the board it was started on, so it is dropped rather than carried over.
  useEffect(() => {
    apiRef.current = api;
    reset();
  }, [api, reset]);

  // Leaving the pen keeps the work: an unfinished path is committed as an open
  // one, the way switching tools commits a work path rather than losing it.
  useEffect(() => {
    activeRef.current = active;
    if (active) return;
    if (draftRef.current.anchors.length >= 2) finish(false);
    else reset();
  }, [active, finish, reset]);

  // --- Pointer down / up: anchors, handles and closing --------------------
  useEffect(() => {
    if (!api) return;

    const onDown = (
      activeTool: ActiveTool,
      _pointerDownState: PointerDownState,
      event: React.PointerEvent<HTMLElement>,
    ) => {
      if (!activeRef.current || !isPenTool(activeTool)) return;

      const currentApi = apiRef.current;
      if (!currentApi) return;

      const appState = currentApi.getAppState();
      const point = viewportCoordsToSceneCoords(event, appState);
      const draft = draftRef.current;

      // The second click of a double-click ends an open path where it stands.
      if (event.detail >= 2) {
        if (draft.anchors.length >= 2) finish(false);
        return;
      }

      const closing = isNearFirstAnchor(draft.anchors, point, appState.zoom.value);
      if (closing) {
        dragRef.current = { index: 0, moved: false, closing: true };
        update({ ...draft, cursor: point, closing: true });
        return;
      }

      const anchors = [
        ...draft.anchors,
        { x: point.x, y: point.y, in: null, out: null },
      ];
      dragRef.current = {
        index: anchors.length - 1,
        moved: false,
        closing: false,
      };
      update({ anchors, cursor: point, closing: false });
    };

    const onUp = (
      activeTool: Parameters<Parameters<typeof api.onPointerUp>[0]>[0],
      _pointerDownState: unknown,
      event: Parameters<Parameters<typeof api.onPointerUp>[0]>[2],
    ) => {
      if (!isPenTool(activeTool)) return;

      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;

      if (drag.closing) {
        finish(true);
        return;
      }

      const currentApi = apiRef.current;
      if (!currentApi) return;
      const appState = currentApi.getAppState();
      const point = viewportCoordsToSceneCoords(event, appState);
      update({
        ...draftRef.current,
        cursor: point,
        closing: isNearFirstAnchor(draftRef.current.anchors, point, appState.zoom.value),
      });
    };

    const unsubscribeDown = api.onPointerDown(onDown);
    const unsubscribeUp = api.onPointerUp(onUp);
    return () => {
      unsubscribeDown();
      unsubscribeUp();
    };
  }, [api, finish, update]);

  // --- Pointer move: shaping the handle, or the rubber band ---------------
  useEffect(() => {
    if (!api) return;

    const onMove = (event: PointerEvent) => {
      if (!activeRef.current) return;
      const currentApi = apiRef.current;
      if (!currentApi) return;

      const appState = currentApi.getAppState();
      const point = viewportCoordsToSceneCoords(event, appState);
      const draft = draftRef.current;
      const drag = dragRef.current;

      if (drag) {
        const anchor = draft.anchors[drag.index];
        if (!anchor) return;

        const dragged = { x: point.x - anchor.x, y: point.y - anchor.y };
        const limit = Math.hypot(dragged.x, dragged.y);
        if (!drag.moved && limit * appState.zoom.value > DRAG_THRESHOLD_PX) {
          drag.moved = true;
        }
        if (!drag.moved) {
          update({ ...draft, cursor: point });
          return;
        }

        const scaled =
          limit > MAX_HANDLE_LENGTH
            ? {
                x: (dragged.x / limit) * MAX_HANDLE_LENGTH,
                y: (dragged.y / limit) * MAX_HANDLE_LENGTH,
              }
            : dragged;
        const handle = event.shiftKey
          ? snapTo45({ x: 0, y: 0 }, scaled)
          : scaled;

        const anchors = draft.anchors.slice();
        anchors[drag.index] = event.altKey
          ? // Alt (Option) breaks the handle: the path arrives here as a corner
            // and leaves along the drag, as Photoshop's pen does.
            { ...anchor, out: handle }
          : { ...anchor, in: { x: -handle.x, y: -handle.y }, out: handle };
        update({ anchors, cursor: point, closing: false });
        return;
      }

      if (draft.anchors.length === 0) {
        if (draft.cursor) update({ ...draft, cursor: null });
        return;
      }

      const last = draft.anchors[draft.anchors.length - 1];
      update({
        anchors: draft.anchors,
        cursor: event.shiftKey
          ? snapTo45({ x: last.x, y: last.y }, point)
          : point,
        closing: isNearFirstAnchor(draft.anchors, point, appState.zoom.value),
      });
    };

    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [api, update]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (!activeRef.current) return false;

      const draft = draftRef.current;
      if (draft.anchors.length === 0) return false;

      if (event.key === "Enter") {
        finish(false);
        return true;
      }

      if (event.key === "Escape") {
        // Escape abandons the path; the board is left exactly as it was.
        reset();
        return true;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        update({
          anchors: draft.anchors.slice(0, -1),
          cursor: draft.cursor,
          closing: false,
        });
        return true;
      }

      return false;
    },
    [finish, reset, update],
  );

  return { subscribe, getDraft, handleKeyDown };
}
