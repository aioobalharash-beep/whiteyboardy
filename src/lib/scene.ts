import { getNonDeletedElements, isLinearElement } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { BoardSceneFile } from "./storage";

/**
 * The editor state every board starts from.
 *
 * Excalidraw's own defaults are worth overriding in two places: the pen is a
 * sketchy "artist" stroke unless `roughness` is 0, and the board background is
 * transparent unless it is set. Both are applied *under* whatever a saved board
 * carries, so a board that was saved with sketchy lines keeps them.
 */
export const DEFAULT_APP_STATE: Readonly<Partial<AppState>> = {
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid",
  currentItemStrokeWidth: 2,
  currentItemStrokeStyle: "solid",
  currentItemRoughness: 0,
  currentItemOpacity: 100,
  currentItemRoundness: "sharp",
  viewBackgroundColor: "#ffffff",
};

/**
 * The app-state keys WhiteyBoardy keeps beside the scene.
 *
 * Excalidraw's serializer writes a document (elements, files and the board
 * background): the live pen style and the camera are deliberately left out of
 * its file format. Keeping them here means a board opens exactly where you left
 * it, with the pen you were drawing with — which is what the previous canvas
 * engine did for us.
 */
const SAVED_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "gridSize",
  "zoom",
  "scrollX",
  "scrollY",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemRoundness",
] as const satisfies readonly (keyof AppState)[];

/** Keeps only the image binaries the surviving elements still reference. */
function referencedFiles(
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): BinaryFiles {
  const kept: BinaryFiles = {};
  for (const element of elements) {
    if ("fileId" in element && element.fileId && files[element.fileId]) {
      kept[element.fileId] = files[element.fileId];
    }
  }
  return kept;
}

/**
 * Serializes a board.
 *
 * The output is a normal Excalidraw file (`type`, `version`, `source`,
 * `elements`, `appState`, `files`) with a few extra app-state keys that
 * Excalidraw itself ignores on load. Deleted elements are dropped and linear
 * elements lose the transient pointer they were last committed to, matching
 * what Excalidraw writes to disk.
 */
export function serializeScene(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): string {
  const live = getNonDeletedElements(elements);

  const savedAppState: Record<string, unknown> = {};
  for (const key of SAVED_APP_STATE_KEYS) {
    const value = appState[key];
    if (value !== undefined) savedAppState[key] = value;
  }

  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "whiteyboardy",
    elements: live.map((element) =>
      isLinearElement(element)
        ? { ...element, lastCommittedPoint: null }
        : element,
    ),
    appState: savedAppState,
    files: referencedFiles(live, files),
  });
}

export interface LoadedBoard {
  initialData: ImportedDataState;
  /** Whether the file carried a camera position worth restoring. */
  hasSavedView: boolean;
}

/**
 * Turns a stored board file into the data Excalidraw mounts with.
 *
 * Our defaults go in first so the pen is never sketchy by accident; anything
 * the board saved wins over them.
 */
export function boardInitialData(file: BoardSceneFile | null): LoadedBoard {
  const appState = (file?.appState ?? {}) as Partial<AppState>;

  return {
    initialData: {
      type: "excalidraw",
      version: file?.version ?? 2,
      source: file?.source ?? "whiteyboardy",
      elements: (file?.elements ?? []) as unknown as ImportedDataState["elements"],
      appState: { ...DEFAULT_APP_STATE, ...appState },
      files: (file?.files ?? {}) as unknown as ImportedDataState["files"],
    },
    hasSavedView:
      typeof appState.scrollX === "number" && typeof appState.scrollY === "number",
  };
}
