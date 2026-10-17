import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  type ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import {
  colorHex,
  fillBackgroundFor,
  strokeWidthFor,
  type BoardColorName,
  type BoardFillName,
  type BoardSizeName,
} from "./palette";

/**
 * The shapes offered in the tool dock.
 *
 * Excalidraw ships three closed shape tools — rectangle, ellipse and diamond —
 * plus lines. Everything else the dock offers (half circle, quarter circle, the
 * triangles, star, cloud, …) is generated here as a **closed linear element**
 * whose points describe the outline. Excalidraw fills a linear element when its
 * first and last points meet (`isPathALoop`), so these shapes keep the native
 * stroke colour, width, fill and serialization, exactly like the built-ins.
 */
export interface ShapeOption {
  id: string;
  label: string;
  /** A preview path drawn in a 24×24 viewBox. */
  preview: string;
  /** Excalidraw's own tool for this shape; drag on the canvas to draw it. */
  tool?: "rectangle" | "ellipse" | "diamond";
  /**
   * Outline generator for shapes Excalidraw has no tool for, in a `size × size`
   * box. `strokes` are extra open lines drawn on top (cross box, check box).
   */
  draw?: (size: number) => { outline: Point[]; strokes?: Point[][] };
}

/** A point in a shape's own coordinate space; y grows downwards. */
export interface Point {
  x: number;
  y: number;
}

const TAU = Math.PI * 2;

function arc(
  from: number,
  to: number,
  steps: number,
  map: (angle: number) => Point,
): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index++) {
    points.push(map(from + ((to - from) * index) / steps));
  }
  return points;
}

/**
 * Repeats the first point at the end.
 *
 * Excalidraw only paints a linear element's background when its ends meet, and
 * the closing segment is what draws the shape's straight edge.
 */
function closeLoop(points: Point[]): Point[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) return points;
  return [...points, { ...first }];
}

function boundsOf(points: Point[]): { width: number; height: number } {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** Scales a point cloud so its longest side is `size`, keeping its aspect. */
function fitToSize(points: Point[], size: number): Point[] {
  const { width, height } = boundsOf(points);
  const scale = size / Math.max(width, height);
  return points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
}

/** Shifts a point cloud so its bounding box starts at the origin. */
function normalise(points: Point[]): { points: Point[]; width: number; height: number } {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const shifted = points.map((point) => ({ x: point.x - minX, y: point.y - minY }));
  const { width, height } = boundsOf(shifted);
  return { points: shifted, width, height };
}

/** A flat-bottomed semicircle that fills a box `size` wide and `size/2` tall. */
function halfCircle(size: number): Point[] {
  const radius = size / 2;
  return arc(Math.PI, TAU, 48, (angle) => ({
    x: radius + radius * Math.cos(angle),
    y: radius + radius * Math.sin(angle),
  }));
}

/** A pie slice: the arc from 3 o'clock to 12 o'clock plus the corner. */
function quarterCircle(size: number): Point[] {
  return [
    ...arc(0, -Math.PI / 2, 40, (angle) => ({
      x: size * Math.cos(angle),
      y: size + size * Math.sin(angle),
    })),
    { x: 0, y: size },
  ];
}

/** A triangle with the right angle in the bottom-left corner. */
function rightTriangle(size: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: 0, y: size },
    { x: size, y: size },
  ];
}

/** A scalene triangle whose obtuse angle sits in the bottom-left corner. */
function obtuseTriangle(size: number): Point[] {
  return [
    { x: size * 0.1, y: size },
    { x: size, y: size },
    { x: size * 0.05, y: size * 0.15 },
  ];
}

/** A regular polygon with a vertex at the top. */
function regularPolygon(size: number, sides: number): Point[] {
  const radius = size / 2;
  const centre = size / 2;
  return Array.from({ length: sides }, (_unused, index) => {
    const angle = -Math.PI / 2 + (index * TAU) / sides;
    return {
      x: centre + radius * Math.cos(angle),
      y: centre + radius * Math.sin(angle),
    };
  });
}

/** A five-pointed star. */
function star(size: number): Point[] {
  const outer = size / 2;
  const inner = outer * 0.42;
  const centre = size / 2;
  return Array.from({ length: 10 }, (_unused, index) => {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return {
      x: centre + radius * Math.cos(angle),
      y: centre + radius * Math.sin(angle),
    };
  });
}

/** A heart from the classic parametric curve, flipped for a y-down canvas. */
function heart(size: number): Point[] {
  const steps = 64;
  const raw: Point[] = [];
  for (let index = 0; index < steps; index++) {
    const t = (index / steps) * TAU;
    raw.push({
      x: 16 * Math.sin(t) ** 3,
      y: -(
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t)
      ),
    });
  }
  return fitToSize(raw, size);
}

