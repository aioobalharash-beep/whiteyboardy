import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  DefaultColorStyle,
  DefaultSizeStyle,
  GeoShapeGeoStyle,
  getSnapshot,
  loadSnapshot,
  Tldraw,
  type Editor,
} from "tldraw";
import { BoardSidebar } from "./components/BoardSidebar";
import { CropOverlay, type ScreenRect } from "./components/CropOverlay";
import { ExportBar } from "./components/ExportBar";
import { Toast, type Notice } from "./components/Toast";
import { ToolDock } from "./components/ToolDock";
import {
  EmptyBoardError,
  exportBoard,
  type ExportFormat,
} from "./lib/export";
import type { BoardColorName, BoardSizeName } from "./lib/palette";
import {
  createBoardId,
  deleteBoardSnapshot,
  loadBoardIndex,
  loadBoardSnapshot,
  saveBoardIndex,
  saveBoardSnapshot,
  type BoardIndexEntry,
  type BoardSnapshot,
} from "./lib/storage";

/** Width of the collapsible sidebar, mirrored by the canvas inset. */
const SIDEBAR_WIDTH = 256;
/** Debounce window for writing a board snapshot to disk. */
const AUTOSAVE_DELAY_MS = 500;
/** Debounce window for writing the board index to disk. */
const INDEX_SAVE_DELAY_MS = 300;

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

