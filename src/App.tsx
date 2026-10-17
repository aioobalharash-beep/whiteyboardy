import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import {
  CaptureUpdateAction,
  Excalidraw,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import { BoardSidebar } from "./components/BoardSidebar";
import { CropOverlay, type ScreenRect } from "./components/CropOverlay";
import { ExportBar } from "./components/ExportBar";
import { PenOverlay } from "./components/PenOverlay";
import { Toast, type Notice } from "./components/Toast";
import { ToolDock, type DockToolId } from "./components/ToolDock";
import { ZoomHud } from "./components/ZoomHud";
import { EmptyBoardError, exportBoard, type ExportFormat } from "./lib/export";
import { usePenTool } from "./hooks/usePenTool";
import { insertImagesFromDevice } from "./lib/insert";
import { PEN_CUSTOM_TYPE, type PenStyle } from "./lib/pen";
import {
  DEFAULT_COLOR,
  DEFAULT_FILL,
  DEFAULT_SIZE,
  colorHex,
  colorNameFor,
  fillBackgroundFor,
  fillNameFor,
  sizeNameFor,
  strokeWidthFor,
  type BoardColorName,
  type BoardFillName,
  type BoardSizeName,
} from "./lib/palette";
import { boardInitialData, serializeScene } from "./lib/scene";
import {
  findShapeOption,
  insertGeneratedShape,
  viewportCentre,
} from "./lib/shapes";
import {
  createBoardId,
  createFolderId,
  deleteBoardScene,
  isTauriRuntime,
  loadBoardScene,
  loadLibrary,
  saveBoardScene,
  saveLibrary,
  storageStatus,
  type BoardIndexEntry,
  type FolderEntry,
} from "./lib/storage";

/** Width of the collapsible sidebar, mirrored by the canvas inset. */
const SIDEBAR_WIDTH = 256;
/** Debounce window for writing a board to disk. */
const AUTOSAVE_DELAY_MS = 500;
/** Debounce window for writing the board library to disk. */
const INDEX_SAVE_DELAY_MS = 300;

/** The live scene, exactly as Excalidraw's change listener reported it. */
interface LiveScene {
  boardId: string;
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}

/**
 * `updateScene` is declared as taking a complete `AppState` slice, but at
 * runtime it only copies the properties it is handed — so a partial patch is
 * exactly what it expects. Keeping that one discrepancy in a single helper
 * means it can never leak into a caller's types.
 */
function partialAppState(
  patch: Partial<AppState>,
): Pick<AppState, keyof AppState> {
  return patch as Pick<AppState, keyof AppState>;
}

/** Asks the user to confirm a destructive action, natively when possible. */
async function confirmDestructive(
  title: string,
  message: string,
  okLabel: string,
): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      return await confirmDialog(message, {
        title,
        kind: "warning",
        okLabel,
        cancelLabel: "Cancel",
      });
    } catch (error) {
      console.warn("[whiteyboardy] native confirm unavailable", error);
    }
  }
  return window.confirm(message);
}

