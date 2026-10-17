import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import {
  Box,
  DefaultColorStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  getSnapshot,
  loadSnapshot,
  Tldraw,
  type Editor,
  type TLDefaultFillStyle,
} from "tldraw";
import { BoardSidebar } from "./components/BoardSidebar";
import { CropOverlay, type ScreenRect } from "./components/CropOverlay";
import { ExportBar } from "./components/ExportBar";
import { LicenseNotice } from "./components/LicenseNotice";import { Toast, type Notice } from "./components/Toast";
import { ToolDock } from "./components/ToolDock";
import { ZoomHud } from "./components/ZoomHud";
import {
  EmptyBoardError,
  exportBoard,
  type ExportFormat,
} from "./lib/export";
import { insertImagesFromDevice } from "./lib/insert";
import {
  TLDRAW_LICENSE_KEY,
  useEditorLicenseGate,
  willEditorBeGated,
} from "./lib/license";
import type { BoardColorName, BoardSizeName } from "./lib/palette";
import { findShapeOption, insertGeneratedShape } from "./lib/shapes";
import { insertTable, tableShapeUtils } from "./shapes/TableShape";
import { PEN_TOOL_ID, penConfig, penTools, type PenSpline } from "./tools/PenTool";
import {
  createBoardId,
  createFolderId,
  deleteBoardSnapshot,
  isTauriRuntime,
  loadBoardSnapshot,
  loadLibrary,
  saveBoardSnapshot,
  saveLibrary,
  storageStatus,
  type BoardIndexEntry,
  type BoardSnapshot,
  type FolderEntry,
} from "./lib/storage";

/** Width of the collapsible sidebar, mirrored by the canvas inset. */
const SIDEBAR_WIDTH = 256;
/** Debounce window for writing a board snapshot to disk. */
const AUTOSAVE_DELAY_MS = 500;
/** Debounce window for writing the board library to disk. */
const INDEX_SAVE_DELAY_MS = 300;

/**
 * Single-key shortcuts for the tools in the dock. tldraw's own shortcuts are
 * bound by its UI, which this app hides, so we route them ourselves.
 */
