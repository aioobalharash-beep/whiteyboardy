import { useState, type KeyboardEvent } from "react";
import { Layers, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";
import type { BoardIndexEntry } from "../lib/storage";

interface BoardSidebarProps {
  boards: BoardIndexEntry[];
  activeBoardId: string | null;
  open: boolean;
  /** Width in pixels, mirrored by the canvas inset so nothing hides under it. */
  width: number;
  onToggle: () => void;
  onSelect: (boardId: string) => void;
  onCreate: () => void;
  onRename: (boardId: string, name: string) => void;
  onDelete: (boardId: string) => void;
}

export function BoardSidebar({
  boards,
  activeBoardId,
  open,
  width,
  onToggle,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: BoardSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const beginRename = (board: BoardIndexEntry) => {
    setRenamingId(board.id);
    setDraftName(board.name);
  };

  const commitRename = () => {
    if (renamingId) onRename(renamingId, draftName);
    setRenamingId(null);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setRenamingId(null);
    }
  };

  const canDelete = boards.length > 1;

  return (
    <>
      <aside
        aria-hidden={!open}
        style={{ width, transform: open ? "translateX(0)" : `translateX(-${width}px)` }}
        className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-neutral-200/80 bg-white/85 backdrop-blur-xl transition-transform duration-200 ease-out"
      >
        <header className="flex items-center gap-2 px-4 pt-10 pb-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-neutral-900">
            <Layers className="h-4 w-4" aria-hidden />
            <span>WhiteyBoardy</span>
          </div>
          <button
            type="button"
            onClick={onToggle}
            title="Hide sidebar (⌘\)"
            aria-label="Hide sidebar"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex items-center justify-between px-4 pb-2">
          <span className="text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
            Boards
          </span>
          <button
            type="button"
            onClick={onCreate}
            title="New board"
            aria-label="New board"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <nav className="wb-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {boards.map((board) => {
            const isActive = board.id === activeBoardId;
            const isRenaming = board.id === renamingId;

            return (
              <div key={board.id} className="group relative">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={handleRenameKeyDown}
                    aria-label="Board name"
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 pr-8 text-[13px] text-neutral-900 outline-none focus:border-neutral-900/40 focus:ring-2 focus:ring-neutral-900/10"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(board.id)}
                    onDoubleClick={() => beginRename(board)}
                    title={`${board.name} — double-click to rename`}
                    className={`flex w-full items-center rounded-xl px-3 py-2 pr-8 text-left text-[13px] transition-colors ${
                      isActive
                        ? "bg-neutral-900 font-medium text-white"
                        : "text-neutral-700 hover:bg-neutral-900/5 hover:text-neutral-900"
                    }`}
                  >
                    <span className="truncate">{board.name}</span>
                  </button>
                )}

                {!isRenaming && canDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(board.id)}
                    title="Delete board"
                    aria-label={`Delete ${board.name}`}
                    className={`absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 ${
                      isActive
                        ? "text-white/70 hover:bg-white/15 hover:text-white"
                        : "text-neutral-400 hover:bg-neutral-900/5 hover:text-red-600"
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            );
          })}
        </nav>

        <footer className="border-t border-neutral-200/70 px-4 py-3 text-[11px] text-neutral-400">
          {boards.length} {boards.length === 1 ? "board" : "boards"} · stored on this Mac
        </footer>
      </aside>

      {!open && (
        <button
          type="button"
          onClick={onToggle}
          title="Show sidebar (⌘\)"
          aria-label="Show sidebar"
          className="wb-animate-in fixed top-10 left-3 z-30 flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200/80 bg-white/85 text-neutral-600 shadow-sm backdrop-blur-xl transition-colors hover:bg-white hover:text-neutral-900"
        >
          <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
        </button>
      )}
    </>
  );
}