export default function App() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [boards, setBoards] = useState<BoardIndexEntry[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [activeToolId, setActiveToolId] = useState<DockToolId>("selection");
  const [shapeId, setShapeId] = useState("rectangle");
  const [strokeColor, setStrokeColor] = useState<BoardColorName>(DEFAULT_COLOR);
  const [strokeSize, setStrokeSize] = useState<BoardSizeName>(DEFAULT_SIZE);
  const [fill, setFill] = useState<BoardFillName>(DEFAULT_FILL);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [isCropping, setIsCropping] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  /**
   * The data the canvas is mounted with, tagged with the board it belongs to.
   *
   * The tag matters: while a board switch is in flight the canvas must not be
   * mounted with the *previous* board's scene under the new board's id — its
   * first change notification would then be saved into the wrong board.
   */
  const [loadedBoard, setLoadedBoard] = useState<{
    boardId: string;
    data: ImportedDataState;
  } | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  const activeBoardIdRef = useRef<string | null>(null);
  /** Board ids that still exist in the library; scenes are never written for others. */
  const liveBoardIdsRef = useRef<Set<string>>(new Set());
  /** The newest scene the canvas reported, with the board it belongs to. */
  const sceneRef = useRef<LiveScene | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  // Mirrors of the dock state, so the change listener can tell what moved
  // without re-rendering the app on every pointer move.
  const activeToolIdRef = useRef<DockToolId>("selection");
  const strokeColorRef = useRef<BoardColorName>(DEFAULT_COLOR);
  const strokeSizeRef = useRef<BoardSizeName>(DEFAULT_SIZE);
  const fillRef = useRef<BoardFillName>(DEFAULT_FILL);
  const lastElementsRef = useRef<readonly ExcalidrawElement[] | null>(null);
  const lastFilesRef = useRef<BinaryFiles | null>(null);

  /** Read when a pen path is committed, so it lands in the current style. */
  const penStyle = useCallback(
    (): PenStyle => ({
      strokeColor: colorHex(strokeColorRef.current),
      strokeWidth: strokeWidthFor(strokeSizeRef.current),
      fillColor:
        fillRef.current === "none"
          ? null
          : fillBackgroundFor(fillRef.current, strokeColorRef.current),
    }),
    [],
  );

  const pen = usePenTool({
    api,
    active: activeToolId === "pen",
    getStyle: penStyle,
  });

  const activeBoard = useMemo(
    () => boards.find((board) => board.id === activeBoardId) ?? null,
    [boards, activeBoardId],
  );

  const showNotice = useCallback((next: Notice | null) => {
    setNotice(next);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    if (next) {
      noticeTimerRef.current = window.setTimeout(() => {
        noticeTimerRef.current = null;
        setNotice(null);
      }, 3400);
    }
  }, []);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
      if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    },
    [],
  );

  // Keep a ref in sync so the autosave listener always writes to the board that
  // is currently on screen.
  useEffect(() => {
    activeBoardIdRef.current = activeBoardId;
  }, [activeBoardId]);

  // Keep the set of live board ids fresh so a delayed write can never target a
  // board the user already deleted.
  useEffect(() => {
    liveBoardIdsRef.current = new Set(boards.map((board) => board.id));
  }, [boards]);

  // --- Initial board library ---------------------------------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const library = await loadLibrary();
        if (cancelled) return;

        if (library.boards.length === 0) {
          const board: BoardIndexEntry = {
            id: createBoardId(),
            name: "Untitled board",
            folderId: null,
            pinned: false,
            updatedAt: Date.now(),
          };
          setFolders(library.folders);
          setBoards([board]);
          setActiveBoardId(board.id);
          return;
        }

        setFolders(library.folders);
        setBoards(library.boards);
        const mostRecent = [...library.boards].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        )[0];
        setActiveBoardId(mostRecent.id);
      } catch (error) {
        console.error("[whiteyboardy] could not load the board library", error);
        if (!cancelled) {
          const board: BoardIndexEntry = {
            id: createBoardId(),
            name: "Untitled board",
            folderId: null,
            pinned: false,
            updatedAt: Date.now(),
          };
          setBoards([board]);
          setActiveBoardId(board.id);
        }
      } finally {
        if (!cancelled) setLibraryLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Persist the board library -----------------------------------------
  useEffect(() => {
    if (!libraryLoaded) return;
    const timer = window.setTimeout(() => {
      void saveLibrary({ folders, boards }).catch((error) =>
        console.error("[whiteyboardy] could not save the board library", error),
      );
    }, INDEX_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [folders, boards, libraryLoaded]);

  /**
   * Tell the truth about where the boards are going: if the app data directory
   * cannot be used in the packaged app, the library silently lives in the
   * webview's local storage instead, which the user deserves to know about.
   */
  useEffect(() => {
    if (!libraryLoaded) return;
    let cancelled = false;

    void storageStatus().then((report) => {
      if (cancelled) return;
      if (report.backend === "files" || !isTauriRuntime()) return;
      showNotice({
        kind: "error",
        text: `Could not write to the app data folder (${
          report.error ?? "unknown reason"
        }). Boards are being saved to local web storage instead.`,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [libraryLoaded, showNotice]);

  /**
   * Serializes and writes one board.
   *
   * The scene is serialized *synchronously*, before the first `await`, so a
   * write always reflects the state it was handed even if the canvas has moved
   * on — or been swapped for another board — by the time the disk answers.
   */
  const writeScene = useCallback(async (scene: LiveScene) => {
    // Never resurrect a board the user has already deleted.
    if (!liveBoardIdsRef.current.has(scene.boardId)) return;

    let json: string;
    try {
      json = serializeScene(scene.elements, scene.appState, scene.files);
    } catch (error) {
      console.error("[whiteyboardy] could not serialize the board", error);
      return;
    }

    try {
      await saveBoardScene(scene.boardId, json);
      if (!liveBoardIdsRef.current.has(scene.boardId)) {
        // The board was deleted while this write was in flight, so clean up the
        // file we just recreated instead of leaving it orphaned on disk.
        await deleteBoardScene(scene.boardId).catch(() => {});
        return;
      }
      setBoards((previous) =>
        previous.map((board) =>
          board.id === scene.boardId ? { ...board, updatedAt: Date.now() } : board,
        ),
      );
    } catch (error) {
      console.error("[whiteyboardy] could not save the board", error);
    }
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      const scene = sceneRef.current;
      // A pending write must never leak into the board that replaced it.
      if (!scene || scene.boardId !== activeBoardIdRef.current) return;
      void writeScene(scene);
    }, AUTOSAVE_DELAY_MS);
  }, [writeScene]);

  const cancelAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  /**
   * Saves the board currently on screen right now, ignoring the debounce.
   *
   * This does not depend on a pending timer existing: board switches must never
   * lose edits the change listener has not reported yet.
   */
  const saveActiveBoardNow = useCallback(async () => {
    cancelAutosave();
    const scene = sceneRef.current;
    if (!scene) return;
    await writeScene(scene);
  }, [cancelAutosave, writeScene]);

  /** Keeps the dock in step with whatever the canvas is doing. */
  const syncDock = useCallback((appState: AppState) => {
    const active = appState.activeTool;
    // Our pen is a custom tool, so its id never arrives from Excalidraw.
    const tool: DockToolId =
      active.type === "custom"
        ? active.customType === PEN_CUSTOM_TYPE
          ? "pen"
          : "selection"
        : (active.type as DockToolId);
    if (tool !== activeToolIdRef.current) {
      activeToolIdRef.current = tool;
      setActiveToolId(tool);
    }

    // Selecting an element adopts its style, so the swatches always describe
    // what would be drawn (and what is selected).
    const color = colorNameFor(appState.currentItemStrokeColor);
    if (color && color !== strokeColorRef.current) {
      strokeColorRef.current = color;
      setStrokeColor(color);
    }

    const size = sizeNameFor(appState.currentItemStrokeWidth);
    if (size !== strokeSizeRef.current) {
      strokeSizeRef.current = size;
      setStrokeSize(size);
    }

    const nextFill = fillNameFor(
      appState.currentItemFillStyle,
      appState.currentItemBackgroundColor,
    );
    if (nextFill !== fillRef.current) {
      fillRef.current = nextFill;
      setFill(nextFill);
    }
  }, []);

  /** Everything Excalidraw reports: the scene, the styles, the camera. */
  const handleSceneChange = useCallback(
    (
      boardId: string,
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      sceneRef.current = { boardId, elements, appState, files };

      // Only a change to the *document* parks a write: panning and zooming
      // would otherwise re-serialize the board several times a second. The
      // camera still rides along with the next document change, and board
      // switches save unconditionally.
      const documentChanged =
        elements !== lastElementsRef.current || files !== lastFilesRef.current;
      lastElementsRef.current = elements;
      lastFilesRef.current = files;

      if (documentChanged) scheduleAutosave();
      syncDock(appState);
    },
    [scheduleAutosave, syncDock],
  );

  // --- Load the active board into the canvas -----------------------------
  useEffect(() => {
    if (!activeBoardId) return;

    // Whatever the previous board left pending is settled *before* the switch
    // (see `handleSelectBoard`); from here on the canvas belongs to the new one.
    cancelAutosave();
    sceneRef.current = null;
    lastElementsRef.current = null;
    lastFilesRef.current = null;

    let cancelled = false;
    setBoardLoading(true);

    void (async () => {
      try {
        const file = await loadBoardScene(activeBoardId);
        if (cancelled) return;
        const { initialData } = boardInitialData(file);
        setLoadedBoard({ boardId: activeBoardId, data: initialData });
      } catch (error) {
        console.error("[whiteyboardy] could not open the board", error);
        if (cancelled) return;
        showNotice({ kind: "error", text: "Could not open that board." });
        const { initialData } = boardInitialData(null);
        setLoadedBoard({ boardId: activeBoardId, data: initialData });
      } finally {
        if (!cancelled) setBoardLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeBoardId, cancelAutosave, showNotice]);

  // --- Best-effort save when the window goes away ------------------------
  useEffect(() => {
    const persist = () => {
      void saveActiveBoardNow();
    };
    const onVisibilityChange = () => {
      if (document.hidden) persist();
    };
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [saveActiveBoardNow]);

  // --- Global shortcuts ---------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isCropping) {
        event.preventDefault();
        event.stopPropagation();
        setIsCropping(false);
        return;
      }

      // Never steal keys from the inline rename inputs.
      if (isTypingTarget(event.target)) return;

      // An in-progress pen path owns Enter, Escape and the delete keys.
      if (pen.handleKeyDown(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // Tab is the Zen mode toggle, so keep it away from focus navigation.
        event.preventDefault();
        event.stopPropagation();
        setZenMode((zen) => !zen);
        return;
      }

      // The pen is not one of Excalidraw's tools, so its shortcut is ours to
      // handle. Every other tool letter is left to the engine.
      if (
        event.key.toLowerCase() === "n" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        api?.setActiveTool({ type: "custom", customType: PEN_CUSTOM_TYPE });
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        event.stopPropagation();
        setSidebarOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [api, isCropping, pen.handleKeyDown]);

  // --- Board actions ------------------------------------------------------
  const handleCreateBoard = useCallback(
    async (folderId: string | null) => {
      await saveActiveBoardNow();
      const board: BoardIndexEntry = {
        id: createBoardId(),
        name: `Board ${boards.length + 1}`,
        folderId,
        pinned: false,
        updatedAt: Date.now(),
      };
      setBoards((previous) => [...previous, board]);
      setActiveBoardId(board.id);
    },
    [boards.length, saveActiveBoardNow],
  );

  const handleSelectBoard = useCallback(
    async (boardId: string) => {
      if (boardId === activeBoardIdRef.current) return;
      // Make sure the board we are leaving is on disk before we swap the canvas.
      await saveActiveBoardNow();
      setActiveBoardId(boardId);
    },
    [saveActiveBoardNow],
  );

  const handleRenameBoard = useCallback((boardId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBoards((previous) =>
      previous.map((board) => (board.id === boardId ? { ...board, name: trimmed } : board)),
    );
  }, []);

  /** Moving a board into a folder takes it out of the pinned section. */
  const handleMoveBoard = useCallback((boardId: string, folderId: string | null) => {
    setBoards((previous) =>
      previous.map((board) =>
        board.id === boardId
          ? { ...board, folderId, pinned: folderId ? false : board.pinned }
          : board,
      ),
    );
  }, []);

  const handlePinBoard = useCallback((boardId: string, pinned: boolean) => {
    setBoards((previous) =>
      previous.map((board) => (board.id === boardId ? { ...board, pinned } : board)),
    );
  }, []);

  /**
   * Drag-and-drop reordering: the board is lifted next to `targetId` in the
   * library, and takes on the target's folder and pin state so it lands in the
   * same list the user dropped it into.
   */
  const handleReorderBoard = useCallback(
    (boardId: string, targetId: string, edge: "before" | "after") => {
      if (boardId === targetId) return;
      setBoards((previous) => {
        const moving = previous.find((board) => board.id === boardId);
        const target = previous.find((board) => board.id === targetId);
        if (!moving || !target) return previous;

        const reordered = previous.filter((board) => board.id !== boardId);
        const targetIndex = reordered.findIndex((board) => board.id === targetId);
        if (targetIndex === -1) return previous;

        const insertAt = edge === "before" ? targetIndex : targetIndex + 1;
        const moved: BoardIndexEntry = {
          ...moving,
          folderId: target.folderId,
          pinned: target.pinned,
        };
        return [...reordered.slice(0, insertAt), moved, ...reordered.slice(insertAt)];
      });
    },
    [],
  );

  const handleDeleteBoard = useCallback(
    async (boardId: string) => {
      if (boards.length <= 1) return;

      const board = boards.find((entry) => entry.id === boardId);
      const confirmed = await confirmDestructive(
        "Delete board",
        `Are you sure you want to delete “${board?.name ?? "this board"}”? This cannot be undone.`,
        "Delete",
      );
      if (!confirmed) return;

      if (boardId === activeBoardIdRef.current) cancelAutosave();

      const remaining = boards.filter((entry) => entry.id !== boardId);
      setBoards(remaining);

      void deleteBoardScene(boardId).catch((error) =>
        console.error("[whiteyboardy] could not delete the board file", error),
      );

      if (boardId === activeBoardIdRef.current) {
        const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (next) setActiveBoardId(next.id);
      }
    },
    [boards, cancelAutosave],
  );

  // --- Folder actions -----------------------------------------------------
  const handleCreateFolder = useCallback(
    (moveBoardId?: string) => {
      const folder: FolderEntry = {
        id: createFolderId(),
        name: "New folder",
        createdAt: Date.now(),
      };
      setFolders((previous) => [...previous, folder]);
      if (moveBoardId) handleMoveBoard(moveBoardId, folder.id);
    },
    [handleMoveBoard],
  );

  const handleRenameFolder = useCallback((folderId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFolders((previous) =>
      previous.map((folder) => (folder.id === folderId ? { ...folder, name: trimmed } : folder)),
    );
  }, []);

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      const folder = folders.find((entry) => entry.id === folderId);
      const count = boards.filter((board) => board.folderId === folderId).length;

      if (count > 0) {
        const confirmed = await confirmDestructive(
          "Delete folder",
          `Delete the folder “${folder?.name ?? "this folder"}”? Its ${count} ${
            count === 1 ? "board" : "boards"
          } will be kept and moved out of the folder.`,
          "Delete folder",
        );
        if (!confirmed) return;
      }

      setFolders((previous) => previous.filter((entry) => entry.id !== folderId));
      setBoards((previous) =>
        previous.map((board) =>
          board.folderId === folderId ? { ...board, folderId: null } : board,
        ),
      );
    },
    [folders, boards],
  );

  // --- Tools, colour, thickness and fill ---------------------------------
  /**
   * Applies a style change to the editor: it becomes the style of the *next*
   * shape drawn, and — when something is selected — is written onto the
   * selected elements too, as an undoable step.
   */
  const applyStyle = useCallback(
    (appStatePatch: Partial<AppState>, elementPatch: Partial<ExcalidrawElement>) => {
      if (!api) return;

      const state = api.getAppState();
      const selectedIds = new Set(
        Object.entries(state.selectedElementIds)
          .filter(([, selected]) => selected)
          .map(([id]) => id),
      );

      if (selectedIds.size === 0) {
        api.updateScene({
          appState: partialAppState(appStatePatch),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        return;
      }

      api.updateScene({
        elements: api
          .getSceneElements()
          .map((element) =>
            selectedIds.has(element.id)
              ? ({ ...element, ...elementPatch } as ExcalidrawElement)
              : element,
          ),
        appState: partialAppState(appStatePatch),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api],
  );

  const handleSelectTool = useCallback(
    (toolId: DockToolId) => {
      if (!api) return;
      api.setActiveTool({ type: toolId });
    },
    [api],
  );

  const handleSelectShape = useCallback(
    (nextShapeId: string) => {
      setShapeId(nextShapeId);
      if (!api) return;

      const option = findShapeOption(nextShapeId);
      if (option.tool) {
        // Excalidraw's own tools: drag on the canvas to set the size.
        api.setActiveTool({ type: option.tool });
        return;
      }

      // Generated shapes have no tool of their own, so they are placed at the
      // middle of the viewport, selected, ready to move and resize.
      insertGeneratedShape(
        api,
        option,
        { color: strokeColorRef.current, fill: fillRef.current, size: strokeSizeRef.current },
        viewportCentre(api),
      );
    },
    [api],
  );

  const handleSelectColor = useCallback(
    (color: BoardColorName) => {
      strokeColorRef.current = color;
      setStrokeColor(color);

      const hex = colorHex(color);
      // A filled shape keeps its fill in step with the stroke it is drawn in.
      const background = fillBackgroundFor(fillRef.current, color);
      applyStyle(
        {
          currentItemStrokeColor: hex,
          currentItemBackgroundColor: background,
        },
        {
          strokeColor: hex,
          ...(fillRef.current === "none" ? {} : { backgroundColor: background }),
        },
      );
    },
    [applyStyle],
  );

  const handleSelectSize = useCallback(
    (size: BoardSizeName) => {
      strokeSizeRef.current = size;
      setStrokeSize(size);

      const strokeWidth = strokeWidthFor(size);
      applyStyle({ currentItemStrokeWidth: strokeWidth }, { strokeWidth });
    },
    [applyStyle],
  );

  const handleSelectFill = useCallback(
    (nextFill: BoardFillName) => {
      fillRef.current = nextFill;
      setFill(nextFill);

      const background = fillBackgroundFor(nextFill, strokeColorRef.current);
      applyStyle(
        {
          currentItemFillStyle: nextFill === "none" ? "solid" : nextFill,
          currentItemBackgroundColor: background,
        },
        { fillStyle: nextFill === "none" ? "solid" : nextFill, backgroundColor: background },
      );
    },
    [applyStyle],
  );

  // --- Insert image -------------------------------------------------------
  const handleInsertImage = useCallback(async () => {
    if (!api) return;
    try {
      const count = await insertImagesFromDevice(api);
      if (count > 0) {
        showNotice({
          kind: "info",
          text: `Added ${count} image${count === 1 ? "" : "s"}.`,
        });
      }
    } catch (error) {
      console.error("[whiteyboardy] could not add images", error);
      showNotice({ kind: "error", text: "Could not add that image." });
    }
  }, [api, showNotice]);

  // --- Export -------------------------------------------------------------
  const runExport = useCallback(
    async (region?: { x: number; y: number; width: number; height: number }) => {
      if (!api || !activeBoard) return;

      setIsExporting(true);
      try {
        const outcome = await exportBoard({
          elements: api.getSceneElements(),
          files: api.getFiles(),
          appState: api.getAppState(),
          format: exportFormat,
          boardName: activeBoard.name,
          ...(region ? { region } : {}),
        });

        if (outcome.status === "cancelled") return;

        showNotice({
          kind: "info",
          text:
            outcome.status === "downloaded"
              ? `Downloaded ${outcome.fileName}`
              : `Exported ${outcome.fileName}`,
        });
      } catch (error) {
        if (error instanceof EmptyBoardError) {
          showNotice({ kind: "error", text: error.message });
          return;
        }
        console.error("[whiteyboardy] export failed", error);
        showNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "Export failed.",
        });
      } finally {
        setIsExporting(false);
      }
    },
    [api, activeBoard, exportFormat, showNotice],
  );

  const handleExportWholeBoard = useCallback(() => {
    void runExport();
  }, [runExport]);

  const handleCropComplete = useCallback(
    (rect: ScreenRect) => {
      setIsCropping(false);
      if (!api) return;

      // Screen → scene coordinates, then export exactly that region.
      const state = api.getAppState();
      const start = viewportCoordsToSceneCoords(
        { clientX: rect.x1, clientY: rect.y1 },
        state,
      );
      const end = viewportCoordsToSceneCoords(
        { clientX: rect.x2, clientY: rect.y2 },
        state,
      );

      void runExport({
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      });
    },
    [api, runExport],
  );

  const canvasReady = loadedBoard !== null && loadedBoard.boardId === activeBoardId;

  return (
    <div className="relative h-full w-full overflow-hidden bg-neutral-100">
      {/* Invisible strip that lets the user drag the overlay-titled window. */}
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 z-40 h-8" />

      <BoardSidebar
        folders={folders}
        boards={boards}
        activeBoardId={activeBoardId}
        open={sidebarOpen}
        width={SIDEBAR_WIDTH}
        onToggle={() => setSidebarOpen((open) => !open)}
        onSelect={handleSelectBoard}
        onCreateBoard={handleCreateBoard}
        onRenameBoard={handleRenameBoard}
        onDeleteBoard={handleDeleteBoard}
        onMoveBoard={handleMoveBoard}
        onPinBoard={handlePinBoard}
        onReorderBoard={handleReorderBoard}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
      />

      <main
        className="absolute inset-y-0 right-0 overflow-hidden transition-[left] duration-200 ease-out"
        style={{ left: sidebarOpen ? SIDEBAR_WIDTH : 0 }}
      >
        <div className="wb-canvas absolute inset-0">
          {loadedBoard && loadedBoard.boardId === activeBoardId && (
            <Excalidraw
              key={loadedBoard.boardId}
              initialData={loadedBoard.data}
              autoFocus
              // Our own chrome replaces Excalidraw's, so its shortcuts have to
              // keep working while one of our buttons holds focus.
              handleKeyboardGlobally
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                  saveAsImage: false,
                  export: false,
                  clearCanvas: false,
                  changeViewBackgroundColor: false,
                  toggleTheme: false,
                },
              }}
              excalidrawAPI={(next) => {
                setApi(next);
                if (import.meta.env.DEV) {
                  (
                    window as unknown as { __wbApi?: ExcalidrawImperativeAPI }
                  ).__wbApi = next;
                }
              }}
              onChange={(elements, appState, files) => {
                if (!canvasReady) return;
                handleSceneChange(loadedBoard.boardId, elements, appState, files);
              }}
            />
          )}
        </div>

        {boardLoading && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <span className="text-[12px] font-medium text-neutral-400">
              Opening board…
            </span>
          </div>
        )}
      </main>

      <ExportBar
        visible={!zenMode}
        format={exportFormat}
        isExporting={isExporting}
        isCropping={isCropping}
        onFormatChange={setExportFormat}
        onExportWholeBoard={handleExportWholeBoard}
        onExportSection={() => setIsCropping(true)}
        onCancelSection={() => setIsCropping(false)}
      />

      <ZoomHud visible={!zenMode} api={api} />

      <ToolDock
        visible={!zenMode}
        disabled={!api || !canvasReady}
        activeToolId={activeToolId}
        shapeId={shapeId}
        color={strokeColor}
        size={strokeSize}
        fill={fill}
        onSelectTool={handleSelectTool}
        onSelectShape={handleSelectShape}
        onSelectColor={handleSelectColor}
        onSelectSize={handleSelectSize}
        onSelectFill={handleSelectFill}
        onInsertImage={handleInsertImage}
        onToggle={() => setZenMode((zen) => !zen)}
      />

      {isCropping && <CropOverlay onComplete={handleCropComplete} />}

      {notice && <Toast notice={notice} />}

      {!libraryLoaded && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <span className="text-[12px] font-medium text-neutral-400">
            Loading your boards…
          </span>
        </div>
      )}
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
