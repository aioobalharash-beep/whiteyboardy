import {
  BaseDirectory,
  exists,
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
 * Rust creates that directory at startup (`create_dir_all`); the webview's `fs`
 * plugin cannot, because `mkdir(".")` resolves to a path with a trailing `.`
 * component that `create_dir_all` handles incorrectly.
 *
 * When the app runs in a plain browser (`npm run dev`) — or when the app data
 * directory turns out to be unusable at runtime — the same data is kept in
 * `localStorage` instead, so the board library is never lost.
 */
const APP_DATA_DIR = BaseDirectory.AppData;
const INDEX_FILE_NAME = "boards-index.json";
const INDEX_STORAGE_KEY = "whiteyboardy.boards-index";

/** Written once and removed again to prove the file backend can really write. */
const PROBE_FILE_NAME = "whiteyboardy-storage-probe.json";
/**
 * A storage call that never settles would hang the whole library load, so every
 * file operation is given a deadline and falls back to `localStorage` after it.
 */
const STORAGE_TIMEOUT_MS = 3000;

/** Bumped whenever the on-disk shape of `boards-index.json` changes. */
const LIBRARY_VERSION = 3;

const boardFileName = (boardId: string) => `board-${boardId}.json`;
const boardStorageKey = (boardId: string) => `whiteyboardy.board.${boardId}`;

/** Where the board library is being persisted right now. */
export type StorageBackend = "files" | "browser";

/** The outcome of choosing a storage backend, for the UI to report. */
export interface StorageReport {
  backend: StorageBackend;
  /** Why the file backend was rejected, if it was. */
  error: string | null;
}

/** Whether we are running inside the Tauri webview rather than a browser tab. */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      "undefined"
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Rejects when `promise` has not settled within `STORAGE_TIMEOUT_MS`. */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} did not respond within ${STORAGE_TIMEOUT_MS} ms`));
    }, STORAGE_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(describeError(error)));
      },
    );
  });
}

let storageReport: StorageReport | null = null;
let storageReportPromise: Promise<StorageReport> | null = null;

/**
 * Proves that the app data directory can be written to.
 *
 * No storage permission check is trustworthy until a real byte has landed on
 * disk, so this writes (and removes) a probe file. If that fails — or simply
 * never answers — the caller falls back to `localStorage`.
 */
async function probeFileBackend(): Promise<StorageReport> {
  try {
    await withTimeout(
      writeTextFile(PROBE_FILE_NAME, "ok", { baseDir: APP_DATA_DIR }),
      `writeTextFile(${PROBE_FILE_NAME})`,
    );
    await remove(PROBE_FILE_NAME, { baseDir: APP_DATA_DIR }).catch(() => {});
    return { backend: "files", error: null };
  } catch (caught) {
    const error = describeError(caught);
    return { backend: "browser", error };
  }
}

/** Resolves (once) which backend this session writes to, and remembers it. */
function resolveStorage(): Promise<StorageReport> {
  if (!isTauriRuntime()) {
    storageReport ??= { backend: "browser", error: null };
    return Promise.resolve(storageReport);
  }

  storageReportPromise ??= probeFileBackend().then((report) => {
    storageReport = report;
    return report;
  });

  return storageReportPromise;
}

/**
 * The storage backend in use, plus the reason the file backend was skipped.
 *
 * Reads wait for the backend probe, so this is safe to call as soon as the app
 * has loaded.
 */
export function storageStatus(): Promise<StorageReport> {
  return resolveStorage();
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
 * Normalises a board entry, defaulting everything a legacy (v1 or v2) file may
 * omit and dropping any folder reference that no longer exists.
 */
function normaliseBoard(value: unknown, folderIds: Set<string>): BoardIndexEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as {
    id?: unknown;
    name?: unknown;
    folderId?: unknown;
    pinned?: unknown;
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
    pinned: candidate.pinned === true,
    updatedAt:
      typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
  };
}

async function readJson<T>(fileName: string, storageKey: string): Promise<T | null> {
  const { backend } = await resolveStorage();

  if (backend === "browser") {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      console.warn(`[storage] could not read ${storageKey}`, error);
      return null;
    }
  }

  try {
    if (!(await withTimeout(exists(fileName, { baseDir: APP_DATA_DIR }), `exists(${fileName})`))) {
      return null;
    }
    const raw = await withTimeout(
      readTextFile(fileName, { baseDir: APP_DATA_DIR }),
      `readTextFile(${fileName})`,
    );
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
  const { backend } = await resolveStorage();

  if (backend === "browser") {
    window.localStorage.setItem(storageKey, serialized);
    return;
  }

  await withTimeout(
    writeTextFile(fileName, serialized, { baseDir: APP_DATA_DIR }),
    `writeTextFile(${fileName})`,
  );
}

async function deleteFile(fileName: string, storageKey: string): Promise<void> {
  const { backend } = await resolveStorage();

  if (backend === "browser") {
    window.localStorage.removeItem(storageKey);
    return;
  }

  try {
    if (await withTimeout(exists(fileName, { baseDir: APP_DATA_DIR }), `exists(${fileName})`)) {
      await withTimeout(remove(fileName, { baseDir: APP_DATA_DIR }), `remove(${fileName})`);
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
