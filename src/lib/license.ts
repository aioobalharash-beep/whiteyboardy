import { useEffect, useState } from "react";

/**
 * tldraw licensing.
 *
 * tldraw v5 is free while you develop, but a **production** build needs a
 * licence key. Without a valid one tldraw replaces the whole editor with its own
 * gate five seconds after mounting — the canvas goes blank while the app around
 * it keeps working, which looks exactly like a crash.
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

/** Whether this build is guaranteed to be gated: production and no key at all. */
export function licenseKeyMissingInProduction(): boolean {
  return IS_PRODUCTION_BUILD && !TLDRAW_LICENSE_KEY;
}

/** Whether tldraw has already swapped the editor for its licence gate. */
export function isEditorLicenseGated(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(LICENSE_GATE_SELECTOR) !== null;
}

/**
 * Tracks whether the editor is (or is about to be) hidden by tldraw's licence
 * gate, so the app can explain what happened instead of showing a dead canvas.
 */
export function useEditorLicenseGate(): boolean {
  const [gated, setGated] = useState(licenseKeyMissingInProduction);

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
