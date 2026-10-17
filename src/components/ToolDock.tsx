import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  ArrowUpRight,
  Eraser,
  EyeOff,
  ImagePlus,
  MousePointer2,
  Pencil,
  PenLine,
  PenTool as PenToolIcon,
  Shapes,
  Type,
} from "lucide-react";
import type { ToolType } from "@excalidraw/excalidraw/types";
import {
  BOARD_COLORS,
  BOARD_FILLS,
  BOARD_SIZES,
  colorHex,
  type BoardColorName,
  type BoardFillName,
  type BoardSizeName,
} from "../lib/palette";
import { SHAPE_CATALOG, findShapeOption, type ShapeOption } from "../lib/shapes";

/**
 * The tools the dock drives through Excalidraw's `setActiveTool`.
 *
 * "pen" is the app's own tool: it registers with Excalidraw as a custom tool,
 * which is why it is not part of Excalidraw's `ToolType`. Tools that need extra
 * arguments (`image`) are driven by the dock's own handlers instead, so they are
 * not part of this union either.
 */
export type DockToolId = Exclude<ToolType, "image"> | "pen";

const SELECT_TOOL: DockToolId = "selection";
const FREEDRAW_TOOL: DockToolId = "freedraw";
const LINE_TOOL: DockToolId = "line";
const PEN_TOOL: DockToolId = "pen";
const ERASER_TOOL: DockToolId = "eraser";
const ARROW_TOOL: DockToolId = "arrow";
const TEXT_TOOL: DockToolId = "text";

/** Every tool that draws one of the shapes in the shapes panel. */
const SHAPE_TOOLS: DockToolId[] = ["rectangle", "ellipse", "diamond"];

