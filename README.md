# WhiteyBoardy

A fast, **local-first** whiteboard for macOS. Built with Tauri v2, React,
TypeScript, Vite, Tailwind CSS v4 and the
[Excalidraw](https://github.com/excalidraw/excalidraw) canvas engine (MIT).

Every board lives on your Mac — nothing is uploaded anywhere.

---

## Features

### Local-first multi-board management
- Boards are stored in the app data directory:
  `~/Library/Application Support/com.whiteyboardy.app/`
  - `boards-index.json` — `{ version: 3, folders: [...], boards: [...] }`,
    where each board keeps its `folderId`, its `pinned` flag and its place in the
    library order
  - `board-<id>.json` — one Excalidraw scene per board
- Each board file is an **Excalidraw scene** (`{ type: "excalidraw", version,
  source, elements, appState, files }`) plus the editor state Excalidraw's own
  serializer leaves out — the camera (`zoom`, `scrollX`, `scrollY`) and the
  current pen style. A board therefore reopens exactly where you left it, with
  the pen you were using, and the file stays loadable by Excalidraw itself.
- The file backend is **probed before it is trusted**: the app writes a probe file
  into the app data directory and removes it again. If that fails — or if a
  storage call never answers within 3 s — the library moves to `localStorage` for
  the session and tells you with a toast instead of silently losing work.
  (The app data directory itself is created from Rust at startup, because the
  `fs` plugin's `mkdir(".")` cannot create it — see `src-tauri/src/lib.rs`.)
- Auto-save is debounced at **500 ms** and only when the *document* changes, so
  panning and zooming never re-serialize a board several times a second. A board
  is always written the moment you switch away from it.
- **Switching a board never loses work.** The outgoing board is serialized
  *synchronously* — before the first `await` — and written out before the canvas
  is swapped, so edits made in the same tick as the click are still saved. The
  canvas is only ever mounted with data tagged for the board that is on screen,
  so one board's scene can never be saved into another's file.
- Create boards, switch between them, rename inline (double-click) and delete
  them (the last remaining board is protected). Deleting a board or a folder asks
  for confirmation first (native macOS dialog in the app, `window.confirm` in the
  browser) and removes the board's scene file.
- Scenes are never written for a board that no longer exists, so an in-flight
  autosave can't resurrect a deleted board's file.
- Older `boards-index.json` files are migrated automatically: v1 (a bare array of
  boards) gains the folder wrapper, and v2 entries gain `pinned: false`. Unknown
  folder references are dropped.
- **Boards from the previous canvas engine are never destroyed.** They are tldraw
  snapshots, which this build cannot draw; when one is opened it is copied to
  `board-<id>.legacy-tldraw.json` *before* the empty board is saved over it, and
  a note is logged to the webview console.
- When running in a plain browser (`npm run dev`), storage transparently falls
  back to `localStorage` so the whole UI keeps working.

### Folders, pinning and drag-and-drop organisation
- The sidebar groups boards into **collapsible folders**, with an **Unfiled**
  section for everything at the top level and per-folder board counts. New folders
  come from the sidebar header or from a board's organise menu ("New folder…",
  which moves that board straight in).
- **Drag and drop** a board to reorder it, or drop it onto a folder header, into a
  folder's body, onto the **Pinned** section, or onto the Unfiled area to move it
  there. A drop indicator shows exactly where the board will land, and the
  library's array order *is* the sidebar order (groups filter it without
  reshuffling).
- **Pin** a board with the pin button on its row (or by dragging it onto the
  Pinned section) to lift it into a **Pinned** section at the very top. Pinned
  boards remember their folder, so unpinning puts them straight back. While a
  board is pinned it is listed only in the Pinned section — its folder shows
  "All boards pinned" — and dropping a board into a folder unpins it.
- Boards can also be moved with the organise (⋯) menu, renamed by double-clicking,
  and folders renamed/deleted the same way. Deleting a folder keeps its boards and
  moves them back out to the top level.

### Minimal macOS UI
- Translucent frosted-glass panels (`bg-white/85 backdrop-blur-xl`), hairline
  borders (`border-neutral-200/80`) and high-contrast active states
  (`bg-neutral-900 text-white`).
- Seamless native window: `titleBarStyle: "Overlay"` + `"hiddenTitle": true`,
  with an invisible `h-8` `data-tauri-drag-region` strip across the top so the
  window can be dragged from anywhere along the title bar.
