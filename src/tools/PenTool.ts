import {
  StateNode,
  Vec,
  createShapeId,
  getIndexAbove,
  getIndices,
  type IndexKey,
  type TLKeyboardEventInfo,
  type TLLineShapePoint,
  type TLPointerEventInfo,
  type TLShapeId,
  type TLStateNodeConstructor,
} from "tldraw";

/** Tool id registered with tldraw; also used by the dock to arm the tool. */
export const PEN_TOOL_ID = "wb-pen";

/** How the segments between two anchors are drawn. */
export type PenSpline = "line" | "cubic";

/**
 * The pen's segment style for the *next* path.
 *
 * The tool reads this on every click, so it lives in a plain module value rather
 * than React state — the dock keeps it in sync with the Straight/Smooth toggle.
 */
export const penConfig: { spline: PenSpline } = { spline: "line" };

/** Screen-pixel radius within which clicking the first anchor closes the path. */
const CLOSE_RADIUS_PX = 12;
/** Screen-pixel distance under which two anchors count as the same point. */
const DUPLICATE_RADIUS_PX = 3;

interface PenPoint {
  index: IndexKey;
  x: number;
  y: number;
}

/**
 * A Photoshop-style pen tool: click to drop anchor points and the path follows
 * the pointer with a rubber-band segment. Click the first anchor to close the
 * path, `Enter` or a double-click to finish, `Backspace` to drop the last
 * anchor and `Escape` to throw the path away.
 *
 * The path is written straight into a real tldraw `line` shape, so it keeps
 * native stroke colour, thickness, dash, vertex handles, serialization and
 * export behaviour.
 */
class PenDrawing extends StateNode {
  static override id = "drawing";

