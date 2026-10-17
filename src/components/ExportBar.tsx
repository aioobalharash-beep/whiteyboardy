import { Download, FileText, Image as ImageIcon, Scan, X } from "lucide-react";
import type { ExportFormat } from "../lib/export";

interface ExportBarProps {
  visible: boolean;
  format: ExportFormat;
  isExporting: boolean;
  isCropping: boolean;
  onFormatChange: (format: ExportFormat) => void;
  onExportWholeBoard: () => void;
  onExportSection: () => void;
  onCancelSection: () => void;
}

export function ExportBar({
  visible,
  format,
  isExporting,
  isCropping,
  onFormatChange,
  onExportWholeBoard,
  onExportSection,
  onCancelSection,
}: ExportBarProps) {
  if (!visible) return null;

  const buttonClass =
    "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] font-medium text-neutral-700 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="wb-animate-in fixed top-11 right-4 z-30 flex items-center gap-1 rounded-2xl border border-neutral-200/80 bg-white/85 p-1.5 whitespace-nowrap shadow-lg shadow-neutral-900/5 backdrop-blur-xl">
      <div
        role="group"
        aria-label="Export format"
        className="flex items-center rounded-xl bg-neutral-900/5 p-0.5"
      >
        <button
          type="button"
          onClick={() => onFormatChange("png")}
          aria-pressed={format === "png"}
          className={`flex items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-[12px] font-medium transition-colors ${
            format === "png"
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-neutral-500 hover:text-neutral-800"
          }`}
        >
          <ImageIcon className="h-3.5 w-3.5" aria-hidden />
          PNG
        </button>
        <button
          type="button"
          onClick={() => onFormatChange("pdf")}
          aria-pressed={format === "pdf"}
          className={`flex items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-[12px] font-medium transition-colors ${
            format === "pdf"
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-neutral-500 hover:text-neutral-800"
          }`}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          PDF
        </button>
      </div>

      <span className="mx-0.5 h-6 w-px bg-neutral-200/80" aria-hidden />

      <button
        type="button"
        onClick={onExportWholeBoard}
        disabled={isExporting || isCropping}
        title="Export the whole board"
        className={buttonClass}
      >
        <Download className="h-4 w-4" aria-hidden />
        <span>{isExporting ? "Exporting…" : "Whole board"}</span>
      </button>

      {isCropping ? (
        <button
          type="button"
          onClick={onCancelSection}
          title="Cancel section export"
          className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-neutral-800"
        >
          <X className="h-4 w-4" aria-hidden />
          <span>Cancel</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onExportSection}
          disabled={isExporting}
          title="Export a section of the board"
          className={buttonClass}
        >
          <Scan className="h-4 w-4" aria-hidden />
          <span>Section</span>
        </button>
      )}
    </div>
  );
}
