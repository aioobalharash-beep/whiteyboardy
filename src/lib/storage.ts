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

/** A single entry of `boards-index.json`. */
export interface BoardIndexEntry {
  id: string;
  name: string;
  updatedAt: number;
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

/** Stable, collision-free id for a new board. */
export function createBoardId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isBoardIndexEntry(value: unknown): value is BoardIndexEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BoardIndexEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.updatedAt === "number"
  );
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

/** Reads `boards-index.json`, discarding any malformed entries. */
export async function loadBoardIndex(): Promise<BoardIndexEntry[]> {
  const raw = await readJson<unknown>(INDEX_FILE_NAME, INDEX_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isBoardIndexEntry);
}

/** Persists the board index. */
export async function saveBoardIndex(boards: BoardIndexEntry[]): Promise<void> {
  await writeJson(INDEX_FILE_NAME, INDEX_STORAGE_KEY, boards);
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