- **Collapsible sidebar** with `pt-10` breathing room for the traffic lights.
  Toggle with the header button or **`⌘ + \`**; a small floating button at the
  top-left reopens it.
- **Collapsible bottom tool dock**: Select, Pencil (freehand), Pen, Line, Eraser,
  Arrow and Text, plus a shape picker, a stroke colour/thickness/fill popover,
  image insertion and the Zen toggle. Excalidraw's own shortcuts (`V`, `P`, `L`,
  `E`, `A`, `T`, `R`, `O`, `D`, `1`–`9`) work anywhere in the app — and `N` picks
  the Pen, which is the app's own tool — and the dock highlights whatever tool is
  active, including when you pick a tool with the keyboard or select an existing
  element. Toggle the dock (Zen mode) with the eye button or **`Tab`** for a
  100 % unobstructed canvas.
- **Zoom HUD** in the bottom-right corner: zoom out, a live zoom percentage that
  resets to 100 %, zoom in, **fit everything on the board**, and **jump to the
  current selection**. Zooming keeps whatever is in the middle of the viewport in
  the middle of the viewport. Hidden in Zen mode like the rest of the chrome.
- Excalidraw's own editor chrome (main menu, tool bar, footer, welcome screen) is
  hidden with CSS scoped to the canvas (`.wb-canvas`); selection handles, the
  in-place text editor and the context menu are untouched. Nothing about
  Excalidraw's code is patched or disabled.

### Shapes, fills and drawing tools
- Tools: Select, Pencil (freehand), **Pen**, Line, Eraser, Arrow and Text.
- **Pen** (`N`) is an anchor-point tool in the Photoshop sense: click to add a
  point, drag while clicking to bend the segment into a curve through that point
  (hold `Option` while dragging for a corner on the incoming side, hold `Shift` to
  snap the handle to 45°), click the first point to close the path, `Enter` or a
  double-click to finish it open, `Backspace` to step back a point and `Esc` to
  throw the path away. It is built as an Excalidraw **custom tool**, so the engine
  itself is untouched: the finished path is an ordinary linear element, which
  means fills, resizing, point editing (⌘-double-click), serialization and export
  all work exactly as they do for everything else. The path in progress is drawn
  by the app itself and never enters the scene, so a half-drawn path cannot be
  saved, undone or carried into another board.
- **Native shapes** — rectangle, circle (ellipse) and diamond — use Excalidraw's
  own tools, so they drag out to any size.
- **Generated shapes** — half circle, quarter circle, equilateral / right /
  obtuse triangle, star, pentagon, hexagon, octagon, trapezoid, rhombus, cloud,
  heart, cross box and check box — are Excalidraw **linear elements** whose
  points describe a closed outline (the first point is repeated at the end, which
  is also what makes Excalidraw fill them). They keep native stroke colour,
  width, fill, resizing, point editing, serialization and export, and they are
  placed at the middle of the viewport, selected and ready to move. The two-part
  shapes (cross box, check box) are one **group**, so the glyph always moves,
  resizes and rotates with its box.
- **Default strokes are clean lines**: every shape and freehand stroke is written
  with Excalidraw's `roughness: 0` ("architect") and sharp corners, and the pen
  style is applied under anything a saved board carries — so a board always opens
  with clean lines unless it was deliberately saved with sketchy ones.
- **Fill picker** (none / hatched / cross-hatched / solid) applies both to the
  next shape you draw and to any current selection, painted with the current
  stroke colour so one colour picker is enough.

### Images
- **Add image** opens the native macOS open dialog, extends the file-system
  runtime scope for exactly the picked file(s), reads the bytes and adds them to
  the scene with `api.addFiles(...)` + `convertToExcalidrawElements(...)`. Images
  are scaled to at most 900 px on their longest side, cascaded so a multi-file
  drop doesn't stack, and travel inside the board file.
- In the browser preview it falls back to a hidden `<input type="file">`.

### Export pipeline
- Floating top-right export bar (hidden in Zen mode) with a **PNG / PDF**
  toggle.
- **Whole board** — rasterizes the union bounding box of every element with
  `exportToBlob({ mimeType: "image/png", exportPadding: 32, … })` at 2× for a
  crisp Retina image on a white background.
- **Section** — enters a marquee crop mode (crosshair cursor + instruction
  banner, `Esc` to cancel). On pointer-up the screen coordinates are converted
  with `viewportCoordsToSceneCoords(…)`; the board is exported with an invisible
  rectangle stretching its bounds over the requested region, and the resulting
  raster is cropped to exactly that region — so a section can include the empty
  space around (or outside) your drawing.
- PNG bytes are written straight to disk. PDFs pipe the high-DPI PNG data URL
  into `jsPDF` with page dimensions and orientation matching the exported
  region exactly.
- The destination is chosen through Tauri's native macOS `save()` dialog
  (defaulting to `<board-name>.png` / `<board-name>.pdf`) and written with
  `writeFile()` from `@tauri-apps/plugin-fs`.

### Not in this pass (next phase)
- **Tables**, which Excalidraw has no element type for and which therefore have to
  be composed from grouped rectangles plus bound text.
- Deferred shapes: cloud variants beyond the one above, plus any richer
  composition for the cross/check boxes.

---

## Getting started

```bash
npm install
npm run tauri dev      # desktop app with hot reload
npm run dev            # browser preview (localStorage fallback)
npm run build          # type-check + production frontend build
npm run tauri build    # bundled .app / .dmg
```

No licence key, environment file or build flag is required for development or
production.

## Project layout

```
src/
├── App.tsx                  # layout, shortcuts, board lifecycle, canvas wiring
├── main.tsx                 # React entry point
├── styles.css               # Tailwind v4 + Excalidraw + base macOS surface
├── components/
│   ├── BoardSidebar.tsx     # folders, pinning + drag-and-drop board organisation
│   ├── ToolDock.tsx         # tools, shape picker, colour/thickness/fill, insert
│   ├── ZoomHud.tsx          # bottom-right zoom & navigation HUD
│   ├── ExportBar.tsx        # PNG/PDF toggle, whole board & section export
│   ├── CropOverlay.tsx      # marquee section selection
│   ├── PenOverlay.tsx       # the pen tool's in-progress path + anchors
│   └── Toast.tsx            # transient status messages
├── hooks/
│   └── usePenTool.ts        # pen state machine: anchors, handles, closing, keys
└── lib/
    ├── storage.ts           # AppData persistence (verified backend + fallback)
    ├── scene.ts             # scene ⇄ file serialization, board defaults
    ├── export.ts            # PNG / PDF export pipeline
    ├── shapes.ts            # shape catalog + generated (linear) shapes
    ├── pen.ts               # pen geometry: anchors → sampled linear element
    ├── insert.ts            # image insertion from the device
    └── palette.ts           # stroke colour, thickness & fill options

