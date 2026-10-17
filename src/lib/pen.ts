/**
 * The pen tool's geometry.
 *
 * Excalidraw has no "path" element and no bezier storage, so a pen path is
 * modelled here as **anchors with tangent handles** (what Photoshop calls
 * direction handles) and then *sampled* into a closed or open Excalidraw
 * `line` element. That keeps everything the engine already gives us for free —
 * stroke colour and width, fills, resizing, point editing, serialization,
 * export and undo — because the result is an ordinary linear element.
 *
 * The pen itself is registered with Excalidraw as a custom tool
 * (`{ type: "custom", customType: PEN_CUSTOM_TYPE }`), which is the only hook
 * the engine offers for host-drawn tools.
 */
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { normalise, type Point } from "./shapes";

/** The `customType` the pen registers with Excalidraw. */
export const PEN_CUSTOM_TYPE = "whiteyboardy-pen";

/** A pointer offset, in scene units, relative to its anchor. */
export interface Vec {
  x: number;
  y: number;
}

/**
 * One point on the path.
 *
 * `in` and `out` are the tangent handles that bend the segments arriving at and
 * leaving the anchor. A `null` handle means the segment is a straight line (a
 * corner, in pen terms); dragging while placing an anchor sets both, which is
 * what makes the path run smoothly *through* the anchor.
 */
export interface PenAnchor {
  x: number;
  y: number;
  in: Vec | null;
  out: Vec | null;
}

/** How close to the first anchor (in screen px) a click closes the path. */
const CLOSE_RADIUS_PX = 10;

/** A drag shorter than this (in screen px) counts as a click, not a handle. */
export const DRAG_THRESHOLD_PX = 3;

/** Longest a curve segment is allowed to be sampled, in scene units per step. */
const UNITS_PER_SAMPLE = 4;

/** The path styles the pen draws with, taken from the dock. */
export interface PenStyle {
  strokeColor: string;
  strokeWidth: number;
  /** How a closed path is filled, in Excalidraw's own terms. */
  fillStyle: "hachure" | "cross-hatch" | "solid";
  /** The fill colour, or `null` when the dock is set to no fill. */
  fillColor: string | null;
}

function cubicAt(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

/**
 * The points of one segment, minus its start (the caller already has it).
 *
 * A segment with no tangents on either end is a single straight step; anything
 * else is a cubic bezier sampled finely enough to read as a smooth curve at
 * ordinary zoom levels.
 */
function segmentPoints(from: PenAnchor, to: Pick<PenAnchor, "x" | "y" | "in">): Point[] {
  const p0 = { x: from.x, y: from.y };
  const p1 = { x: to.x, y: to.y };

  if (!from.out && !to.in) return [p1];

  const c1 = from.out ? { x: from.x + from.out.x, y: from.y + from.out.y } : p0;
  const c2 = to.in ? { x: to.x + to.in.x, y: to.y + to.in.y } : p1;

  const span =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    (from.out ? Math.hypot(from.out.x, from.out.y) : 0) +
    (to.in ? Math.hypot(to.in.x, to.in.y) : 0);
  const steps = Math.max(6, Math.min(64, Math.round(span / UNITS_PER_SAMPLE)));

  const points: Point[] = [];
  for (let index = 1; index <= steps; index++) {
    points.push(cubicAt(p0, c1, c2, p1, index / steps));
  }
  return points;
}

/**
 * The polyline for a set of anchors.
 *
 * `cursor` extends the path with a live segment to the pointer (the "rubber
 * band"); `closed` also draws the segment back to the first anchor and repeats
 * that first point, which is what tells Excalidraw to paint the background.
 */
export function penPathPoints(
  anchors: readonly PenAnchor[],
  options: { closed?: boolean; cursor?: Point | null } = {},
): Point[] {
  const { closed = false, cursor = null } = options;
  if (anchors.length === 0) return [];

  const points: Point[] = [{ x: anchors[0].x, y: anchors[0].y }];
  const segments = closed ? anchors.length : anchors.length - 1;
  for (let index = 0; index < segments; index++) {
    const next = anchors[(index + 1) % anchors.length];
    points.push(...segmentPoints(anchors[index], next));
  }

  if (!closed && cursor) {
    points.push(...segmentPoints(anchors[anchors.length - 1], { ...cursor, in: null }));
  }

  if (closed && anchors.length >= 2) {
    // A zero-length closing step: Excalidraw fills a linear element only when
    // its ends meet (`isPathALoop`).
    points.push({ x: anchors[0].x, y: anchors[0].y });
  }

  return points;
}

/** True when a click at `point` should close the path. */
export function isNearFirstAnchor(
  anchors: readonly PenAnchor[],
  point: Point,
  zoomValue: number,
): boolean {
  if (anchors.length < 2) return false;
  const first = anchors[0];
  return Math.hypot(first.x - point.x, first.y - point.y) * zoomValue <= CLOSE_RADIUS_PX;
}

/** Snaps the direction from `from` to `to` to the nearest 45°, keeping its length. */
export function snapTo45(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: from.x + Math.cos(angle) * length,
    y: from.y + Math.sin(angle) * length,
  };
}

/** The element for a finished path, or `null` when there is nothing to draw. */
export function penElementSkeleton(
  anchors: readonly PenAnchor[],
  closed: boolean,
  style: PenStyle,
): ExcalidrawElementSkeleton | null {
  if (anchors.length < 2) return null;

  const points = penPathPoints(anchors, { closed });
  if (points.length < 2) return null;

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const { points: local, width, height } = normalise(points);

  return {
    type: "line",
    x: minX,
    y: minY,
    width,
    height,
    points: local.map((point) => [point.x, point.y] as [number, number]),
    strokeColor: style.strokeColor,
    // Only a closed path can be filled, and an open one must not hide its start.
    backgroundColor:
      closed && style.fillColor ? style.fillColor : "transparent",
    fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth,
    strokeStyle: "solid",
    // Clean lines, like every other shape the app draws.
    roughness: 0,
    opacity: 100,
    // Sharp corners: the curvature comes from the anchors, not the renderer.
    roundness: null,
  };
}

/**
 * Adds a finished path to the board, selected and as one undoable step.
 *
 * The element is a plain Excalidraw `line`, so the pen output is
 * indistinguishable from anything else on the board: it can be resized, moved,
 * recoloured, point-edited and exported, and it survives a save/reload.
 */
export function commitPenPath(
  api: ExcalidrawImperativeAPI,
  anchors: readonly PenAnchor[],
  closed: boolean,
  style: PenStyle,
): boolean {
  const skeleton = penElementSkeleton(anchors, closed, style);
  if (!skeleton) return false;

  const [element] = convertToExcalidrawElements([skeleton], { regenerateIds: true });
  if (!element) return false;

  api.updateScene({
    elements: [...api.getSceneElements(), element],
    appState: { selectedElementIds: { [element.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return true;
}
