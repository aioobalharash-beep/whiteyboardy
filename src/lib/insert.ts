import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { Editor } from "tldraw";
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

function fileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] || "image";
}

function mimeTypeFor(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Drops the given image files onto the canvas at its centre. Handing the files
 * to tldraw's own external-content pipeline means it creates the image assets,
 * keeps the aspect ratio and selects the new shape, exactly like a paste.
 */
function placeFiles(editor: Editor, files: File[]): number {
  if (files.length === 0) return 0;
  const point = editor.getViewportPageBounds().center;
  editor.putExternalContent({ type: "files", files, point });
  return files.length;
}

/** Browser fallback: picks files with a hidden `<input type="file">`. */
function pickInBrowser(editor: Editor): Promise<number> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(placeFiles(editor, files));
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
export async function insertImagesFromDevice(editor: Editor): Promise<number> {
  if (!isTauriRuntime()) return pickInBrowser(editor);

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

  return placeFiles(editor, files);
}
