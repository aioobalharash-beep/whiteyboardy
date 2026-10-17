import {
  compressLegacySegments,
  createShapeId,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultFillStyle,
  type TLDefaultSizeStyle,
  type TLGeoShapeGeoStyle,
  type VecModel,
} from "tldraw";

/**
 * The shapes offered in the tool dock.
 *
 * tldraw ships a rich set of built-in "geo" shapes, but it has no half circle,
 * quarter circle, right triangle or obtuse triangle. Those are generated here as
 * closed tldraw **draw** shapes, which keeps tldraw's native stroke, dash,
 * colour *and fill* rendering (including pattern fills) as well as resize and
 * serialization for free.
 */
export interface ShapeOption {
  id: string;
  label: string;
  /** A preview path drawn in a 24×24 viewBox. */
  preview: string;
  /** Built-in tldraw geo style, drawn by tldraw's own GeoShapeUtil. */
  geo?: TLGeoShapeGeoStyle;
  /** Point generator for shapes tldraw does not ship (closed draw shapes). */
  buildPoints?: (size: number) => VecModel[];
  /** Whether picking this shape places it immediately instead of arming a tool. */
  clickToPlace?: boolean;
}

const arc = (
  from: number,
  to: number,
  steps: number,
  map: (angle: number) => VecModel,
): VecModel[] => {
  const points: VecModel[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(map(from + ((to - from) * i) / steps));
  }
  return points;
};

const TWO_PI = Math.PI * 2;

/** A flat-bottomed semicircle that fills a box that is `size` wide, `size/2` tall. */
function halfCirclePoints(size: number): VecModel[] {
  const radius = size / 2;
  return arc(Math.PI, TWO_PI, 48, (angle) => ({
    x: radius + radius * Math.cos(angle),
    y: radius + radius * Math.sin(angle),
  }));
}

/** A pie-slice quarter circle that fills a `size × size` box. */
function quarterCirclePoints(size: number): VecModel[] {
  const points = arc(0, -Math.PI / 2, 40, (angle) => ({
    x: size * Math.cos(angle),
    y: size + size * Math.sin(angle),
  }));
  // Close the pie through the arc's centre.
  points.push({ x: 0, y: size });
  return points;
}

/**
 * Samples a polygon's perimeter at a fixed spacing.
 *
 * A draw shape's points are rendered through tldraw's freehand smoothing, which
 * blends each point with the running average of the previous ones. That filter
 * works per point, not per unit of distance, so a handful of far-apart vertices
 * gets rounded away entirely. Walking the perimeter with points a few pixels
 * apart keeps convex corners crisp while still rendering as a smooth stroke.
 */
function samplePerimeter(vertices: VecModel[], spacing = 3): VecModel[] {
  const points: VecModel[] = [];
  for (let index = 0; index < vertices.length; index++) {
    const from = vertices[index];
    const to = vertices[(index + 1) % vertices.length];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing));
    // The final vertex of each edge is the first vertex of the next one, so stop
    // one short to avoid duplicate points at the corners.
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      points.push({ x: from.x + dx * t, y: from.y + dy * t });
    }
  }
  return points;
}

/** A right triangle with the right angle in the bottom-left corner. */
function rightTrianglePoints(size: number): VecModel[] {
  return samplePerimeter([
    { x: 0, y: 0 },
    { x: 0, y: size },
    { x: size, y: size },
  ]);
}

/** A scalene triangle whose obtuse angle sits in the bottom-left corner. */
function obtuseTrianglePoints(size: number): VecModel[] {
  return samplePerimeter([
    { x: size * 0.1, y: size },
    { x: size, y: size },
    { x: size * 0.05, y: size * 0.15 },
  ]);
}

