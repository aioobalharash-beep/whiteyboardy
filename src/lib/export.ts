import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { jsPDF } from "jspdf";
import type { Box, Editor } from "tldraw";
import { isTauriRuntime } from "./storage";

export type ExportFormat = "png" | "pdf";

export interface ExportRequest {
  editor: Editor;
  format: ExportFormat;
  /** Used for the default file name offered by the native save dialog. */
  boardName: string;
  /**
   * Page-space region to export. When omitted the union bounding box of every
   * shape on the current page is exported instead.
   */
  bounds?: Box;
}

export type ExportOutcome =
  | { status: "saved"; fileName: string; filePath: string }
  | { status: "downloaded"; fileName: string }
  | { status: "cancelled" };

/** Thrown when the current page has no shapes to rasterize. */
export class EmptyBoardError extends Error {
  constructor() {
    super("There is nothing on this page to export yet.");
    this.name = "EmptyBoardError";
  }
}

/**
 * `scale: 2` gives us a Retina @2x logical raster; tldraw additionally applies
 * its default device `pixelRatio` for bitmap formats, so exports come out very
 * crisp and scale down cleanly into slides and documents.
 */
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 32;

/** Strips characters that are illegal in file names on macOS. */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "whiteyboardy-board";
}

function fileNameFromPath(filePath: string, fallback: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || fallback;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read the exported image."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Wraps the high-DPI PNG in a single-page PDF whose dimensions and orientation
 * match the exported region exactly.
 */
async function createPdf(
  blob: Blob,
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const dataUrl = await blobToDataUrl(blob);
  const document = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    compress: true,
  });
  document.addImage(dataUrl, "PNG", 0, 0, width, height);
  // `output` is loosely typed; the arraybuffer branch really is an ArrayBuffer.
  const buffer = document.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(buffer);
}

/**
 * The fs plugin is deny-by-default outside of the app data directory. The path
 * the user just picked in the native save dialog is handed to a tiny Rust
 * command that adds exactly that file to the runtime scope.
 */
async function allowExportPath(filePath: string): Promise<void> {
  try {
    await invoke("allow_export_path", { path: filePath });
  } catch (error) {
    // Not fatal: the capability scope may already cover the destination.
    console.warn("[export] could not extend the fs scope for the export path", error);
  }
}

function downloadInBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Rasterizes the board (or a page-space region of it) and writes it out as a
 * PNG or PDF, either through the native save dialog or a browser download.
 */
export async function exportBoard({
  editor,
  format,
  boardName,
  bounds,
}: ExportRequest): Promise<ExportOutcome> {
  const shapeIds = [...editor.getCurrentPageShapeIds()];
  if (shapeIds.length === 0) throw new EmptyBoardError();

  const { blob, width, height } = await editor.toImage(shapeIds, {
    format: "png",
    scale: EXPORT_SCALE,
    background: true,
    padding: EXPORT_PADDING,
    ...(bounds ? { bounds } : {}),
  });

  const baseName = sanitizeFileName(boardName);
  const fileName = `${baseName}.${format}`;

  // Browser dev preview: no filesystem, so fall back to a download.
  if (!isTauriRuntime()) {
    const output =
      format === "png"
        ? blob
        : new Blob([await createPdf(blob, width, height)], { type: "application/pdf" });
    downloadInBrowser(output, fileName);
    return { status: "downloaded", fileName };
  }

  const filePath = await save({
    title: format === "png" ? "Export board as PNG" : "Export board as PDF",
    defaultPath: fileName,
    canCreateDirectories: true,
    filters:
      format === "png"
        ? [{ name: "PNG image", extensions: ["png"] }]
        : [{ name: "PDF document", extensions: ["pdf"] }],
  });

  if (!filePath) return { status: "cancelled" };

  await allowExportPath(filePath);

  if (format === "png") {
    await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
  } else {
    await writeFile(filePath, await createPdf(blob, width, height));
  }

  return {
    status: "saved",
    fileName: fileNameFromPath(filePath, fileName),
    filePath,
  };
}