  private shapeId: TLShapeId | null = null;
  /**
   * Page-space position of the first anchor. While a path is being drawn the
   * shape's origin *is* that anchor, so this doubles as the close-path target.
   */
  private origin: Vec | null = null;
  private anchors: PenPoint[] = [];
  /** The rubber-band point that trails the pointer until the next click. */
  private pending: PenPoint | null = null;
  private hoveringStart = false;

  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
    this.reset();
  }

  override onExit() {
    // Switching tools mid-path keeps whatever was already committed.
    this.finish({ select: false, exit: false });
  }

  override onInterrupt() {
    this.finish({ select: false, exit: false });
  }

  override onCancel() {
    if (this.shapeId) {
      this.discard();
      return;
    }
    // Escape with nothing in progress leaves the tool, like tldraw's line tool.
    this.editor.setCurrentTool("select");
  }

  override onComplete() {
    this.finish({ select: true, exit: true });
  }

  override onDoubleClick() {
    this.finish({ select: true, exit: true });
  }

  override onKeyDown(info: TLKeyboardEventInfo) {
    // tldraw maps Enter to `complete()` from its UI shortcuts, which this app
    // hides, so the pen finishes itself.
    if (info.key === "Enter") {
      this.finish({ select: true, exit: true });
      return;
    }
    if (info.key === "Backspace" || info.key === "Delete") {
      this.removeLastAnchor();
    }
  }

  override onPointerDown(info: TLPointerEventInfo) {
    if (info.button !== 0) return;

    const page = this.editor.inputs.getCurrentPagePoint();

    if (!this.shapeId) {
      this.beginPath(page);
      return;
    }

    if (this.isOverFirstAnchor(page)) {
      this.closePath();
      return;
    }

    this.addAnchor(page);
  }

  override onPointerMove() {
    if (!this.shapeId || !this.pending) return;

    const page = this.editor.inputs.getCurrentPagePoint();
    const near = this.isOverFirstAnchor(page);
    if (near !== this.hoveringStart) {
      this.hoveringStart = near;
      this.editor.setCursor({ type: near ? "dot" : "cross", rotation: 0 });
    }
    this.movePending(page);
  }

  // --- Building the path --------------------------------------------------

  private beginPath(page: Vec) {
    const id = createShapeId();
    const [first] = getIndices(2);
    const second = getIndexAbove(first);

    this.editor.markHistoryStoppingPoint("wb-pen");
    this.editor.createShape({
      id,
      type: "line",
      x: page.x,
      y: page.y,
      props: {
        spline: penConfig.spline,
        dash: "solid",
        scale: 1,
        points: {
          [first]: { id: first, index: first, x: 0, y: 0 },
          [second]: { id: second, index: second, x: 0, y: 0 },
        },
      },
    });

    this.shapeId = id;
    this.origin = page;
    this.anchors = [{ index: first, x: 0, y: 0 }];
    this.pending = { index: second, x: 0, y: 0 };
    this.hoveringStart = false;
  }

  private addAnchor(page: Vec) {
    if (!this.origin) return;

    const local = Vec.Sub(page, this.origin);
    const last = this.anchors[this.anchors.length - 1];
    const index = getIndexAbove(last.index);

    this.anchors = [...this.anchors, { index, x: local.x, y: local.y }];
    this.pending = { index: getIndexAbove(index), x: local.x, y: local.y };
    this.write();
  }

  private movePending(page: Vec) {
    if (!this.origin || !this.pending) return;

    const local = Vec.Sub(page, this.origin);
    this.pending = { index: this.pending.index, x: local.x, y: local.y };
    this.write();
  }

  private removeLastAnchor() {
    if (!this.shapeId) return;

    if (this.anchors.length <= 1) {
      this.discard();
      return;
    }

    this.anchors = this.anchors.slice(0, -1);
    const last = this.anchors[this.anchors.length - 1];
    this.pending = { index: getIndexAbove(last.index), x: last.x, y: last.y };
    this.write();
  }

  private closePath() {
    if (!this.pending) return;

    const first = this.anchors[0];
    const last = this.anchors[this.anchors.length - 1];

    this.anchors = [
      ...this.anchors,
      { index: getIndexAbove(last.index), x: first.x, y: first.y },
    ];
    this.pending = null;
    this.write();
    this.finish({ select: true, exit: true });
  }

  // --- Finishing ----------------------------------------------------------

  private finish({ select, exit }: { select: boolean; exit: boolean }) {
    const shapeId = this.shapeId;
    if (!shapeId) return;
    if (!this.editor.getShape(shapeId)) {
      this.reset();
      return;
    }

    const cleaned = this.dedupe(this.anchors);
    if (cleaned.length < 2) {
      // A single click is not a path yet; leave nothing behind.
      this.editor.deleteShapes([shapeId]);
      this.reset();
      return;
    }

    this.anchors = cleaned;
    this.pending = null;
    this.write();
    this.editor.updateShape({
      id: shapeId,
      type: "line",
      props: { spline: penConfig.spline },
    });
    this.editor.markHistoryStoppingPoint("wb-pen");
    this.reset();

    if (select) this.editor.setSelectedShapes([shapeId]);
    if (exit) this.editor.setCurrentTool("select");
  }

  private discard() {
    if (this.shapeId) this.editor.deleteShapes([this.shapeId]);
    this.reset();
  }

  private reset() {
    this.shapeId = null;
    this.origin = null;
    this.anchors = [];
    this.pending = null;
    this.hoveringStart = false;
  }

  // --- Helpers ------------------------------------------------------------

  private isOverFirstAnchor(page: Vec): boolean {
    if (!this.origin || this.anchors.length < 2) return false;

    const screenDistance = Vec.Dist(page, this.origin) * this.editor.getZoomLevel();
    return screenDistance <= CLOSE_RADIUS_PX;
  }

  /** Drops anchors that landed on top of each other, e.g. from a double-click. */
  private dedupe(points: PenPoint[]): PenPoint[] {
    const minPageDistance = DUPLICATE_RADIUS_PX / Math.max(this.editor.getZoomLevel(), 0.01);
    const result: PenPoint[] = [];

    for (const point of points) {
      const previous = result[result.length - 1];
      if (
        previous &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < minPageDistance
      ) {
        continue;
      }
      result.push(point);
    }

    return result;
  }

  /** Rewrites the shape's point map from the anchors plus the rubber-band point. */
  private write() {
    if (!this.shapeId) return;

    // The board may have changed under us (or the shape been deleted); a stale
    // draft would otherwise keep writing to a shape that no longer exists.
    if (!this.editor.getShape(this.shapeId)) {
      this.reset();
      return;
    }

    const points: Record<string, TLLineShapePoint> = {};
    for (const point of this.anchors) {
      points[point.index] = { id: point.index, index: point.index, x: point.x, y: point.y };
    }
    if (this.pending) {
      points[this.pending.index] = {
        id: this.pending.index,
        index: this.pending.index,
        x: this.pending.x,
        y: this.pending.y,
      };
    }

    this.editor.updateShape({ id: this.shapeId, type: "line", props: { points } });
  }
}

/** The pen tool. Register with `<Tldraw tools={penTools}>`. */
export class PenTool extends StateNode {
  static override id = PEN_TOOL_ID;
  static override initial = "drawing";
  static override children(): TLStateNodeConstructor[] {
    return [PenDrawing];
  }

  override shapeType = "line";
}

/** Stable array so the editor does not re-register tools on every render. */
export const penTools = [PenTool];
