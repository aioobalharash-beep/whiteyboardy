import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { viewportCentre } from "./shapes";
import { isTauriRuntime } from "./storage";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "heic",
];

/** Images larger than this are scaled down to keep boards light. */
const MAX_IMAGE_SIZE = 900;

/** How far each image in a multi-file drop is offset from the previous one. */
const CASCADE_OFFSET = 28;

function fileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || "image";
}

function mimeTypeFor(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/** The intrinsic size of an image, so it lands on the board undistorted. */
function naturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || MAX_IMAGE_SIZE,
        height: image.naturalHeight || MAX_IMAGE_SIZE,
      });
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = dataUrl;
  });
}

/** The scene point at the middle of the visible canvas. */
function viewportCentre(api: ExcalidrawImperativeAPI): { x: number; y: number } {
  const { width, height, scrollX, scrollY, zoom } = api.getAppState();
  return {
    x: (width / 2 - scrollX) / zoom.value,
    y: (height / 2 - scrollY) / zoom.value,
  };
}

/**
 * Adds image files to the board, cascaded around the middle of the viewport.
 *
 * Excalidraw keeps image binaries beside the scene (`api.addFiles`) and only
 * references them by id from the elements, which is also how they end up in the
 * saved board file.
 */
async function placeImages(
  api: ExcalidrawImperativeAPI,
  files: File[],
): Promise<number> {
  if (files.length === 0) return 0;

  const centre = viewportCentre(api);
  const binaries: BinaryFileData[] = [];
  const skeletons: ExcalidrawElementSkeleton[] = [];
  let placed = 0;

  for (const file of files) {
    try {
      const dataUrl = await readAsDataUrl(file);
      const size = await naturalSize(dataUrl);
      const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(size.width, size.height));
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      const fileId = `wb-${Date.now().toString(36)}-${placed}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const offset = placed * CASCADE_OFFSET;

      binaries.push({
        id: fileId,
        dataURL: dataUrl,
        mimeType: file.type || mimeTypeFor(file.name),
        created: Date.now(),
      } as unknown as BinaryFileData);

      skeletons.push({
        type: "image",
        x: centre.x - width / 2 + offset,
        y: centre.y - height / 2 + offset,
        width,
        height,
        fileId,
        status: "saved",
        // Clean edges: no sketchy wobble on placed images.
        roughness: 0,
      } as ExcalidrawElementSkeleton);

      placed += 1;
    } catch (error) {
      console.error("[whiteyboardy] could not read an image", file.name, error);
    }
  }

  if (placed === 0) return 0;

  api.addFiles(binaries);
  const elements = convertToExcalidrawElements(skeletons, { regenerateIds: true });
  api.updateScene({
    elements: [...api.getSceneElements(), ...elements],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return placed;
}

/** Browser fallback: picks files with a hidden `<input type="file">`. */
function pickInBrowser(api: ExcalidrawImperativeAPI): Promise<number> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      void placeImages(api, files).then(resolve, (error) => {
        console.error("[whiteyboardy] could not add images", error);
        resolve(0);
      });
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(0);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Adds images from the user's Mac to the current board.
 *
 * The native picker returns absolute paths outside the app data directory, so
 * each chosen file is first added to the fs plugin's runtime scope through the
 * `allow_import_path` command — the file-system plugin is deny-by-default
 * everywhere else.
 */
export async function insertImagesFromDevice(
  api: ExcalidrawImperativeAPI,
): Promise<number> {
  if (!isTauriRuntime()) return pickInBrowser(api);

  const selected = await open({
    title: "Add images to the board",
    multiple: true,
    filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  });

  if (!selected) return 0;
  const paths = Array.isArray(selected) ? selected : [selected];

  const files: File[] = [];
  for (const path of paths) {
    try {
      await invoke("allow_import_path", { path });
      const bytes = await readFile(path);
      const name = fileNameFromPath(path);
      files.push(new File([bytes], name, { type: mimeTypeFor(name) }));
    } catch (error) {
      console.error("[whiteyboardy] could not read an image", path, error);
    }
  }

  return placeImages(api, files);
}
