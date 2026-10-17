/**
 * TEMPORARY VERIFICATION HELPER — DELETE BEFORE SHIPPING.
 *
 * Creates one shape shortly after launch and records what happened to a file in
 * the app data directory, so the packaged app's editor → autosave → file path
 * can be checked from outside the window.
 */
import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Editor } from "tldraw";
import { createShapeId, getSnapshot } from "tldraw";
import { isTauriRuntime, saveBoardSnapshot } from "./storage";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function report(payload: Record<string, unknown>): Promise<void> {
  try {
    await writeTextFile("selftest-report.json", JSON.stringify(payload, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch {
    // nothing we can do from a verification helper
  }
}

export async function runSelfTest(editor: Editor): Promise<void> {
  if (!isTauriRuntime()) return;

  await sleep(2500);

  const report: Record<string, unknown> = {};
  try {
    editor.createShape({
      id: createShapeId(),
      type: "geo",
      x: 120,
      y: 120,
      props: { geo: "rectangle", w: 260, h: 180 },
    });
    report.created = true;
    report.liveShapes = [...editor.getCurrentPageShapeIds()].length;
  } catch (error) {
    report.createError = String(error);
  }

  // Give the app's own debounced autosave (500 ms) time to run.
  await sleep(2000);
  report.indexAfterAutosave = window.localStorage.getItem("whiteyboardy.boards-index");

  try {
    const snapshot = getSnapshot(editor.store);
    report.snapshotRecords = Object.keys(snapshot.document.store).length;
    await saveBoardSnapshot("selftest-board", snapshot);
    report.saveOk = true;
  } catch (error) {
    report.saveError = String(error);
  }

  await report(report);
}
