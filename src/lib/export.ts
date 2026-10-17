import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { jsPDF } from "jspdf";
import {
  convertToExcalidrawElements,
  exportToBlob,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { isTauriRuntime } from "./storage";

export type ExportFormat = "png" | "pdf";

/** A rectangle in scene coordinates. */
export interface SceneRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportRequest {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  appState: AppState;
  format: ExportFormat;
  /** Used for the default file name offered by the native save dialog. */
  boardName: string;
  /**
   * Scene-space region to export. When omitted, the union bounding box of every
   * element on the board is exported instead.
   */
  region?: SceneRegion;
}

export type ExportOutcome =
  | { status: "saved"; fileName: string; filePath: string }
  | { status: "downloaded"; fileName: string };

/** Thrown when the current board has nothing to rasterize. */
export class EmptyBoardError extends Error {
  constructor() {
    super("There is nothing on this board to export yet.");
    this.name = "EmptyBoardError";
  }
}

/**
 * `EXPORT_SCALE: 2` renders the scene into a Retina-sized raster, so exports
 * stay crisp when they are scaled down into slides and documents.
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

/** Decodes a PNG blob so its pixel size and contents can be read. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the exported image."));
    };
    image.src = url;
  });
}

/**
 * Cuts a sub-rectangle out of a PNG.
 *
 * Excalidraw always exports the bounds of the elements it is given, so a
 * section export is produced by exporting the whole board and then cropping the
 * raster to the region the user dragged.
 */
async function cropImage(
  image: HTMLImageElement,
  source: { x: number; y: number; width: number; height: number },
): Promise<{ blob: Blob; width: number; height: number }> {
  const width = Math.max(1, Math.round(source.width));
  const height = Math.max(1, Math.round(source.height));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the exported image.");

  context.drawImage(
    image,
    Math.round(source.x),
    Math.round(source.y),
    width,
    height,
    0,
    0,
    width,
    height,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not crop the exported image.");
  return { blob, width, height };
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
 * Rasterizes the board (or a scene-space region of it) and writes it out as a
 * PNG or PDF, either through the native save dialog or a browser download.
 */
export async function exportBoard({
  elements,
  files,
  appState,
  format,
  boardName,
  region,
}: ExportRequest): Promise<ExportOutcome> {
  const visible = elements.filter((element) => !element.isDeleted);
  if (visible.length === 0) throw new EmptyBoardError();

  const [minX, minY, maxX, maxY] = getCommonBounds(visible);

  /*
   * An invisible rectangle stretches the exported bounds out to the requested
   * region, so a section can include the empty space around — or outside — the
   * board. `exportBackground` then paints that space with the board's colour.
   */
  const regionElements = region
    ? convertToExcalidrawElements(
        [
          {
            type: "rectangle",
            x: region.x,
            y: region.y,
            width: Math.max(1, region.width),
            height: Math.max(1, region.height),
            opacity: 0,
          },
        ],
        { regenerateIds: true },
      )
    : [];

  const unionMinX = region ? Math.min(minX, region.x) : minX;
  const unionMinY = region ? Math.min(minY, region.y) : minY;
  const unionMaxX = region ? Math.max(maxX, region.x + region.width) : maxX;
  const unionMaxY = region ? Math.max(maxY, region.y + region.height) : maxY;
  const paddedWidth = unionMaxX - unionMinX + EXPORT_PADDING * 2;
  const paddedHeight = unionMaxY - unionMinY + EXPORT_PADDING * 2;

  const rendered = await exportToBlob({
    elements: [...visible, ...regionElements],
    appState: {
      ...appState,
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
      exportScale: EXPORT_SCALE,
    },
    files,
    mimeType: "image/png",
    exportPadding: EXPORT_PADDING,
    getDimensions: (width, height) => ({
      width: width * EXPORT_SCALE,
      height: height * EXPORT_SCALE,
      scale: EXPORT_SCALE,
    }),
  });

  let output = rendered;
  let outputWidth = paddedWidth * EXPORT_SCALE;
  let outputHeight = paddedHeight * EXPORT_SCALE;

  if (region) {
    const image = await loadImage(rendered);
    // Derived from the real raster rather than assumed, so the crop stays exact
    // whatever scale Excalidraw ended up rendering at.
    const pixelScale = image.naturalWidth / paddedWidth;
    const crop = {
      x: (region.x - unionMinX + EXPORT_PADDING) * pixelScale,
      y: (region.y - unionMinY + EXPORT_PADDING) * pixelScale,
      width: region.width * pixelScale,
      height: region.height * pixelScale,
    };
    const cropped = await cropImage(image, crop);
    output = cropped.blob;
    outputWidth = cropped.width;
    outputHeight = cropped.height;
  }

  const baseName = sanitizeFileName(boardName);
  const fileName = `${baseName}.${format}`;

  // Browser dev preview: no filesystem, so fall back to a download.
  if (!isTauriRuntime()) {
    const download =
      format === "png"
        ? output
        : new Blob([await createPdf(output, outputWidth, outputHeight)], {
            type: "application/pdf",
          });
    downloadInBrowser(download, fileName);
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

  if (!filePath) return { status: "cancelled" } as ExportOutcome;

  await allowExportPath(filePath);

  if (format === "png") {
    await writeFile(filePath, new Uint8Array(await output.arrayBuffer()));
  } else {
    await writeFile(filePath, await createPdf(output, outputWidth, outputHeight));
  }

  return {
    status: "saved",
    fileName: fileNameFromPath(filePath, fileName),
    filePath,
  };
}
