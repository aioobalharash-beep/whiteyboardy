/**
 * TEMPORARY instrumentation used to diagnose runtime problems inside the
 * packaged Tauri app, where the webview console is not reachable.
 *
 * It records a small rolling log in `localStorage` (the one store that is always
 * available) so the log can be read from the webview's storage on disk.
 *
 * Remove this module once the packaged app has been verified.
 */
const DIAG_KEY = "whiteyboardy.diagnostics";
const MAX_ENTRIES = 100;

export function diag(event: string, detail?: unknown): void {
  try {
    const raw = window.localStorage.getItem(DIAG_KEY);
    const entries = raw ? (JSON.parse(raw) as unknown[]) : [];
    entries.push({ at: new Date().toISOString(), event, detail });
    window.localStorage.setItem(DIAG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Diagnostics must never break the app.
  }
}