/**
 * A cloud: the outer edge of four overlapping circles, traced by shooting a ray
 * out of the cloud's middle and keeping the furthest intersection.
 */
function cloud(size: number): Point[] {
  const circles = [
    { x: 0.36, y: 0.42, r: 0.26 },
    { x: 0.64, y: 0.4, r: 0.24 },
    { x: 0.48, y: 0.62, r: 0.3 },
    { x: 0.26, y: 0.66, r: 0.18 },
  ];
  const centre = { x: 0.46, y: 0.5 };
  const steps = 96;
  const points: Point[] = [];

  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * TAU;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let reach = 0;
    for (const circle of circles) {
      const ox = circle.x - centre.x;
      const oy = circle.y - centre.y;
      const b = ox * dx + oy * dy;
      const discriminant = b * b - (ox * ox + oy * oy - circle.r * circle.r);
      if (discriminant <= 0) continue;
      reach = Math.max(reach, b + Math.sqrt(discriminant));
    }
    points.push({
      x: (centre.x + dx * reach) * size,
      y: (centre.y + dy * reach) * size,
    });
  }

  return points;
}

/** A square outline, used by the two checkbox shapes. */
function square(size: number, inset = 0): Point[] {
  const from = inset * size;
  const to = size - from;
  return [
    { x: from, y: from },
    { x: to, y: from },
    { x: to, y: to },
    { x: from, y: to },
  ];
}

/** Falls back to a plain rectangle if a generator ever returns too few points. */
const EMPTY: Point[] = square(1);

export const SHAPE_CATALOG: ShapeOption[] = [
  { id: "rectangle", label: "Rectangle", preview: "M4 6h16v12H4z", tool: "rectangle" },
  {
    id: "circle",
    label: "Circle",
    preview: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18",
    tool: "ellipse",
  },
  { id: "diamond", label: "Diamond", preview: "M12 3l9 9l-9 9l-9-9z", tool: "diamond" },
  {
    id: "half-circle",
    label: "Half circle",
    preview: "M3 19a9 9 0 0 1 18 0z",
    draw: (size) => ({ outline: halfCircle(size) }),
  },
  {
    id: "quarter-circle",
    label: "Quarter circle",
    preview: "M21 21A18 18 0 0 0 3 3v18z",
    draw: (size) => ({ outline: quarterCircle(size) }),
  },
  {
    id: "equilateral-triangle",
    label: "Equilateral triangle",
    preview: "M12 4l9 16H3z",
    draw: (size) => ({
      outline: [
        { x: size / 2, y: 0 },
        { x: size, y: (size * Math.sqrt(3)) / 2 },
        { x: 0, y: (size * Math.sqrt(3)) / 2 },
      ],
    }),
  },
  {
    id: "right-triangle",
    label: "Right triangle",
    preview: "M4 4v16h16z",
    draw: (size) => ({ outline: rightTriangle(size) }),
  },
  {
    id: "obtuse-triangle",
    label: "Obtuse triangle",
    preview: "M4 20h17L3 5z",
    draw: (size) => ({ outline: obtuseTriangle(size) }),
  },
  { id: "star", label: "Star", preview: "M12 3l2.6 6.3l6.8.5l-5.2 4.4l1.6 6.6L12 17.2l-5.8 3.6l1.6-6.6l-5.2-4.4l6.8-.5z", draw: (size) => ({ outline: star(size) }) },
  {
    id: "pentagon",
    label: "Pentagon",
    preview: "M12 3l9 6.5l-3.4 11H6.4L3 9.5z",
    draw: (size) => ({ outline: regularPolygon(size, 5) }),
  },
  {
    id: "hexagon",
    label: "Hexagon",
    preview: "M8 4h8l5 8l-5 8H8l-5-8z",
    draw: (size) => ({ outline: regularPolygon(size, 6) }),
  },
  {
    id: "octagon",
    label: "Octagon",
    preview: "M8 3h8l5 5v8l-5 5H8l-5-5V8z",
    draw: (size) => ({ outline: regularPolygon(size, 8) }),
  },
  {
    id: "trapezoid",
    label: "Trapezoid",
    preview: "M5 6h14l2 12H3z",
    draw: (size) => ({
      outline: [
        { x: size * 0.2, y: 0 },
        { x: size * 0.8, y: 0 },
        { x: size, y: size },
        { x: 0, y: size },
      ],
    }),
  },
  {
    id: "rhombus",
    label: "Rhombus",
    preview: "M7 3h10l4 9l-4 9H7l-4-9z",
    draw: (size) => ({
      outline: [
        { x: size * 0.25, y: 0 },
        { x: size * 0.75, y: 0 },
        { x: size, y: size / 2 },
        { x: size * 0.75, y: size },
        { x: size * 0.25, y: size },
        { x: 0, y: size / 2 },
      ],
    }),
  },
  {
    id: "cloud",
    label: "Cloud",
    preview:
      "M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 9.6A4.2 4.2 0 0 0 7 18z",
    draw: (size) => ({ outline: cloud(size) }),
  },
  {
    id: "heart",
    label: "Heart",
    preview:
      "M12 20C5 15 3 10.5 6 8c2.2-1.8 4.6-.6 6 1c1.4-1.6 3.8-2.8 6-1c3 2.5 1 7-6 12z",
    draw: (size) => ({ outline: heart(size) }),
  },
  {
    id: "x-box",
    label: "Cross box",
    preview: "M4 6h16v12H4zM7 9l10 6M17 9L7 15",
    draw: (size) => ({
      outline: square(size),
      strokes: [
        [
          { x: size * 0.25, y: size * 0.25 },
          { x: size * 0.75, y: size * 0.75 },
        ],
        [
          { x: size * 0.75, y: size * 0.25 },
          { x: size * 0.25, y: size * 0.75 },
        ],
      ],
    }),
  },
  {
    id: "check-box",
    label: "Check box",
    preview: "M4 6h16v12H4zM7 13l3 3l7-8",
    draw: (size) => ({
      outline: square(size),
      strokes: [
        [
          { x: size * 0.24, y: size * 0.54 },
          { x: size * 0.44, y: size * 0.74 },
          { x: size * 0.78, y: size * 0.28 },
        ],
      ],
    }),
  },
];

