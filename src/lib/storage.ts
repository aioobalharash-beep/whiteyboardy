import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { TLEditorSnapshot } from "tldraw";

/**
 * Everything tldraw needs to restore a board: the serialized document plus the
 * session state (camera, current page, …).
 */
export type BoardSnapshot = TLEditorSnapshot;

/** A single board inside the library. */
export interface BoardIndexEntry {
  id: string;
  name: string;
  /** `null` for a board that lives at the top level (not in a folder). */
  folderId: string | null;
  /** Pinned boards are listed in their own section at the top of the sidebar. */
  pinned: boolean;
  updatedAt: number;
}

/** A folder used to group boards. */
export interface FolderEntry {
  id: string;
  name: string;
  createdAt: number;
}

/** The whole board library: folders plus the boards they organise. */
export interface BoardLibrary {
  folders: FolderEntry[];
  boards: BoardIndexEntry[];
}

/**
 * All board data lives in the app data directory:
 *
 *   ~/Library/Application Support/com.whiteyboardy.app/
 *     ├── boards-index.json
 *     ├── board-<id>.json
 *     └── …
 *
 * When the app runs in a plain browser (`vite dev` preview) the same data is
 * mirrored into `localStorage` so the UI stays fully functional.
 */
const APP_DATA_DIR = BaseDirectory.AppData;
const INDEX_FILE_NAME = "boards-index.json";
const INDEX_STORAGE_KEY = "whiteyboardy.boards-index";

/** Bumped whenever the on-disk shape of `boards-index.json` changes. */
const LIBRARY_VERSION = 2;

const boardFileName = (boardId: string) => `board-${boardId}.json`;
const boardStorageKey = (boardId: string) => `whiteyboardy.board.${boardId}`;

/** Whether we are running inside the Tauri webview rather than a browser tab. */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      "undefined"
  );
}

let appDataDirReady: Promise<void> | null = null;

/**
 * The app data directory is not created for us, so make sure it exists before
 * the first write. `"."` resolves to the directory itself and is covered by the
 * default `mkdir` scope for the application directories.
 */
function ensureAppDataDir(): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  if (!appDataDirReady) {
    appDataDirReady = mkdir(".", { baseDir: APP_DATA_DIR, recursive: true }).catch(
      () => undefined,
    );
  }
  return appDataDirReady;
}

/** Stable, collision-free id for a new board or folder. */
export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const createBoardId = createId;
export const createFolderId = createId;

function isFolderEntry(value: unknown): value is FolderEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FolderEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "number"
  );
}

/**
 * Normalises a board entry, defaulting everything a legacy (v1) file may omit
 * and dropping any folder reference that no longer exists.
 */
function normaliseBoard(value: unknown, folderIds: Set<string>): BoardIndexEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as {
    id?: unknown;
    name?: unknown;
    folderId?: unknown;
    updatedAt?: unknown;
  };
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
    return null;
  }
  const folderId =
    typeof candidate.folderId === "string" && folderIds.has(candidate.folderId)
      ? candidate.folderId
      : null;
  return {
    id: candidate.id,
    name: candidate.name,
    folderId,
    updatedAt:
      typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
  };
}

async function readJson<T>(fileName: string, storageKey: string): Promise<T | null> {
  if (!isTauriRuntime()) {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  await ensureAppDataDir();

  try {
    if (!(await exists(fileName, { baseDir: APP_DATA_DIR }))) return null;
    const raw = await readTextFile(fileName, { baseDir: APP_DATA_DIR });
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`[storage] could not read ${fileName}`, error);
    return null;
  }
}

async function writeJson(
  fileName: string,
  storageKey: string,
  value: unknown,
): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);

  if (!isTauriRuntime()) {
    window.localStorage.setItem(storageKey, serialized);
    return;
  }

  await ensureAppDataDir();
  await writeTextFile(fileName, serialized, { baseDir: APP_DATA_DIR });
}

async function deleteFile(fileName: string, storageKey: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  await ensureAppDataDir();

  try {
    if (await exists(fileName, { baseDir: APP_DATA_DIR })) {
      await remove(fileName, { baseDir: APP_DATA_DIR });
    }
  } catch (error) {
    console.warn(`[storage] could not delete ${fileName}`, error);
  }
}

/**
 * Reads `boards-index.json`, migrating the legacy v1 shape (a bare array of
 * boards) into the current `{ folders, boards }` library and discarding any
 * malformed entries.
 */
export async function loadLibrary(): Promise<BoardLibrary> {
  const raw = await readJson<unknown>(INDEX_FILE_NAME, INDEX_STORAGE_KEY);

  // v1: a plain array of boards with no folders.
  if (Array.isArray(raw)) {
    const boards = raw
      .map((entry) => normaliseBoard(entry, new Set()))
      .filter((entry): entry is BoardIndexEntry => entry !== null);
    return { folders: [], boards };
  }

  if (typeof raw !== "object" || raw === null) return { folders: [], boards: [] };

  const candidate = raw as { folders?: unknown; boards?: unknown };
  const folders = Array.isArray(candidate.folders)
    ? candidate.folders.filter(isFolderEntry)
    : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const boards = Array.isArray(candidate.boards)
    ? candidate.boards
        .map((entry) => normaliseBoard(entry, folderIds))
        .filter((entry): entry is BoardIndexEntry => entry !== null)
    : [];

  return { folders, boards };
}

/** Persists the board library. */
export async function saveLibrary(library: BoardLibrary): Promise<void> {
  await writeJson(INDEX_FILE_NAME, INDEX_STORAGE_KEY, {
    version: LIBRARY_VERSION,
    folders: library.folders,
    boards: library.boards,
  });
}

/** Loads a board's tldraw snapshot, or `null` for a board that has no data yet. */
export async function loadBoardSnapshot(
  boardId: string,
): Promise<BoardSnapshot | null> {
  const raw = await readJson<BoardSnapshot>(boardFileName(boardId), boardStorageKey(boardId));
  if (!raw || typeof raw !== "object" || !("document" in raw)) return null;
  return raw;
}

/** Writes a board's tldraw snapshot to disk. */
export async function saveBoardSnapshot(
  boardId: string,
  snapshot: BoardSnapshot,
): Promise<void> {
  await writeJson(boardFileName(boardId), boardStorageKey(boardId), snapshot);
}

/** Removes a board's snapshot from disk. */
export async function deleteBoardSnapshot(boardId: string): Promise<void> {
  await deleteFile(boardFileName(boardId), boardStorageKey(boardId));
}