export default function App() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [boards, setBoards] = useState<BoardIndexEntry[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [indexLoaded, setIndexLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zenMode, setZenMode] = useState(false);
  const [activeToolId, setActiveToolId] = useState("select");
  const [strokeColor, setStrokeColor] = useState<BoardColorName>("black");
  const [strokeSize, setStrokeSize] = useState<BoardSizeName>("m");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [isCropping, setIsCropping] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const activeBoardIdRef = useRef<string | null>(null);
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

  // Keep a ref in sync so the autosave listener (registered once per editor)
  // always writes to the board that is currently on screen.
  useEffect(() => {
    activeBoardIdRef.current = activeBoardId;
  }, [activeBoardId]);

  // --- Initial board index ------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        let index = await loadBoardIndex();
        if (index.length === 0) {
          index = [{ id: createBoardId(), name: "Untitled board", updatedAt: Date.now() }];
          await saveBoardIndex(index);
        }
        if (cancelled) return;

        const mostRecent = [...index].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setBoards(index);
        setActiveBoardId(mostRecent.id);
      } catch (error) {
        console.error("[whiteyboardy] could not load the board index", error);
        if (!cancelled) {
          setBoards([{ id: createBoardId(), name: "Untitled board", updatedAt: Date.now() }]);
        }
      } finally {
        if (!cancelled) setIndexLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Persist the board index -------------------------------------------
  useEffect(() => {
    if (!indexLoaded) return;
    const timer = window.setTimeout(() => {
      void saveBoardIndex(boards).catch((error) =>
        console.error("[whiteyboardy] could not save the board index", error),
      );
    }, INDEX_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [boards, indexLoaded]);

  // --- Debounced autosave of the active board ----------------------------
  useEffect(() => {
    if (!editor) return;

    let timer: number | null = null;

    const persist = () => {
      timer = null;
      const boardId = activeBoardIdRef.current;
      if (!boardId) return;

      let snapshot: BoardSnapshot;
      try {
        snapshot = getSnapshot(editor.store);
      } catch (error) {
        console.error("[whiteyboardy] could not snapshot the board", error);
        return;
      }

      void saveBoardSnapshot(boardId, snapshot)
        .then(() =>
          setBoards((previous) =>
            previous.map((board) =>
              board.id === boardId ? { ...board, updatedAt: Date.now() } : board,
            ),
          ),
        )
        .catch((error) => console.error("[whiteyboardy] autosave failed", error));
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
  }, [editor]);

  // --- Load the active board into the canvas -----------------------------
  useEffect(() => {
    if (!editor || !activeBoardId) return;
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
      } catch (error) {
        console.error("[whiteyboardy] could not open the board", error);
        if (!cancelled) showNotice({ kind: "error", text: "Could not open that board." });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, activeBoardId, showNotice]);

  // --- Mirror the editor's active tool into the dock ---------------------
  useEffect(() => {
    if (!editor) return;
    const sync = () => setActiveToolId(editor.getCurrentToolId());
    sync();
    return editor.store.listen(sync, { scope: "session", source: "all" });
  }, [editor]);

  // --- Global shortcuts ---------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isCropping) {
        event.preventDefault();
        event.stopPropagation();
        setIsCropping(false);
        return;
      }

      // Never steal keys from the inline board-rename input.
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
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isCropping]);

  // --- Board actions ------------------------------------------------------
  const handleCreateBoard = useCallback(() => {
    autosaveRef.current.flush();
    const board: BoardIndexEntry = {
      id: createBoardId(),
      name: `Board ${boards.length + 1}`,
      updatedAt: Date.now(),
    };
    setBoards((previous) => [...previous, board]);
    setActiveBoardId(board.id);
  }, [boards.length]);

  const handleSelectBoard = useCallback((boardId: string) => {
    if (boardId === activeBoardIdRef.current) return;
    // Make sure the board we are leaving is on disk before we swap the canvas.
    autosaveRef.current.flush();
    setActiveBoardId(boardId);
  }, []);

  const handleRenameBoard = useCallback((boardId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBoards((previous) =>
      previous.map((board) => (board.id === boardId ? { ...board, name: trimmed } : board)),
    );
  }, []);

  const handleDeleteBoard = useCallback(
    (boardId: string) => {
      if (boards.length <= 1) return;

      const isActiveBoard = boardId === activeBoardIdRef.current;
      if (isActiveBoard) autosaveRef.current.cancel();

      const remaining = boards.filter((board) => board.id !== boardId);
      setBoards(remaining);

      void deleteBoardSnapshot(boardId).catch((error) =>
        console.error("[whiteyboardy] could not delete the board file", error),
      );

      if (isActiveBoard) {
        const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setActiveBoardId(next.id);
      }
    },
    [boards],
  );

  // --- Tools, colour and thickness ---------------------------------------
  const handleSelectTool = useCallback(
    (toolId: string) => {
      if (!editor) return;
      if (toolId === "geo") {
        editor.setStyleForNextShapes(GeoShapeGeoStyle, "rectangle");
      }
      editor.setCurrentTool(toolId);
      // Keep keyboard shortcuts alive after clicking our own chrome.
      editor.focus();
    },
    [editor],
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
        boards={boards}
        activeBoardId={activeBoardId}
        open={sidebarOpen}
        width={SIDEBAR_WIDTH}
        onToggle={() => setSidebarOpen((open) => !open)}
        onSelect={handleSelectBoard}
        onCreate={handleCreateBoard}
        onRename={handleRenameBoard}
        onDelete={handleDeleteBoard}
      />

      <main
        className="absolute inset-y-0 right-0 overflow-hidden transition-[left] duration-200 ease-out"
        style={{ left: sidebarOpen ? SIDEBAR_WIDTH : 0 }}
      >
        <Tldraw hideUi autoFocus onMount={setEditor} />
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

      <ToolDock
        visible={!zenMode}
        activeToolId={activeToolId}
        color={strokeColor}
        size={strokeSize}
        onSelectTool={handleSelectTool}
        onSelectColor={handleSelectColor}
        onSelectSize={handleSelectSize}
        onToggle={() => setZenMode((zen) => !zen)}
      />

      {isCropping && <CropOverlay onComplete={handleCropComplete} />}

      {notice && <Toast notice={notice} />}

      {!indexLoaded && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
          <span className="text-[12px] font-medium text-neutral-400">
            Loading your boards…
          </span>
        </div>
      )}
    </div>
  );
}