export function findShapeOption(id: string): ShapeOption {
  return SHAPE_CATALOG.find((option) => option.id === id) ?? SHAPE_CATALOG[0];
}

export interface ShapeStyle {
  color: BoardColorName;
  fill: BoardFillName;
  size: BoardSizeName;
}

/** Default on-canvas size for a generated shape. */
const GENERATED_SHAPE_SIZE = 200;

/**
 * Turns a point cloud into a closed linear element, positioned so its bounding
 * box is centred on `centre`.
 */
function outlineElement(
  loop: Point[],
  style: ShapeStyle,
  centre: Point,
  fill: boolean,
): ExcalidrawElementSkeleton {
  const { points, width, height } = normalise(closeLoop(loop));
  return {
    type: "line",
    x: centre.x - width / 2,
    y: centre.y - height / 2,
    width,
    height,
    points: points.map((point) => [point.x, point.y] as [number, number]),
    strokeColor: colorHex(style.color),
    backgroundColor: fill
      ? fillBackgroundFor(style.fill, style.color)
      : "transparent",
    fillStyle: style.fill === "none" ? "solid" : style.fill,
    strokeWidth: strokeWidthFor(style.size),
    strokeStyle: "solid",
    // Clean, straight lines: no sketchy wobble.
    roughness: 0,
    opacity: 100,
    // Sharp corners rather than Excalidraw's rounded default.
    roundness: null,
  };
}

/** Builds the Excalidraw elements for one of the generated shapes. */
export function buildShapeElements(
  option: ShapeOption,
  style: ShapeStyle,
  centre: Point,
): ExcalidrawElementSkeleton[] {
  const drawn = option.draw?.(GENERATED_SHAPE_SIZE);
  if (!drawn) return [];

  const elements = [
    outlineElement(drawn.outline.length >= 3 ? drawn.outline : EMPTY, style, centre, true),
  ];

  // Extra strokes (the glyph inside a cross box or check box) keep the stroke
  // colour but never a background of their own.
  for (const stroke of drawn.strokes ?? []) {
    elements.push(outlineElement(stroke, style, centre, false));
  }

  return elements;
}

/**
 * Places one of the generated shapes at `centre`, selects it and switches back
 * to the selection tool so it can be moved and resized straight away.
 */
export function insertGeneratedShape(
  api: ExcalidrawImperativeAPI,
  option: ShapeOption,
  style: ShapeStyle,
  centre: Point,
): void {
  const skeletons = buildShapeElements(option, style, centre);
  if (skeletons.length === 0) return;

  const elements = convertToExcalidrawElements(skeletons, { regenerateIds: true });
  const selectedElementIds: Record<string, true> = {};
  for (const element of elements) selectedElementIds[element.id] = true;

  api.updateScene({
    elements: [...api.getSceneElements(), ...elements],
    appState: {
      selectedElementIds,
      activeTool: { type: "selection", lastActiveTool: null, locked: false },
    },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
