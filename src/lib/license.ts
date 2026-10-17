import { useEffect, useState } from "react";

/**
 * tldraw licensing.
 *
 * tldraw v5 is free while you develop, but a **production** build needs a
 * licence key. Without a valid one tldraw replaces the whole editor with an
 * empty gate five seconds after mounting — the canvas goes blank while the app
 * around it keeps working, which looks exactly like a crash.
 *
 * The key is read from `VITE_TLDRAW_LICENSE_KEY` at build time, so it can live in
 * a `.env` file that is never committed (see `.env.example`). tldraw also reads
 * that variable by itself; passing it explicitly keeps the app in charge.
 */
const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;

/** Licence key from the build environment, if one was provided. */
export const TLDRAW_LICENSE_KEY: string | undefined =
  typeof env.VITE_TLDRAW_LICENSE_KEY === "string" && env.VITE_TLDRAW_LICENSE_KEY.trim()
    ? env.VITE_TLDRAW_LICENSE_KEY.trim()
    : undefined;

/** `true` for `vite build` output — the only mode in which tldraw gates the editor. */
export const IS_PRODUCTION_BUILD = env.PROD === true;

/** How long tldraw waits before it hides the editor (its own `LICENSE_TIMEOUT`). */
export const TLDRAW_LICENSE_GRACE_MS = 5000;

/** The marker tldraw renders in place of the editor once it has been gated. */
const LICENSE_GATE_SELECTOR = '[data-testid="tl-license-expired"]';

/**
 * Mirrors tldraw's own "is this a development origin?" check
 * (`LicenseManager.getIsDevelopment`), so the app can warn about the gate
 * *before* it fires instead of guessing.
 */
function isDevelopmentOrigin(): boolean {
  if (!IS_PRODUCTION_BUILD) return true;
  if (typeof window === "undefined") return false;

  const { protocol, hostname } = window.location;

  // Tauri uses `tauri://localhost` on macOS/Linux, `http://tauri.localhost` on
  // Windows. tldraw special-cases the `.localhost` suffix before the protocol.
  if (hostname.endsWith(".localhost")) return !IS_PRODUCTION_BUILD;
  if (protocol === "http:") return true;
  if (protocol === "https:" && isLoopbackHost(hostname)) return true;

  return !IS_PRODUCTION_BUILD;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

/**
 * Whether this build is going to be licence-gated: a production bundle with no
 * key running somewhere tldraw does not treat as development. An *invalid* key
 * is caught as well, by watching for tldraw's marker element.
 */
export function willEditorBeGated(): boolean {
  return !isDevelopmentOrigin() && !TLDRAW_LICENSE_KEY;
}

/** Whether tldraw has already swapped the editor for its licence gate. */
export function isEditorLicenseGated(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(LICENSE_GATE_SELECTOR) !== null;
}

/**
 * Tracks whether tldraw has *actually* hidden the editor behind its licence
 * gate, so the app can explain what happened instead of showing a dead canvas.
 *
 * This deliberately starts from the DOM marker rather than from
 * {@link willEditorBeGated}: before the gate fires the editor is fully usable,
 * and pretending otherwise would leave the canvas on screen while the app's own
 * board loading and auto-save stayed inert.
 */
export function useEditorLicenseGate(): boolean {
  const [gated, setGated] = useState(isEditorLicenseGated);

  useEffect(() => {
    if (gated) return;
    const check = () => {
      if (isEditorLicenseGated()) setGated(true);
    };
    const timer = window.setInterval(check, 500);
    return () => window.clearInterval(timer);
  }, [gated]);

  return gated;
}
