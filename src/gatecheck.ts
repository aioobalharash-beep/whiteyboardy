/**
 * TEMPORARY production self-test — not part of the app; deleted after the
 * migration check. It answers one question the dev harness cannot: does the
 * canvas still draw, minutes after launch, in a *packaged* build? The previous
 * engine replaced its editor with a licence gate five seconds in, which is the
 * whole reason for this migration.
 *
 * It samples the canvas renderer three times (as soon as the canvas mounts, at
 * 9 s, and after a synthetic ctrl+wheel zoom) and writes the raw numbers to
 * `gatecheck.json` in the app data directory.
 */
import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauriRuntime } from "./lib/storage";

interface Sample {
  atMs: number;
  canvases: number;
  container: [number, number, number, number] | null;
  redPixels: number | null;
  redBox: [number, number, number, number] | null;
  gateText: string | null;
  visibility: string;
}

const REPORT = "gatecheck.json";
const GATE_PATTERN = /licen[cs]e|watermark|trial|unlock|activate/i;

function sample(elementCountNote: string): Sample {
  const canvas = document.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.static",
  );
  const host = document.querySelector(".excalidraw");
  const rect = host ? host.getBoundingClientRect() : null;

  let redPixels: number | null = null;
  let redBox: [number, number, number, number] | null = null;

  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < data.length; i += 4) {
        // The seeded board's star is #e03131 (224, 49, 49).
        if (data[i] > 170 && data[i + 1] < 110 && data[i + 2] < 110) {
          count += 1;
          const pixel = i / 4;
          const x = pixel % canvas.width;
          const y = Math.floor(pixel / canvas.width);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }

      redPixels = count;
      redBox =
        count > 0 ? [minX, minY, maxX - minX, maxY - minY] : null;
    }
  }

  const body = document.body?.innerText ?? "";
  const gate = GATE_PATTERN.exec(body);

  return {
    atMs: Math.round(performance.now()),
    canvases: document.querySelectorAll("canvas").length,
    container: rect
      ? [
          Math.round(rect.x),
          Math.round(rect.y),
          Math.round(rect.width),
          Math.round(rect.height),
        ]
      : null,
    redPixels,
    redBox,
    gateText: gate ? `${gate[0]} (${elementCountNote})` : null,
    visibility: document.visibilityState,
  };
}

function zoomViaWheel(): boolean {
  const target =
    document.querySelector("canvas.excalidraw__canvas.interactive") ??
    document.querySelector(".excalidraw");
  if (!target) return false;

  target.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY: -120,
      deltaMode: 0,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: 500,
      clientY: 350,
    }),
  );
  return true;
}

export function runGateCheck(): void {
  if (!isTauriRuntime()) return;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  void (async () => {
    // Wait for the editor's canvas to mount.
    for (let i = 0; i < 60; i += 1) {
      if (document.querySelector("canvas.excalidraw__canvas.static")) break;
      await wait(100);
    }

    const first = sample("first");
    await wait(Math.max(0, 9000 - performance.now()));
    const late = sample("late");
    const wheelSent = zoomViaWheel();
    await wait(600);
    const afterZoom = sample("zoomed");

    const report = {
      ranIn: window.location.protocol,
      wheelSent,
      samples: [first, late, afterZoom],
      // A repaint after 9 s shows up as a different red-pixel count/box.
      drewAtStart: (first.redPixels ?? 0) > 500,
      stillDrawingAt9s: (late.redPixels ?? 0) > 500,
      repaintedAfterZoom:
        JSON.stringify(late.redBox) !== JSON.stringify(afterZoom.redBox) ||
        late.redPixels !== afterZoom.redPixels,
      gateTextSeen: [first.gateText, late.gateText, afterZoom.gateText].some(
        Boolean,
      ),
    };

    try {
      await writeTextFile(REPORT, JSON.stringify(report, null, 2), {
        baseDir: BaseDirectory.AppData,
      });
    } catch {
      // Nothing else we can do from a packaged webview.
    }
  })();
}
