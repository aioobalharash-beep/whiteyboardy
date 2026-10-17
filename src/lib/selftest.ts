/**
 * TEMPORARY VERIFICATION HELPER — DELETE BEFORE SHIPPING.
 *
 * Creates one shape a couple of seconds after launch so that the packaged app
 * exercises the real editor → autosave → `board-<id>.json` path, which cannot be
 * driven from outside the app window.
 */
import type { Editor } from "tldraw";
import { createShapeId } from "tldraw";

export function runSelfTest(editor: Editor): void {
  window.setTimeout(() => {
    editor.createShape({
      id: createShapeId(),
      type: "geo",
      x: 120,
      y: 120,
      props: { geo: "rectangle", w: 260, h: 180 },
    });
  }, 2500);
}