const TOOL_SHORTCUTS: Record<string, string> = {
  v: "select",
  d: "draw",
  p: PEN_TOOL_ID,
  e: "eraser",
  a: "arrow",
  t: "text",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** Clears the canvas for a board that has no saved snapshot yet. */
function resetBoard(editor: Editor): void {
  const shapeIds = [...editor.getCurrentPageShapeIds()];
  if (shapeIds.length > 0) editor.deleteShapes(shapeIds);
  editor.setCurrentTool("select");
  editor.setCamera({ x: 0, y: 0, z: 1 });
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
  const [rawEditor, setRawEditor] = useState<Editor | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [boards, setBoards] = useState<BoardIndexEntry[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [activeToolId, setActiveToolId] = useState("select");
  const [shapeId, setShapeId] = useState("rectangle");
  const [strokeColor, setStrokeColor] = useState<BoardColorName>("black");
  const [strokeSize, setStrokeSize] = useState<BoardSizeName>("m");
  const [fill, setFill] = useState<TLDefaultFillStyle>("none");
  const [penSpline, setPenSpline] = useState<PenSpline>("line");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [isCropping, setIsCropping] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  /**
   * A production build without a tldraw licence key loses its editor to
   * tldraw's licence gate a few seconds after launch. Treat that as "no editor"
   * so every tool, HUD and handler fails softly instead of writing to a canvas
   * that no longer exists.
   */
  const licenseGated = useEditorLicenseGate();
  const licenseWillGate = willEditorBeGated();
  const editor = licenseGated ? null : rawEditor;

  const activeBoardIdRef = useRef<string | null>(null);
  /** Board ids that still exist in the library; snapshots are never written for others. */
  const liveBoardIdsRef = useRef<Set<string>>(new Set());
  const autosaveRef = useRef<{ flush: () => void; cancel: () => void }>({
    flush: () => {},
    cancel: () => {},
  });
  const noticeTimerRef = useRef<number | null>(null);

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
   * Snapshots the canvas *synchronously* and writes it to `boardId`.
   *
   * Capturing the snapshot before the first `await` is what makes this safe to
   * call from a board switch: it always reflects the outgoing board's state,
   * even if the change listener has not fired yet.
   */
  const writeBoardSnapshot = useCallback(
    async (boardId: string) => {
      if (!editor) return;
      // Never resurrect a board the user has already deleted.
      if (!liveBoardIdsRef.current.has(boardId)) return;

      let snapshot: BoardSnapshot;
      try {
        snapshot = getSnapshot(editor.store);
      } catch (error) {
        console.error("[whiteyboardy] could not snapshot the board", error);
        return;
      }

      try {
        await saveBoardSnapshot(boardId, snapshot);
        if (!liveBoardIdsRef.current.has(boardId)) {
          // The board was deleted while this write was in flight, so clean up the
          // file we just recreated instead of leaving it orphaned on disk.
          await deleteBoardSnapshot(boardId).catch(() => {});
          return;
        }
        setBoards((previous) =>
          previous.map((board) =>
            board.id === boardId ? { ...board, updatedAt: Date.now() } : board,
          ),
        );
      } catch (error) {
        console.error("[whiteyboardy] could not save the board", error);
      }
    },
    [editor],
  );

  // --- Debounced autosave of the active board ----------------------------
  useEffect(() => {
    if (!editor) return;

    let timer: number | null = null;

    const persist = () => {
      timer = null;
      const boardId = activeBoardIdRef.current;
      if (!boardId) return;
      void writeBoardSnapshot(boardId);
    };

    const flush = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
        persist();
      }
    };

    const cancel = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    autosaveRef.current = { flush, cancel };

    // Every stroke and shape change on the document is written out, debounced.
    const stopListening = editor.store.listen(
      () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(persist, AUTOSAVE_DELAY_MS);
      },
      { scope: "document", source: "user" },
    );

    return () => {
      stopListening();
      cancel();
      autosaveRef.current = { flush: () => {}, cancel: () => {} };
    };
  }, [editor, writeBoardSnapshot]);

  /**
   * Saves the board currently on screen right now, ignoring the debounce.
   *
   * This does not depend on a pending timer existing: board switches must never
   * lose edits that the store listener has not yet reported.
   */
  const saveActiveBoardNow = useCallback(async () => {
    const boardId = activeBoardIdRef.current;
    if (!boardId) return;
    autosaveRef.current.cancel();
    await writeBoardSnapshot(boardId);
  }, [writeBoardSnapshot]);

  // --- Load the active board into the canvas -----------------------------
  useEffect(() => {
    if (!editor || !activeBoardId) return;

    // Drop anything the previous board left pending so it can never be written
    // into the board we are about to open.
    autosaveRef.current.cancel();

    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await loadBoardSnapshot(activeBoardId);
        if (cancelled) return;
        if (snapshot) {
          loadSnapshot(editor.store, snapshot);
        } else {
          resetBoard(editor);
        }
        // The load itself is a document change; ignore it for autosave purposes.
        autosaveRef.current.cancel();
      } catch (error) {
        console.error("[whiteyboardy] could not open the board", error);
        if (!cancelled) showNotice({ kind: "error", text: "Could not open that board." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, activeBoardId, showNotice]);

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

  // --- Mirror the editor's active tool into the dock ---------------------
  useEffect(() => {
    if (!editor) return;
    const sync = () => setActiveToolId(editor.getCurrentToolId());
    sync();
    return editor.store.listen(sync, { scope: "session", source: "all" });
  }, [editor]);

  // --- Keep the pen tool's segment style in sync with the dock -----------
  useEffect(() => {
    penConfig.spline = penSpline;
  }, [penSpline]);

  // --- Global shortcuts ---------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isCropping) {
        event.preventDefault();
        event.stopPropagation();
        setIsCropping(false);
        return;
      }

      // Never steal keys from the inline rename inputs or table cells.
      if (isTypingTarget(event.target)) return;

      if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        // Tab is the Zen mode toggle, so keep it away from tldraw's focus nav.
        event.preventDefault();
        event.stopPropagation();
        setZenMode((zen) => !zen);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        event.stopPropagation();
        setSidebarOpen((open) => !open);
        return;
      }

      if (!editor) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const toolId = TOOL_SHORTCUTS[event.key.toLowerCase()];
      if (toolId) {
        event.preventDefault();
        editor.setCurrentTool(toolId);
        editor.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isCropping, editor]);

  // --- Board actions ------------------------------------------------------
  /**
   * Drops a half-drawn pen path before the canvas is replaced, so the outgoing
   * board is snapshotted without the trailing rubber-band point.
   */
  const settleTransientTool = useCallback(() => {
    if (editor?.getCurrentToolId() === PEN_TOOL_ID) editor.setCurrentTool("select");
  }, [editor]);

  const handleCreateBoard = useCallback(
    async (folderId: string | null) => {
      settleTransientTool();
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
    [boards.length, saveActiveBoardNow, settleTransientTool],
  );

  const handleSelectBoard = useCallback(
    async (boardId: string) => {
      if (boardId === activeBoardIdRef.current) return;
      settleTransientTool();
      // Make sure the board we are leaving is on disk before we swap the canvas.
      await saveActiveBoardNow();
      setActiveBoardId(boardId);
    },
    [saveActiveBoardNow, settleTransientTool],
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

      const isActiveBoard = boardId === activeBoardIdRef.current;
      if (isActiveBoard) {
        autosaveRef.current.cancel();
        settleTransientTool();
      }

      const remaining = boards.filter((entry) => entry.id !== boardId);
      setBoards(remaining);

      void deleteBoardSnapshot(boardId).catch((error) =>
        console.error("[whiteyboardy] could not delete the board file", error),
      );

      if (isActiveBoard) {
        const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (next) setActiveBoardId(next.id);
      }
    },
    [boards, settleTransientTool],
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
  const handleSelectTool = useCallback(
    (toolId: string) => {
      if (!editor) return;
      editor.setCurrentTool(toolId);
      // Keep keyboard shortcuts alive after clicking our own chrome.
      editor.focus();
    },
    [editor],
  );

  const styleForNewShapes = useMemo(
    () => ({ color: strokeColor, fill, size: strokeSize }),
    [strokeColor, fill, strokeSize],
  );

  const handleSelectShape = useCallback(
    (nextShapeId: string) => {
      setShapeId(nextShapeId);
      if (!editor) return;

      const option = findShapeOption(nextShapeId);
      if (option.geo) {
        // Built-in geo shapes: arm tldraw's own tool so you drag out the size.
        editor.setStyleForNextShapes(GeoShapeGeoStyle, option.geo);
        editor.setCurrentTool("geo");
      } else {
        // Generated shapes have no tldraw tool, so place them at the viewport
        // centre and select them, ready to move and resize.
        insertGeneratedShape(
          editor,
          option,
          styleForNewShapes,
          editor.getViewportPageBounds().center,
        );
      }
      editor.focus();
    },
    [editor, styleForNewShapes],
  );

  const handleSelectColor = useCallback(
    (color: BoardColorName) => {
      setStrokeColor(color);
      if (!editor) return;
      editor.setStyleForNextShapes(DefaultColorStyle, color);
      if (editor.getSelectedShapeIds().length > 0) {
        editor.setStyleForSelectedShapes(DefaultColorStyle, color);
      }
    },
    [editor],
  );

  const handleSelectSize = useCallback(
    (size: BoardSizeName) => {
      setStrokeSize(size);
      if (!editor) return;
      editor.setStyleForNextShapes(DefaultSizeStyle, size);
      if (editor.getSelectedShapeIds().length > 0) {
        editor.setStyleForSelectedShapes(DefaultSizeStyle, size);
      }
    },
    [editor],
  );

  const handleSelectFill = useCallback(
    (nextFill: TLDefaultFillStyle) => {
      setFill(nextFill);
      if (!editor) return;
      editor.setStyleForNextShapes(DefaultFillStyle, nextFill);
      if (editor.getSelectedShapeIds().length > 0) {
        editor.setStyleForSelectedShapes(DefaultFillStyle, nextFill);
      }
    },
    [editor],
  );

  const handleSelectPenSpline = useCallback(
    (spline: PenSpline) => {
      setPenSpline(spline);
      penConfig.spline = spline;
      if (!editor) return;

      // Retune any selected paths so the choice is visible straight away.
      const selectedLines = editor
        .getSelectedShapeIds()
        .filter((shapeId) => editor.getShape(shapeId)?.type === "line");
      if (selectedLines.length > 0) {
        editor.updateShapes(
          selectedLines.map((shapeId) => ({ id: shapeId, type: "line" as const, props: { spline } })),
        );
      }
    },
    [editor],
  );

  // --- Insert image / table ----------------------------------------------
  const handleInsertImage = useCallback(async () => {
    if (!editor) return;
    try {
      const count = await insertImagesFromDevice(editor);
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
  }, [editor, showNotice]);

  const handleInsertTable = useCallback(() => {
    if (!editor) return;
    insertTable(editor, editor.getViewportPageBounds().center, styleForNewShapes);
    editor.focus();
  }, [editor, styleForNewShapes]);

  // --- Export -------------------------------------------------------------
  const runExport = useCallback(
    async (bounds?: Box) => {
      if (!editor || !activeBoard) return;

      setIsExporting(true);
      try {
        const outcome = await exportBoard({
          editor,
          format: exportFormat,
          boardName: activeBoard.name,
          bounds,
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
    [editor, activeBoard, exportFormat, showNotice],
  );

  const handleExportWholeBoard = useCallback(() => {
    void runExport();
  }, [runExport]);

  const handleCropComplete = useCallback(
    (rect: ScreenRect) => {
      setIsCropping(false);
      if (!editor) return;

      // Screen → page coordinates, then export exactly that region.
      const start = editor.screenToPage({ x: rect.x1, y: rect.y1 });
      const end = editor.screenToPage({ x: rect.x2, y: rect.y2 });
      const bounds = new Box(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y),
      );

      void runExport(bounds);
    },
    [editor, runExport],
  );

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
        <Tldraw
          hideUi
          autoFocus
          licenseKey={TLDRAW_LICENSE_KEY}
          shapeUtils={tableShapeUtils}
          tools={penTools}
          onMount={(next) => {
            setRawEditor(next);
            // TEMPORARY SELFTEST — remove with src/lib/selftest.ts
            void runSelfTest(next);
            if (import.meta.env.DEV) {
              (window as unknown as { __wbEditor?: Editor }).__wbEditor = next;
            }
          }}
        />

        <LicenseNotice gated={licenseGated} willGate={licenseWillGate} />
      </main>

      <ExportBar
        visible={!zenMode && !licenseGated}
        format={exportFormat}
        isExporting={isExporting}
        isCropping={isCropping}
        onFormatChange={setExportFormat}
        onExportWholeBoard={handleExportWholeBoard}
        onExportSection={() => setIsCropping(true)}
        onCancelSection={() => setIsCropping(false)}
      />

      <ZoomHud visible={!zenMode} editor={editor} />

      <ToolDock
        visible={!zenMode}
        disabled={!editor}
        activeToolId={activeToolId}
        shapeId={shapeId}
        color={strokeColor}
        size={strokeSize}
        fill={fill}
        penSpline={penSpline}
        onSelectTool={handleSelectTool}
        onSelectShape={handleSelectShape}
        onSelectColor={handleSelectColor}
        onSelectSize={handleSelectSize}
        onSelectFill={handleSelectFill}
        onSelectPenSpline={handleSelectPenSpline}
        onInsertImage={handleInsertImage}
        onInsertTable={handleInsertTable}
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
