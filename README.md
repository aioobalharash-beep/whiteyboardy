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
  - `boards-index.json` — `[{ id, name, updatedAt }]`
  - `board-<id>.json` — a tldraw store snapshot per board
- Each snapshot is produced with `getSnapshot(editor.store)` and restored with
  `loadSnapshot(editor.store, snapshot)`.
- Auto-save is debounced at **500 ms** and listens only to user document
  changes: `editor.store.listen(fn, { scope: "document", source: "user" })`.
- Create boards, switch between them, rename inline (double-click) and delete
  them (the last remaining board is protected).
- When running in a plain browser (`npm run dev`), storage transparently falls
  back to `localStorage` so the whole UI keeps working.

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
- **Collapsible bottom tool dock** driving the tldraw `Editor`: Select, Freehand
  draw, Eraser, Rectangle, Arrow and Text, plus a stroke colour & thickness
  picker. Toggle it (Zen mode) with the eye button or **`Tab`** for a 100 %
  unobstructed canvas.
- tldraw's own editing chrome is completely hidden with `<Tldraw hideUi />`
  (only the licence watermark remains — see the licensing note below).

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

## Project layout

```
src/
├── App.tsx                  # layout, shortcuts, board lifecycle, export wiring
├── main.tsx                 # React entry point
├── styles.css               # Tailwind v4 + tldraw + base macOS surface
├── components/
│   ├── BoardSidebar.tsx     # collapsible board list (create / rename / delete)
│   ├── ToolDock.tsx         # floating tool pill + stroke picker
│   ├── ExportBar.tsx        # PNG/PDF toggle, whole board & section export
│   ├── CropOverlay.tsx      # marquee section selection
│   └── Toast.tsx            # transient status messages
└── lib/
    ├── storage.ts           # AppData persistence (+ localStorage fallback)
    ├── export.ts            # PNG / PDF export pipeline
    └── palette.ts           # stroke colour & thickness options

src-tauri/
├── tauri.conf.json          # 1280×820 window, overlay title bar
├── capabilities/default.json
└── src/lib.rs               # `allow_export_path` runtime fs-scope command
```

---

## Permissions

`src-tauri/capabilities/default.json` grants:

| Permission | Why |
| --- | --- |
| `core:default` | baseline app APIs |
| `core:window:allow-start-dragging` | the `data-tauri-drag-region` title bar |
| `dialog:default` | native `save()` dialog |
| `fs:default` | create + read the application directories |
| `fs:allow-appdata-read-recursive` | read `boards-index.json` / `board-<id>.json` |
| `fs:allow-appdata-write-recursive` | write and delete board files |

> **Note on permission names.** The originally specified identifiers
> `fs:allow-app-data-read-recursive` / `fs:allow-app-data-write-recursive` do not
> exist in `tauri-plugin-fs` v2 — the real identifiers are
> `fs:allow-appdata-read-recursive` and `fs:allow-appdata-write-recursive`
> (no hyphen in `appdata`). These are the ones used above; the Tauri CLI
> validates every identifier at build time.

Exports can be written anywhere the user chooses. Instead of shipping a blanket
wildcard write scope, the app asks the user for a path with the native save
dialog and then hands that single path to the `allow_export_path` Rust command,
which adds only that file to the file-system plugin's runtime scope
(`FsExt::fs_scope().allow_file(…)`).

## Licensing note

tldraw v5 is free for development. Its watermark and the
`.tl-watermark_SEE-LICENSE` element are **intentionally left visible** in this
project — hiding them with CSS would circumvent tldraw's attribution
requirement for unlicensed builds.

For commercial distribution, supply a tldraw licence key:

```tsx
<Tldraw licenseKey="…" hideUi autoFocus onMount={setEditor} />
```

The licence key removes the watermark legitimately at runtime.
