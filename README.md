# WhiteyBoardy

A fast, **local-first** whiteboard for macOS. Built with Tauri v2, React,
TypeScript, Vite, Tailwind CSS v4 and the [tldraw](https://tldraw.dev) canvas
engine.

Every board lives on your Mac — nothing is uploaded anywhere.

---

## Features

### Local-first multi-board management
- Boards are stored in the app data directory:
  `~/Library/Application Support/com.whiteyboardy.app/`
  - `boards-index.json` — `{ version: 3, folders: [...], boards: [...] }`,
    where each board keeps its `folderId`, its `pinned` flag and its place in the
    library order
  - `board-<id>.json` — a tldraw store snapshot per board
- Each snapshot is produced with `getSnapshot(editor.store)` and restored with
  `loadSnapshot(editor.store, snapshot)`.
- The file backend is **probed before it is trusted**: the app creates the app
  data directory, writes a probe file and removes it again. If that fails — or if
  a storage call never answers within 3 s — the library moves to `localStorage`
  for the session and tells you with a toast instead of silently losing work.
  If the app data directory itself cannot be created, the files move into a
  `whiteyboardy/` sub directory of it.
- Auto-save is debounced at **500 ms** and listens only to user document
  changes: `editor.store.listen(fn, { scope: "document", source: "user" })`.
- **Switching a board never loses work.** The outgoing board is snapshotted
  *synchronously* — before the first `await` — and written out before the canvas
  is swapped, so edits made in the same tick as the click are still saved.
- Create boards, switch between them, rename inline (double-click) and delete
  them (the last remaining board is protected). Deleting a board or a folder asks
  for confirmation first (native macOS dialog in the app, `window.confirm` in the
  browser) and removes the board's snapshot file.
- Snapshots are never written for a board that no longer exists, so an in-flight
  autosave can't resurrect a deleted board's file.
- Older `boards-index.json` files are migrated automatically: v1 (a bare array of
  boards) gains the folder wrapper, and v2 entries gain `pinned: false`. Unknown
  folder references are dropped.
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
- **Collapsible bottom tool dock** driving the tldraw `Editor`: Select, Pencil
  (freehand), Pen (lines), Eraser, Arrow and Text, plus a shape picker, a stroke
  colour/thickness/fill popover, pen options, image & table insertion, and the
  Zen toggle. Single-key shortcuts (`V`, `D`, `P`, `E`, `A`, `T`) are routed by
  the app, because hiding tldraw's UI also hides tldraw's shortcut registry.
  Toggle the dock (Zen mode) with the eye button or **`Tab`** for a 100 %
  unobstructed canvas.
- **Zoom HUD** in the bottom-right corner: zoom out, a live zoom percentage that
  resets to 100 %, zoom in, **fit everything on the board**, and **jump to the
  current selection**. Hidden in Zen mode like the rest of the chrome.
- tldraw's own editing chrome is completely hidden with `<Tldraw hideUi />`
  (only the licence watermark remains — see the licensing note below).

### Shapes, fills and drawing tools
- Tools: Select, Pencil (freehand), Pen (lines), Eraser, Arrow and Text.
- **18 shapes** in the picker: rectangle, circle, equilateral triangle, diamond,
  star, pentagon, hexagon, octagon, trapezoid, rhombus, cloud, heart, cross box,
  check box — plus four shapes tldraw does not ship: **half circle, quarter
  circle, right triangle and obtuse triangle**.
- The extra shapes are generated as **closed tldraw `draw` shapes** (via
  `compressLegacySegments`), so they keep native stroke, dash, colour, **fill**,
  resize, serialization and export for free. The polygon perimeters are sampled
  a few pixels apart so tldraw's freehand smoothing keeps their corners sharp.
- **Fill picker** (none / semi / solid / pattern) that applies both to the next
  shape you draw and to any current selection. Pattern fills render tldraw's own
  hash pattern.

### Pen tool (vector paths)
- A dedicated **Pen (lines)** tool sits between the pencil and the eraser. Click
  to drop anchor points and the path trails the pointer with a rubber-band
  segment; click the **first** anchor to close the path, or finish with `Enter`
  or a double-click. `⌫` drops the last anchor and `Esc` throws the path away.
- The pen is a tldraw **state node** (`wb-pen`, `src/tools/PenTool.ts`) that
  writes into a real `line` shape, so a finished path is **point-editable** —
  drag its vertex handles, or restyle it like anything else — and it resizes,
  serializes, persists and exports with native behaviour.
- Its **Straight / Smooth** toggle in the pen panel switches between straight
  segments (`spline: "line"`) and a smooth curve through the anchors
  (`spline: "cubic"`), and retunes the current selection too.
- It is deliberately kept apart from the other two line-ish tools: **Pencil
  (freehand)** is tldraw's pressure-scribble tool and **Arrow** stays a
  connector, while the pen is the anchor-point vector tool.
- The tool avoids the trailing "rubber-band" point leaking into the saved shape:
  the pending point is dropped on finish, and anchors closer than ~3 px (for
  example from a finishing double-click) are merged.
- History stays tidy: every anchor and rubber-band update is squashed into a
  **single undo step**, so one `⌘Z` takes the whole path back, while an abandoned
  path (Esc, or a stray single click) is removed with `bailToMark` and never
  becomes an undo step.

### Images
- **Add image** opens the native macOS open dialog, extends the file-system
  runtime scope for exactly the picked file(s), reads the bytes and drops them
  onto the canvas with `editor.putExternalContent({ type: "files", … })`.
- In the browser preview it falls back to a hidden `<input type="file">`.

### Tables
- **Insert table** adds a `wb-table` custom shape: a 3×4 grid that can be resized,
  and grown or shrunk with the +/− Row / +/− Col buttons shown while selected.
- Double-click a cell to edit it; `Tab` / `Shift+Tab` and the arrow keys move
  between cells, `Enter` or `Escape` leaves editing.
- Because it is a real tldraw shape it serializes, resizes and **exports** (its
  `toSvg` renders the grid, strokes and text into PNG/PDF exports).

### Export pipeline
- Floating top-right export bar (hidden in Zen mode) with a **PNG / PDF**
  toggle.
- **Whole board** — rasterizes the union bounding box of every shape on the
  current page with
  `editor.toImage(shapeIds, { format: "png", scale: 2, background: true, padding: 32 })`.
- **Section** — enters a marquee crop mode (crosshair cursor + instruction
  banner, `Esc` to cancel). On pointer-up the screen coordinates are converted
  with `editor.screenToPage()`, wrapped in a `new Box(x, y, w, h)` and passed to
  `editor.toImage(...)` as `bounds`.
- PNG bytes are written straight to disk. PDFs pipe the high-DPI PNG data URL
  into `jsPDF` with page dimensions and orientation matching the exported
  region exactly.
- The destination is chosen through Tauri's native macOS `save()` dialog
  (defaulting to `<board-name>.png` / `<board-name>.pdf`) and written with
  `writeFile()` from `@tauri-apps/plugin-fs`.

---

## Getting started

```bash
npm install
npm run tauri dev      # desktop app with hot reload
npm run dev            # browser preview (localStorage fallback)
npm run build          # type-check + production frontend build
npm run tauri build    # bundled .app / .dmg
```

> **Before `npm run tauri build`:** tldraw v5 hides its whole editor five seconds
> after launch in a **production** build that has no valid licence key (see
> [Licensing](#licensing-note)). Copy `.env.example` to `.env`, set
> `VITE_TLDRAW_LICENSE_KEY=…`, and rebuild. Development runs
> (`npm run tauri dev`, `npm run dev`) never need a key.

## Project layout

```
src/
├── App.tsx                  # layout, shortcuts, board lifecycle, export wiring
├── main.tsx                 # React entry point
├── styles.css               # Tailwind v4 + tldraw + base macOS surface
├── components/
│   ├── BoardSidebar.tsx     # folders, pinning + drag-and-drop board organisation
│   ├── ToolDock.tsx         # tools, shape picker, colour/thickness/fill, insert
│   ├── ZoomHud.tsx          # bottom-right zoom & navigation HUD
│   ├── ExportBar.tsx        # PNG/PDF toggle, whole board & section export
│   ├── CropOverlay.tsx      # marquee section selection
│   ├── LicenseNotice.tsx    # explains tldraw's production licence gate
│   └── Toast.tsx            # transient status messages
├── shapes/
│   └── TableShape.tsx       # `wb-table` custom shape (grid editing + SVG export)
├── tools/
│   └── PenTool.ts           # `wb-pen` state node: click-to-anchor vector paths
└── lib/
    ├── storage.ts           # AppData persistence (verified backend + fallback)
    ├── license.ts           # tldraw licence key + gate detection
    ├── export.ts            # PNG / PDF export pipeline
    ├── shapes.ts            # shape catalog, fill options, generated shapes
    ├── insert.ts            # image insertion from the device
    └── palette.ts           # stroke colour & thickness options

src-tauri/
├── tauri.conf.json          # 1280×820 window, overlay title bar
├── capabilities/default.json
└── src/lib.rs               # `allow_export_path` / `allow_import_path` fs-scope commands
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
| `opener:default` | open the tldraw pricing page from the licence notice |

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

## Licensing note

tldraw v5 is free while you develop, but a **production** build needs a licence
key. Without a valid one tldraw does not merely show the watermark — it replaces
its own editor with an empty gate **five seconds after launch**
(`LICENSE_TIMEOUT` in `@tldraw/editor`). The canvas disappears, the tools have
nothing left to act on, and it looks exactly like a crash. Development runs are
never gated: tldraw treats `http://localhost` (`npm run dev`, `npm run tauri dev`)
as development.

Neither the watermark nor the `.tl-watermark_SEE-LICENSE` element is hidden with
CSS — that would circumvent tldraw's attribution requirement.

To build for production, put a key in `.env` (never committed):

```bash
# .env
VITE_TLDRAW_LICENSE_KEY=…
```

`src/lib/license.ts` reads it and passes it to `<Tldraw licenseKey={…}>`. Keys are
available from <https://tldraw.dev/pricing>; the free 100-day trial licence keeps
the watermark visible, and a native-app licence covers the Tauri build. If the
key is missing or invalid, the app shows a `LicenseNotice` explaining what
happened instead of leaving you with a blank canvas.
