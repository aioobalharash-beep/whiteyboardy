/**
 * The subset of tldraw's default palette we expose in the tool dock, mapped to
 * the exact solid colours tldraw's light theme uses so the swatches match the
 * strokes that actually get drawn.
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

export const BOARD_COLORS: BoardColor[] = [
  { name: "black", label: "Black", hex: "#1d1d1d" },
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

/** tldraw's `DefaultSizeStyle` values, in increasing stroke thickness. */
export type BoardSizeName = "s" | "m" | "l" | "xl";

export interface BoardSize {
  name: BoardSizeName;
  label: string;
  /** Diameter of the preview dot in pixels. */
  dot: number;
}

export const BOARD_SIZES: BoardSize[] = [
  { name: "s", label: "Thin", dot: 4 },
  { name: "m", label: "Regular", dot: 8 },
  { name: "l", label: "Bold", dot: 12 },
  { name: "xl", label: "Extra bold", dot: 16 },
];

export function colorHex(name: BoardColorName): string {
  return BOARD_COLORS.find((color) => color.name === name)?.hex ?? "#1d1d1d";
}
