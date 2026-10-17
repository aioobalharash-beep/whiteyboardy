import { useState, type KeyboardEvent } from "react";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Layers,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from "lucide-react";
import type { BoardIndexEntry, FolderEntry } from "../lib/storage";

interface BoardSidebarProps {
  folders: FolderEntry[];
  boards: BoardIndexEntry[];
  activeBoardId: string | null;
  open: boolean;
  /** Width in pixels, mirrored by the canvas inset so nothing hides under it. */
  width: number;
  onToggle: () => void;
  onSelect: (boardId: string) => void;
  onCreateBoard: (folderId: string | null) => void;
  onRenameBoard: (boardId: string, name: string) => void;
  onDeleteBoard: (boardId: string) => void;
  onMoveBoard: (boardId: string, folderId: string | null) => void;
  onCreateFolder: () => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
}

export function BoardSidebar({
  folders,
  boards,
  activeBoardId,
  open,
  width,
  onToggle,
  onSelect,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onMoveBoard,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: BoardSidebarProps) {
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menuBoardId, setMenuBoardId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const isCollapsed = (folderId: string) => collapsed.includes(folderId);
  const toggleFolder = (folderId: string) =>
    setCollapsed((previous) =>
      previous.includes(folderId)
        ? previous.filter((id) => id !== folderId)
        : [...previous, folderId],
    );

  const beginBoardRename = (board: BoardIndexEntry) => {
    setMenuBoardId(null);
    setRenamingBoardId(board.id);
    setDraft(board.name);
  };

  const beginFolderRename = (folder: FolderEntry) => {
    setRenamingFolderId(folder.id);
    setDraft(folder.name);
  };

  const commitBoardRename = () => {
    if (renamingBoardId) onRenameBoard(renamingBoardId, draft);
    setRenamingBoardId(null);
  };

  const commitFolderRename = () => {
    if (renamingFolderId) onRenameFolder(renamingFolderId, draft);
    setRenamingFolderId(null);
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setRenamingBoardId(null);
      setRenamingFolderId(null);
    }
  };

  const canDeleteBoard = boards.length > 1;

  const renderBoard = (board: BoardIndexEntry, nested: boolean) => {
    const isActive = board.id === activeBoardId;
    const isRenaming = board.id === renamingBoardId;
    const menuOpen = menuBoardId === board.id;

    return (
      <div key={board.id} className="group relative">
        {isRenaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitBoardRename}
            onKeyDown={handleRenameKeyDown}
            aria-label="Board name"
            className={`w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none focus:border-neutral-900/40 focus:ring-2 focus:ring-neutral-900/10 ${
              nested ? "pl-6" : ""
            }`}
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelect(board.id)}
            onDoubleClick={() => beginBoardRename(board)}
            title={`${board.name} — double-click to rename`}
            className={`flex w-full items-center rounded-xl py-2 pr-14 text-left text-[13px] transition-colors ${
              nested ? "pl-6" : "pl-3"
            } ${
              isActive
                ? "bg-neutral-900 font-medium text-white"
                : "text-neutral-700 hover:bg-neutral-900/5 hover:text-neutral-900"
            }`}
          >
            <span className="truncate">{board.name}</span>
          </button>
        )}

        {!isRenaming && (
          <div
            className={`absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 transition-opacity ${
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
            }`}
          >
            <button
              type="button"
              onClick={() => setMenuBoardId(menuOpen ? null : board.id)}
              title="Move to folder"
              aria-label={`Organise ${board.name}`}
              aria-expanded={menuOpen}
              className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${
                isActive
                  ? "text-white/70 hover:bg-white/15 hover:text-white"
                  : "text-neutral-400 hover:bg-neutral-900/5 hover:text-neutral-900"
              }`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
            </button>

            {canDeleteBoard && (
              <button
                type="button"
                onClick={() => onDeleteBoard(board.id)}
                title="Delete board"
                aria-label={`Delete ${board.name}`}
                className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${
                  isActive
                    ? "text-white/70 hover:bg-white/15 hover:text-white"
                    : "text-neutral-400 hover:bg-neutral-900/5 hover:text-red-600"
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        )}

        {menuOpen && (
          <div className="wb-animate-in mx-1 mb-1 rounded-xl border border-neutral-200/80 bg-neutral-50/80 p-1">
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wider text-neutral-400 uppercase">
              Move to
            </div>
            {folders.length === 0 && (
              <div className="px-2 pb-1 text-[11px] text-neutral-400">
                No folders yet
              </div>
            )}
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                disabled={board.folderId === folder.id}
                onClick={() => {
                  onMoveBoard(board.id, folder.id);
                  setMenuBoardId(null);
                }}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-neutral-700 transition-colors hover:bg-neutral-900/5 disabled:text-neutral-400 disabled:hover:bg-transparent"
              >
                <Folder className="h-3.5 w-3.5" aria-hidden />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                onCreateFolder();
                setMenuBoardId(null);
              }}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-neutral-700 transition-colors hover:bg-neutral-900/5"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              New folder…
            </button>
            {board.folderId && (
              <button
                type="button"
                onClick={() => {
                  onMoveBoard(board.id, null);
                  setMenuBoardId(null);
                }}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-neutral-700 transition-colors hover:bg-neutral-900/5"
              >
                <Layers className="h-3.5 w-3.5" aria-hidden />
                Remove from folder
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const unfiledBoards = boards.filter((board) => !board.folderId);

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
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onCreateFolder}
              title="New folder"
              aria-label="New folder"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
            >
              <FolderPlus className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onCreateBoard(null)}
              title="New board"
              aria-label="New board"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        <nav className="wb-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {folders.map((folder) => {
            const folderBoards = boards.filter((board) => board.folderId === folder.id);
            const folded = isCollapsed(folder.id);
            const isRenaming = folder.id === renamingFolderId;

            return (
              <div key={folder.id} className="group/folder">
                <div className="relative">
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={commitFolderRename}
                      onKeyDown={handleRenameKeyDown}
                      aria-label="Folder name"
                      className="w-full rounded-xl border border-neutral-300 bg-white py-1.5 pr-12 pl-7 text-[12px] font-medium text-neutral-900 outline-none focus:border-neutral-900/40 focus:ring-2 focus:ring-neutral-900/10"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder.id)}
                      onDoubleClick={() => beginFolderRename(folder)}
                      title={`${folder.name} — double-click to rename`}
                      className="flex w-full items-center gap-1 rounded-xl py-1.5 pr-14 pl-1.5 text-left text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                          folded ? "" : "rotate-90"
                        }`}
                        aria-hidden
                      />
                      <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{folder.name}</span>
                      <span className="ml-1 shrink-0 text-[10px] text-neutral-400">
                        {folderBoards.length}
                      </span>
                    </button>
                  )}

                  {!isRenaming && (
                    <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/folder:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => onCreateBoard(folder.id)}
                        title={`New board in ${folder.name}`}
                        aria-label={`New board in ${folder.name}`}
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteFolder(folder.id)}
                        title={`Delete ${folder.name}`}
                        aria-label={`Delete folder ${folder.name}`}
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-900/5 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>

                {!folded && (
                  <div className="space-y-0.5">
                    {folderBoards.length === 0 ? (
                      <p className="py-1 pr-2 pl-7 text-[11px] text-neutral-400">
                        Empty folder
                      </p>
                    ) : (
                      folderBoards.map((board) => renderBoard(board, true))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {folders.length > 0 && unfiledBoards.length > 0 && (
            <div className="px-2 pt-2 pb-0.5 text-[10px] font-medium tracking-wider text-neutral-400 uppercase">
              Unfiled
            </div>
          )}

          {unfiledBoards.map((board) => renderBoard(board, folders.length > 0))}
        </nav>

        <footer className="border-t border-neutral-200/70 px-4 py-3 text-[11px] text-neutral-400">
          {boards.length} {boards.length === 1 ? "board" : "boards"}
          {folders.length > 0
            ? ` · ${folders.length} ${folders.length === 1 ? "folder" : "folders"}`
            : ""}{" "}
          · stored on this Mac
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