src-tauri/
├── tauri.conf.json          # 1280×820 window, overlay title bar
├── capabilities/default.json
└── src/lib.rs               # app-data dir creation + `allow_export_path` / `allow_import_path` fs-scope commands
```

---

## Permissions

`src-tauri/capabilities/default.json` grants:

| Permission | Why |
| --- | --- |
| `core:default` | baseline app APIs |
| `core:window:allow-start-dragging` | the `data-tauri-drag-region` title bar |
| `dialog:default` | native `save()` and `open()` dialogs |
| `dialog:allow-confirm` | the "are you sure you want to delete…" prompt |
| `fs:default` | create + read the application directories |
| `fs:allow-appdata-read-recursive` | read `boards-index.json` / `board-<id>.json` |
| `fs:allow-appdata-write-recursive` | write and delete board files |

> **Note on permission names.** The originally specified identifiers
> `fs:allow-app-data-read-recursive` / `fs:allow-app-data-write-recursive` do not
> exist in `tauri-plugin-fs` v2 — the real identifiers are
> `fs:allow-appdata-read-recursive` and `fs:allow-appdata-write-recursive`
> (no hyphen in `appdata`). These are the ones used above; the Tauri CLI
> validates every identifier at build time.
>
> `dialog:default` intentionally does **not** include `confirm`, so
> `dialog:allow-confirm` is granted separately for delete confirmations.

Exports and image imports can read/write anywhere the user chooses. Instead of
shipping a blanket wildcard scope, the app asks the user for a path with a native
dialog and then hands that single path to a Rust command —
`allow_export_path` for exports, `allow_import_path` for images — which adds only
that file to the file-system plugin's runtime scope
(`FsExt::fs_scope().allow_file(…)`).

## Canvas engine

The canvas is [Excalidraw](https://github.com/excalidraw/excalidraw), which is
**MIT licensed**: no key, no watermark, no gate, and nothing about its behaviour
is patched or suppressed. WhiteyBoardy drives it through its documented
imperative API (`updateScene`, `setActiveTool`, `addFiles`, `scrollToContent`,
`exportToBlob`) and hides its chrome with CSS so the app's own macOS UI is the
only UI.

`docs/canvas-engine-migration.md` records what was verified about the engine, how
each previous feature maps onto it, and what is still outstanding.
