/**
 * The palette the tool dock exposes, mapped onto the values Excalidraw's app
 * state actually stores (`currentItemStrokeColor`, `currentItemStrokeWidth`,
 * `currentItemFillStyle`, …) so the swatches match the strokes that get drawn.
 *
 * Excalidraw takes arbitrary CSS hex values for element colours, so the names
 * here are only labels for the dock; the hex strings are the source of truth.
 */
export type BoardColorName =
  | "black"
  | "grey"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "light-blue"
  | "blue"
  | "violet"
  | "white";

export interface BoardColor {
  name: BoardColorName;
  label: string;
  hex: string;
}

/**
 * `black` is Excalidraw's own default stroke (`#1e1e1e`) rather than a pure
 * black, so a board opened with no saved style looks identical to a fresh one.
 */
export const BOARD_COLORS: BoardColor[] = [
  { name: "black", label: "Black", hex: "#1e1e1e" },
  { name: "grey", label: "Grey", hex: "#9fa8b2" },
  { name: "red", label: "Red", hex: "#e03131" },
  { name: "orange", label: "Orange", hex: "#e16919" },
  { name: "yellow", label: "Yellow", hex: "#f1ac4b" },
  { name: "green", label: "Green", hex: "#099268" },
  { name: "light-blue", label: "Light blue", hex: "#4ba1f1" },
  { name: "blue", label: "Blue", hex: "#4465e9" },
  { name: "violet", label: "Violet", hex: "#ae3ec9" },
  { name: "white", label: "White", hex: "#ffffff" },
];

export function colorHex(name: BoardColorName): string {
  return BOARD_COLORS.find((color) => color.name === name)?.hex ?? "#1e1e1e";
}

/** The palette entry for a hex colour Excalidraw reported back, if we show it. */
export function colorNameFor(hex: string): BoardColorName | null {
  const wanted = hex.trim().toLowerCase();
  return BOARD_COLORS.find((color) => color.hex.toLowerCase() === wanted)?.name ?? null;
}

/**
 * Excalidraw only ships three stroke widths (`StrokeWidth` is `1 | 2 | 4`), so
 * the dock exposes exactly those.
 */
export type BoardSizeName = "s" | "m" | "l";

export interface BoardSize {
  name: BoardSizeName;
  label: string;
  /** Excalidraw's element `strokeWidth` for this step. */
  strokeWidth: 1 | 2 | 4;
  /** Diameter of the preview dot in pixels. */
  dot: number;
}

export const BOARD_SIZES: BoardSize[] = [
  { name: "s", label: "Thin", strokeWidth: 1, dot: 4 },
  { name: "m", label: "Regular", strokeWidth: 2, dot: 8 },
  { name: "l", label: "Bold", strokeWidth: 4, dot: 12 },
];

export const DEFAULT_SIZE: BoardSizeName = "m";
export const DEFAULT_COLOR: BoardColorName = "black";

export function strokeWidthFor(name: BoardSizeName): 1 | 2 | 4 {
  return BOARD_SIZES.find((size) => size.name === name)?.strokeWidth ?? 2;
}

/** The dock step closest to a stroke width Excalidraw reported back. */
export function sizeNameFor(strokeWidth: number): BoardSizeName {
  let best = BOARD_SIZES[1];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const size of BOARD_SIZES) {
    const distance = Math.abs(size.strokeWidth - strokeWidth);
    if (distance < bestDistance) {
      best = size;
      bestDistance = distance;
    }
  }
  return best.name;
}

/**
 * How a shape is filled.
 *
 * `none` is Excalidraw's transparent background; the other three are its native
 * fill styles, painted with the current stroke colour so one colour picker is
 * enough (the way the dock has always worked).
 */
export type BoardFillName = "none" | "hachure" | "cross-hatch" | "solid";

export const BOARD_FILLS: { name: BoardFillName; label: string }[] = [
  { name: "none", label: "None" },
  { name: "hachure", label: "Hatched" },
  { name: "cross-hatch", label: "Cross-hatched" },
  { name: "solid", label: "Solid" },
];

export const DEFAULT_FILL: BoardFillName = "none";

/** The element background colour that goes with a fill choice. */
export function fillBackgroundFor(fill: BoardFillName, color: BoardColorName): string {
  return fill === "none" ? "transparent" : colorHex(color);
}

/** The dock fill that a stored element/editor fill style represents. */
export function fillNameFor(fillStyle: string, backgroundColor: string): BoardFillName {
  if (backgroundColor === "transparent") return "none";
  switch (fillStyle) {
    case "hachure":
    case "cross-hatch":
    case "solid":
      return fillStyle;
    default:
      // `zigzag` (and anything Excalidraw adds later) is shown as hatched.
      return "hachure";
  }
}
