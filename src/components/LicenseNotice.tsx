import { ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TLDRAW_LICENSE_GRACE_MS } from "../lib/license";
import { isTauriRuntime } from "../lib/storage";

const PRICING_URL = "https://tldraw.dev/pricing";
const GRACE_SECONDS = Math.round(TLDRAW_LICENSE_GRACE_MS / 1000);

interface LicenseNoticeProps {
  /** tldraw has replaced the editor with its licence gate. */
  gated: boolean;
  /** This bundle was built without `VITE_TLDRAW_LICENSE_KEY`. */
  missingKey: boolean;
}

function openPricing() {
  if (isTauriRuntime()) {
    void openUrl(PRICING_URL).catch((error: unknown) => {
      console.warn("[whiteyboardy] could not open the browser", error);
    });
    return;
  }
  window.open(PRICING_URL, "_blank", "noreferrer");
}

/**
 * Explains tldraw's production licence gate.
 *
 * Without a licence key tldraw removes the entire editor a few seconds after it
 * starts, which otherwise looks like a crash: the canvas is empty and the tools
 * have nothing to act on. This surfaces the real reason, before and after the
 * canvas is taken away.
 */
export function LicenseNotice({ gated, missingKey }: LicenseNoticeProps) {
  if (!gated && !missingKey) return null;

  if (!gated) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-3">
        <p className="pointer-events-auto flex max-w-xl items-center gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3.5 py-2 text-[12px] font-medium text-amber-800 shadow-lg backdrop-blur-xl">
          <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            No tldraw licence key in this build. tldraw hides the canvas{" "}
            {GRACE_SECONDS} seconds after launch, so this window will go blank — set{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-[11px]">
              VITE_TLDRAW_LICENSE_KEY
            </code>{" "}
            and rebuild to keep it.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-100/70 p-6 backdrop-blur-sm">
      <div className="wb-animate-in w-full max-w-lg rounded-3xl border border-neutral-200/80 bg-white/90 p-6 shadow-xl shadow-neutral-900/10 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <KeyRound className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-900">
              The canvas stopped: this build has no tldraw licence key
            </h2>
            <p className="text-[12px] text-neutral-500">
              Not a crash — tldraw removed its own editor.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-[12.5px] leading-relaxed text-neutral-600">
          <p>
            tldraw v5 is free while you develop, but a production build needs a
            licence key. Without a valid one it hides the editor about{" "}
            {GRACE_SECONDS} seconds after it starts, so the board goes blank and
            the tools no longer have a canvas to work on.
          </p>
          <p>
            Your boards are untouched — this is only the canvas renderer stepping
            aside.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Get a key from tldraw (a free 100-day trial is available, and the
              watermark stays visible with it).
            </li>
            <li>
              Add it to a{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">.env</code>{" "}
              file in the project root:{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">
                VITE_TLDRAW_LICENSE_KEY=…
              </code>
            </li>
            <li>
              Rebuild with{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">
                npm run tauri build
              </code>
              .
            </li>
          </ol>
          <p className="text-neutral-500">
            Development runs never need a key:{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 text-[11px]">
              npm run tauri dev
            </code>{" "}
            and the browser preview keep the canvas.
          </p>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={openPricing}
            className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-2 text-[12px] font-medium text-white transition-colors hover:bg-neutral-800"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span>tldraw pricing</span>
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            <span>Reload</span>
          </button>
        </div>
      </div>
    </div>
  );
}
