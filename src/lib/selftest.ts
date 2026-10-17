/**
 * TEMPORARY VERIFICATION HELPER — DELETE BEFORE SHIPPING.
 *
 * Creates one shape shortly after launch and records what it can observe to a
 * file in the app data directory. The board snapshot itself must then appear as
 * `board-<active board id>.json`, written by the app's own auto-save, so a second
 * run proves that a board written by one launch is loaded by the next.
 */
import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Editor } from "tldraw";
import { createShapeId, getSnapshot } from "tldraw";
import { isTauriRuntime } from "./storage";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runSelfTest(editor: Editor): Promise<void> {
  if (!isTauriRuntime()) return;

  await sleep(2500);

  const payload: Record<string, unknown> = {
    shapesOnLoad: [...editor.getCurrentPageShapeIds()].length,
  };

  try {
    editor.createShape({
      id: createShapeId(),
      type: "geo",
      x: 120,
      y: 120,
      props: { geo: "rectangle", w: 260, h: 180 },
    });
    payload.created = true;
    payload.shapesAfterCreate = [...editor.getCurrentPageShapeIds()].length;
  } catch (error) {
    payload.createError = String(error);
  }

  // Give the app's own debounced auto-save (500 ms) time to run.
  await sleep(2000);

  payload.snapshotRecords = Object.keys(getSnapshot(editor.store).document.store).length;
  payload.browserStorageIndex = window.localStorage.getItem("whiteyboardy.boards-index");

  try {
    await writeTextFile("selftest-report.json", JSON.stringify(payload, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch {
    // nothing we can do from a verification helper
  }
}