interface DockTool {
  id: DockToolId;
  label: string;
  shortcut: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

/** The shortcut letters match Excalidraw's own key bindings. */
const DOCK_TOOLS: DockTool[] = [
  { id: SELECT_TOOL, label: "Select", shortcut: "V", icon: MousePointer2 },
  { id: FREEDRAW_TOOL, label: "Pencil (freehand)", shortcut: "P", icon: Pencil },
  {
    id: PEN_TOOL,
    label: "Pen (anchors, curves, closable paths)",
    shortcut: "N",
    icon: PenToolIcon,
  },
  { id: LINE_TOOL, label: "Line (click to add points)", shortcut: "L", icon: PenLine },
  { id: ERASER_TOOL, label: "Eraser", shortcut: "E", icon: Eraser },
  { id: ARROW_TOOL, label: "Arrow", shortcut: "A", icon: ArrowUpRight },
  { id: TEXT_TOOL, label: "Text", shortcut: "T", icon: Type },
];

interface ToolDockProps {
  visible: boolean;
  activeToolId: DockToolId;
  shapeId: string;
  color: BoardColorName;
  size: BoardSizeName;
  fill: BoardFillName;
  disabled?: boolean;
  onSelectTool: (toolId: DockToolId) => void;
  onSelectShape: (shapeId: string) => void;
  onSelectColor: (color: BoardColorName) => void;
  onSelectSize: (size: BoardSizeName) => void;
  onSelectFill: (fill: BoardFillName) => void;
  onInsertImage: () => void;
  onToggle: () => void;
}

function ShapePreview({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

/** A small square that visually matches one of Excalidraw's fill styles. */
function FillSwatch({ fill, hex }: { fill: BoardFillName; hex: string }) {
  if (fill === "none") {
    return (
      <span className="h-4 w-4 rounded-[4px] border border-dashed border-neutral-400" />
    );
  }
  if (fill === "solid") {
    return (
      <span
        className="h-4 w-4 rounded-[4px] border border-neutral-300"
        style={{ backgroundColor: hex }}
      />
    );
  }
  return (
    <span
      className="h-4 w-4 rounded-[4px] border border-neutral-300"
      style={{
        backgroundImage: `repeating-linear-gradient(${
          fill === "cross-hatch" ? "45deg" : "-45deg"
        }, ${hex} 0 2px, transparent 2px 4px)`,
      }}
    />
  );
}

export function ToolDock({
  visible,
  activeToolId,
  shapeId,
  color,
  size,
  fill,
  disabled = false,
  onSelectTool,
  onSelectShape,
  onSelectColor,
  onSelectSize,
  onSelectFill,
  onInsertImage,
  onToggle,
}: ToolDockProps) {
  const [panel, setPanel] = useState<"none" | "shapes" | "style">("none");
  const currentShape: ShapeOption = findShapeOption(shapeId);

  // A collapsed dock is Zen mode, so always drop any open popover with it.
  useEffect(() => {
    if (!visible) setPanel("none");
  }, [visible]);

  // Close the shapes panel once another tool becomes active. Comparing against
  // the *previous* tool avoids racing the async tool sync, which would
  // otherwise close the panel the moment a shape button is clicked.
  const previousToolRef = useRef(activeToolId);
  useEffect(() => {
    const previous = previousToolRef.current;
    previousToolRef.current = activeToolId;
    if (panel === "shapes" && SHAPE_TOOLS.includes(previous) && !SHAPE_TOOLS.includes(activeToolId)) {
      setPanel("none");
    }
  }, [panel, activeToolId]);

  if (!visible) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
        <button
          type="button"
          onClick={onToggle}
          title="Show tools (Tab)"
          aria-label="Show tools"
          className="wb-animate-in pointer-events-auto flex items-center gap-2 rounded-2xl border border-neutral-200/80 bg-white/85 px-3.5 py-2 text-[12px] font-medium text-neutral-600 shadow-lg shadow-neutral-900/5 backdrop-blur-xl transition-colors hover:bg-white hover:text-neutral-900"
        >
          <EyeOff className="h-4 w-4" aria-hidden />
          <span>Show tools · Tab</span>
        </button>
      </div>
    );
  }

  const iconButton = (isActive: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded-xl transition-colors disabled:opacity-50 ${
      isActive
        ? "bg-neutral-900 text-white"
        : "text-neutral-600 hover:bg-neutral-900/5 hover:text-neutral-900"
    }`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto relative">
        {panel === "shapes" && (
          <div className="wb-animate-in absolute bottom-full left-1/2 mb-3 w-[262px] -translate-x-1/2 rounded-2xl border border-neutral-200/80 bg-white/90 p-3 shadow-xl shadow-neutral-900/10 backdrop-blur-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
                Shapes
              </span>
              <span className="text-[11px] text-neutral-400">Drag to draw</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {SHAPE_CATALOG.map((option) => {
                const isActive = option.id === shapeId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onSelectShape(option.id);
                      if (!option.tool) setPanel("none");
                    }}
                    title={
                      option.tool
                        ? `${option.label}${
                            option.shortcut ? ` (${option.shortcut})` : ""
                          } — drag on the canvas`
                        : `${option.label} — click to place on the canvas`
                    }
                    aria-label={option.label}
                    aria-pressed={isActive}
                    className={`flex h-9 items-center justify-center rounded-xl transition-colors ${
                      isActive
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-600 hover:bg-neutral-900/5 hover:text-neutral-900"
                    }`}
                  >
                    <ShapePreview d={option.preview} className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {panel === "style" && (
          <div className="wb-animate-in absolute bottom-full left-1/2 mb-3 w-64 -translate-x-1/2 rounded-2xl border border-neutral-200/80 bg-white/90 p-3 shadow-xl shadow-neutral-900/10 backdrop-blur-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
                Stroke
              </span>
              <span className="text-[11px] text-neutral-400">
                {BOARD_COLORS.find((swatch) => swatch.name === color)?.label}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {BOARD_COLORS.map((swatch) => {
                const isActive = swatch.name === color;
                return (
                  <button
                    key={swatch.name}
                    type="button"
                    onClick={() => onSelectColor(swatch.name)}
                    title={swatch.label}
                    aria-label={swatch.label}
                    aria-pressed={isActive}
                    className={`h-7 w-full rounded-lg border transition-transform hover:scale-105 ${
                      isActive
                        ? "border-neutral-900 ring-2 ring-neutral-900/20"
                        : "border-neutral-200"
                    }`}
                    style={{ backgroundColor: swatch.hex }}
                  />
                );
              })}
            </div>

            <div className="mt-4 mb-2 text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
              Thickness
            </div>
            <div className="flex items-center gap-1.5">
              {BOARD_SIZES.map((option) => {
                const isActive = option.name === size;
                return (
                  <button
                    key={option.name}
                    type="button"
                    onClick={() => onSelectSize(option.name)}
                    title={option.label}
                    aria-label={option.label}
                    aria-pressed={isActive}
                    className={`flex h-9 flex-1 items-center justify-center rounded-xl transition-colors ${
                      isActive
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:bg-neutral-900/5 hover:text-neutral-900"
                    }`}
                  >
                    <span
                      className="rounded-full bg-current"
                      style={{ width: option.dot, height: option.dot }}
                    />
                  </button>
                );
              })}
            </div>

            <div className="mt-4 mb-2 text-[11px] font-medium tracking-wider text-neutral-400 uppercase">
              Fill
            </div>
            <div className="flex items-center gap-1.5">
              {BOARD_FILLS.map((option) => {
                const isActive = option.name === fill;
                return (
                  <button
                    key={option.name}
                    type="button"
                    onClick={() => onSelectFill(option.name)}
                    title={option.label}
                    aria-label={`${option.label} fill`}
                    aria-pressed={isActive}
                    className={`flex h-9 flex-1 items-center justify-center rounded-xl transition-colors ${
                      isActive
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500 hover:bg-neutral-900/5 hover:text-neutral-900"
                    }`}
                  >
                    <FillSwatch fill={option.name} hex={colorHex(color)} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="wb-animate-in flex items-center gap-0.5 rounded-2xl border border-neutral-200/80 bg-white/85 p-1.5 shadow-lg shadow-neutral-900/5 backdrop-blur-xl">
          {DOCK_TOOLS.map((tool) => {
            const Icon = tool.icon;
            const isActive = tool.id === activeToolId;
            return (
              <button
                key={tool.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelectTool(tool.id)}
                title={`${tool.label} (${tool.shortcut})`}
                aria-label={tool.label}
                aria-pressed={isActive}
                className={iconButton(isActive)}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </button>
            );
          })}

          <span className="mx-1 h-6 w-px bg-neutral-200/80" aria-hidden />

          <button
            type="button"
            onClick={() =>
              setPanel((open) => (open === "shapes" ? "none" : "shapes"))
            }
            title={`Shape: ${currentShape.label}`}
            aria-label="Shapes"
            aria-expanded={panel === "shapes"}
            className={`flex h-9 items-center gap-1 rounded-xl px-2 transition-colors ${
              SHAPE_TOOLS.includes(activeToolId) || panel === "shapes"
                ? "bg-neutral-900/5 text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-900/5 hover:text-neutral-900"
            }`}
          >
            {SHAPE_TOOLS.includes(activeToolId) ? (
              <ShapePreview d={currentShape.preview} className="h-[18px] w-[18px]" />
            ) : (
              <Shapes className="h-[18px] w-[18px]" aria-hidden />
            )}
          </button>

          <button
            type="button"
            onClick={() => setPanel((open) => (open === "style" ? "none" : "style"))}
            title="Stroke, thickness & fill"
            aria-label="Stroke colour and thickness"
            aria-expanded={panel === "style"}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
              panel === "style"
                ? "border-neutral-900/20 bg-neutral-900/5"
                : "border-transparent hover:bg-neutral-900/5"
            }`}
          >
            <span
              className="h-4 w-4 rounded-full border border-neutral-300"
              style={{ backgroundColor: colorHex(color) }}
            />
          </button>

          <span className="mx-1 h-6 w-px bg-neutral-200/80" aria-hidden />

          <button
            type="button"
            disabled={disabled}
            onClick={onInsertImage}
            title="Add images from your Mac"
            aria-label="Add image"
            className={iconButton(false)}
          >
            <ImagePlus className="h-[18px] w-[18px]" aria-hidden />
          </button>

          <span className="mx-1 h-6 w-px bg-neutral-200/80" aria-hidden />

          <button
            type="button"
            onClick={onToggle}
            title="Zen mode (Tab)"
            aria-label="Enter zen mode"
            className={iconButton(false)}
          >
            <EyeOff className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