export const SHAPE_CATALOG: ShapeOption[] = [
  {
    id: "rectangle",
    label: "Rectangle",
    preview: "M4 6h16v12H4z",
    geo: "rectangle",
  },
  {
    id: "circle",
    label: "Circle",
    preview: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18",
    geo: "ellipse",
  },
  {
    id: "half-circle",
    label: "Half circle",
    preview: "M3 19a9 9 0 0 1 18 0z",
    buildPoints: halfCirclePoints,
    clickToPlace: true,
  },
  {
    id: "quarter-circle",
    label: "Quarter circle",
    preview: "M21 21A18 18 0 0 0 3 3v18z",
    buildPoints: quarterCirclePoints,
    clickToPlace: true,
  },
  {
    id: "equilateral-triangle",
    label: "Equilateral triangle",
    preview: "M12 4l9 16H3z",
    geo: "triangle",
  },
  {
    id: "right-triangle",
    label: "Right triangle",
    preview: "M4 4v16h16z",
    buildPoints: rightTrianglePoints,
    clickToPlace: true,
  },
  {
    id: "obtuse-triangle",
    label: "Obtuse triangle",
    preview: "M4 20h17L3 5z",
    buildPoints: obtuseTrianglePoints,
    clickToPlace: true,
  },
  {
    id: "diamond",
    label: "Diamond",
    preview: "M12 3l9 9l-9 9l-9-9z",
    geo: "diamond",
  },
  {
    id: "star",
    label: "Star",
    preview:
      "M12 3l2.6 6.3l6.8.5l-5.2 4.4l1.6 6.6L12 17.2l-5.8 3.6l1.6-6.6l-5.2-4.4l6.8-.5z",
    geo: "star",
  },
  {
    id: "pentagon",
    label: "Pentagon",
    preview: "M12 3l9 6.5l-3.4 11H6.4L3 9.5z",
    geo: "pentagon",
  },
  {
    id: "hexagon",
    label: "Hexagon",
    preview: "M8 4h8l5 8l-5 8H8l-5-8z",
    geo: "hexagon",
  },
  {
    id: "octagon",
    label: "Octagon",
    preview: "M8 3h8l5 5v8l-5 5H8l-5-5V8z",
    geo: "octagon",
  },
  {
    id: "trapezoid",
    label: "Trapezoid",
    preview: "M5 6h14l2 12H3z",
    geo: "trapezoid",
  },
  {
    id: "rhombus",
    label: "Rhombus",
    preview: "M7 3h10l4 9l-4 9H7l-4-9z",
    geo: "rhombus",
  },
  {
    id: "cloud",
    label: "Cloud",
    preview:
      "M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 9.6A4.2 4.2 0 0 0 7 18z",
    geo: "cloud",
  },
  {
    id: "heart",
    label: "Heart",
    preview:
      "M12 20C5 15 3 10.5 6 8c2.2-1.8 4.6-.6 6 1c1.4-1.6 3.8-2.8 6-1c3 2.5 1 7-6 12z",
    geo: "heart",
  },
  {
    id: "x-box",
    label: "Cross box",
    preview: "M4 6h16v12H4zM7 9l10 6M17 9L7 15",
    geo: "x-box",
  },
  {
    id: "check-box",
    label: "Check box",
    preview: "M4 6h16v12H4zM7 13l3 3l7-8",
    geo: "check-box",
  },
];

export function findShapeOption(id: string): ShapeOption {
  return SHAPE_CATALOG.find((option) => option.id === id) ?? SHAPE_CATALOG[0];
}

/** The order and labels of tldraw's fill styles, as exposed in the dock. */
export const FILL_OPTIONS: { name: TLDefaultFillStyle; label: string }[] = [
  { name: "none", label: "None" },
  { name: "semi", label: "Semi" },
  { name: "solid", label: "Solid" },
  { name: "pattern", label: "Pattern" },
];

export interface ShapeStyle {
  color: TLDefaultColorStyle;
  fill: TLDefaultFillStyle;
  size: TLDefaultSizeStyle;
}

/** Default on-canvas size for a generated shape. */
const GENERATED_SHAPE_SIZE = 200;

/** Shifts a point cloud so its bounding box starts at the origin. */
function normalisePoints(points: VecModel[]): {
  points: VecModel[];
  width: number;
  height: number;
} {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })),
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/**
 * Places one of the generated (non-built-in) shapes at `center`, rendered as a
 * closed tldraw draw shape so it behaves like any other shape on the board.
 */
export function insertGeneratedShape(
  editor: Editor,
  option: ShapeOption,
  style: ShapeStyle,
  center: VecModel,
) {
  if (!option.buildPoints) return null;

  const { points, width, height } = normalisePoints(
    option.buildPoints(GENERATED_SHAPE_SIZE),
  );

  // The new draw shape's segments are stored delta-encoded, so encode the point
  // cloud with tldraw's own helper to stay compatible with the shape schema.
  const [segment] = compressLegacySegments([{ type: "free", points }]);

  const shapeId = createShapeId();

  editor.createShape({
    id: shapeId,
    type: "draw",
    x: center.x - width / 2,
    y: center.y - height / 2,
    props: {
      color: style.color,
      fill: style.fill,
      dash: "solid",
      size: style.size,
      segments: [segment],
      isComplete: true,
      isClosed: true,
      isPen: false,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
    },
  });

  editor.setSelectedShapes([shapeId]);
  editor.setCurrentTool("select");
  return shapeId;
}
