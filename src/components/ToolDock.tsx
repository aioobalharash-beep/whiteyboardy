import { useEffect, useState, type ComponentType } from "react";
import {
  ArrowUpRight,
  Eraser,
  EyeOff,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from "lucide-react";
import {
  BOARD_COLORS,
  BOARD_SIZES,
  colorHex,
  type BoardColorName,
  type BoardSizeName,
} from "../lib/palette";

interface DockTool {
  id: string;
  label: string;
  shortcut: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const DOCK_TOOLS: DockTool[] = [
  { id: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { id: "draw", label: "Freehand draw", shortcut: "D", icon: Pencil },
  { id: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
  { id: "geo", label: "Rectangle", shortcut: "R", icon: Square },
  { id: "arrow", label: "Arrow", shortcut: "A", icon: ArrowUpRight },
  { id: "text", label: "Text", shortcut: "T", icon: Type },
];

interface ToolDockProps {
  visible: boolean;
  activeToolId: string;
  color: BoardColorName;
  size: BoardSizeName;
  disabled?: boolean;
  onSelectTool: (toolId: string) => void;
  onSelectColor: (color: BoardColorName) => void;
  onSelectSize: (size: BoardSizeName) => void;
  onToggle: () => void;
}

export function ToolDock({
  visible,
  activeToolId,
  color,
  size,
  disabled = false,
  onSelectTool,
  onSelectColor,
  onSelectSize,
  onToggle,
}: ToolDockProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // A collapsed dock is Zen mode, so always drop the style popover with it.
  useEffect(() => {
    if (!visible) setPickerOpen(false);
  }, [visible]);

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

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto relative">
        {pickerOpen && (
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
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors disabled:opacity-50 ${
                  isActive
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-900/5 hover:text-neutral-900"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </button>
            );
          })}

          <span className="mx-1 h-6 w-px bg-neutral-200/80" aria-hidden />

          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            title="Stroke colour & thickness"
            aria-label="Stroke colour and thickness"
            aria-expanded={pickerOpen}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
              pickerOpen
                ? "border-neutral-900/20 bg-neutral-900/5"
                : "border-transparent hover:bg-neutral-900/5"
            }`}
          >
            <span
              className="h-4 w-4 rounded-full border border-neutral-300"
              style={{ backgroundColor: colorHex(color) }}
            />
          </button>

          <button
            type="button"
            onClick={onToggle}
            title="Zen mode (Tab)"
            aria-label="Enter zen mode"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-600 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900"
          >
            <EyeOff className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
