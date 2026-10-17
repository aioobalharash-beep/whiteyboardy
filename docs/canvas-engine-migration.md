# Replacing the canvas engine (tldraw → licence-free)

**Why:** tldraw v5 refuses to run in production without a licence key — five
seconds after launch it replaces its editor with an empty gate. Its licence also
forbids interfering with that enforcement, so the only clean way to ship a
buildable app with no licence at all is to change the canvas engine.

## What is actually engine-specific

| Area | File | Lines | tldraw-specific? |
| --- | --- | --- | --- |
| App shell, editor integration | `src/App.tsx` | 925 | yes (heavily) |
| Board library, folders, pinning, DnD | `src/components/BoardSidebar.tsx` | 591 | **no** |
| Tool dock UI | `src/components/ToolDock.tsx` | 471 | mostly UI, calls editor APIs |
| Table shape | `src/shapes/TableShape.tsx` | 438 | yes (custom shape type) |
| Pen tool | `src/tools/PenTool.ts` | 353 | yes (custom `StateNode` tool) |
| Storage + migration | `src/lib/storage.ts` | 342 | only the snapshot format |
| Shape catalogue / fills | `src/lib/shapes.ts` | 315 | yes (tldraw geo props) |
| PNG/PDF export | `src/lib/export.ts` | 173 | yes (`editor.toImage`) |
| Image insertion | `src/lib/insert.ts` | 110 | only `putExternalContent` |
| Crop overlay, toast, palette | 3 files | 204 | **no** |
| Licence notice + key plumbing | 2 files | 232 | **deleted** (no longer needed) |

Roughly 60% of the editor-facing code is engine-specific; the board library,
organiser, Tauri plumbing, dialogs, crop overlay and palette carry over as-is.

## Engine choice

| | `@excalidraw/excalidraw` 0.18.1 | `fabric` 7.4 |
| --- | --- | --- |
| Licence | **MIT** | **MIT** |
| Gives us | full whiteboard: shapes, arrows + binding, text, freedraw, images, frames, snapping, undo/redo, zoom/pan, export | raw canvas object model: shapes, groups, transform handles, serialisation, brushes |
| We must build | custom tools, bespoke shapes, tables, our chrome | *everything*: tools, selection UX, undo, text editing, arrows/bindings, snapping, export framing |
| Verified API (from the published 0.18.1 types) | `getSceneElements`, `updateScene`, `setActiveTool`, `addFiles`, `onChange`, `onPointerDown/Up`, `UIOptions`, `zenModeEnabled`, and exports `serializeAsJSON`, `restore`, `exportToBlob/Svg`, `convertToExcalidrawElements`, `mutateElement`, `zoomToFitBounds` | `Canvas`, `toJSON/loadFromJSON`, `PencilBrush`, `viewportTransform`, `toDataURL` |

**Recommendation: Excalidraw.** It is a whiteboard, not a drawing primitive, so
selection, arrows with binding, text, snapping and undo come tested; and 0.18.1
already models **host-implemented custom tools** (`{ type: "custom", customType }`
plus `onPointerDown`/`onPointerUp`), which is what the Photoshop-style pen tool
needs. Fabric would mean rebuilding the interaction layer we currently get free.

### Constraints found in 0.18.1 (not in blog posts)

- **No custom element types** (open excalidraw issue #4957) → tables cannot be a
  first-class shape; they must be *composed* elements.
- **No `ui` prop and no `setViewport`** (both are unreleased master). Its own
  toolbar/menu must be hidden with CSS/`zenModeEnabled`, and zoom driven through
  `updateScene({ appState: { zoom, scrollX, scrollY } })`.
- `UIOptions` only covers `canvasActions`, `tools.image`, `dockedSidebarBreakpoint`.
- No triangle / half-circle / quarter-circle elements → our catalogue becomes
  generator functions that emit `line` (multi-point, fillable) or `freedraw`
  elements with computed points.

## Feature mapping

| Today | After | Effort / risk |
| --- | --- | --- |
| Pencil (fast, pressure) | native `freedraw` | trivial, better |
| Arrow | native `arrow` + binding | trivial |
| Rectangle/ellipse/diamond | native tools | trivial |
| Circle / half / quarter circle, right/obtuse/equilateral triangle | generators → `line`/`freedraw` + fill | medium |
| Fill options | `currentItemFillStyle` + element `backgroundColor` | trivial |
| Pen tool (click-to-anchor vector paths, PS-like) | custom tool: pointers → flatten bezier → multi-point `line` | **medium-high**, the main creative work |
| Table (rows/cols, editable cells, resize) | composed rects + container-bound text, grouped; add/remove row/col re-lays out | **medium**, main parity risk |
| Device images | native image element + `addFiles` (native picker reuse) | low |
| Zoom HUD | `getAppState().zoom.value` + `updateScene` | low |
| Export PNG/PDF, section crop | `exportToBlob` + jsPDF; crop = bounding box of marquee | low |
| Boards/folders/pinning, dialogs | unchanged | none |
| Undo/redo, multi-select, text editing | native (this is upside) | none |

## Plan

- **Phase 0 — swap the dependency (½ day).** Add `@excalidraw/excalidraw`, remove
  `tldraw`, delete `license.ts` + `LicenseNotice.tsx` + the `.env` plumbing. Board
  files keep `boards-index.json` + `board-<id>.json`, now holding
  `{ version, engine: "excalidraw", elements, appState, files }`.
- **Phase 1 — working canvas (1–2 days).** `<Excalidraw>` + `excalidrawAPI`; tool
  dock wired to `setActiveTool` and `updateScene` style defaults; zoom HUD; per-board
  debounced autosave via `onChange` + `serializeAsJSON`; load on board switch;
  hide Excalidraw's own chrome.
- **Phase 2 — parity (2–4 days).** Pen tool as a custom tool; catalogue generators
  for the exotic shapes; composed table with add/remove row/col; image insertion;
  section export.
- **Phase 3 — polish + verification (1–2 days).** Clean-line defaults
  (`roughness: 0`), shortcut parity, and the same evidence trail used today: dev
  harness checks plus a packaged-app run that proves create → autosave → file →
  load.

Deliverable after Phase 1: a usable whiteboard with no licence of any kind.
Full parity is the remaining Phases 2–3.

## Regressions to accept or mitigate

1. **Tables are composed, not native** — resizing a table resizes the group rather
   than re-laying out the grid; add/remove row/col buttons do the re-layout.
2. **Look** — Excalidraw defaults to a hand-drawn style; `roughness: 0` gives clean
   lines for parity with today.
3. **Shortcuts/UX** follow Excalidraw's conventions.
4. **Bundle size** grows by ~1.5–2 MB minified.
5. **Stored boards**: the format changes. Nothing ever persisted successfully in a
   packaged build before today, and the dev-harness test boards are cleared, so
   there is nothing to migrate; old tldraw snapshot files are copied to
   `board-<id>.legacy-tldraw.json` when opened, so they are never destroyed, and
   a one-off converter could still be written against those copies.

---

## Status after Phases 0–1 (implemented)

**Phase 0 — dependency swap.** `tldraw` and `@tldraw/tlschema` are gone;
`@excalidraw/excalidraw@0.18.1` (MIT) is in. `license.ts`, `LicenseNotice.tsx`,
`PenTool.ts`, `TableShape.tsx`, `.env.example` and the env plumbing are deleted,
along with the `opener:default` permission and the `tauri-plugin-opener`
dependency that only existed for the licence notice. Verified: the production
bundle contains no licence gate — the only `license` strings in the shipped JS are
Excalidraw's "publish library" copy and a font-metadata field.

**Phase 1 — working canvas.** `App.tsx` mounts an uncontrolled
`<Excalidraw key={boardId} initialData={…} handleKeyboardGlobally />`, and:
- the dock drives `setActiveTool` / `updateScene`, and follows the editor back
  (tool, stroke colour, width and fill all sync from `onChange`, so keyboard
  shortcuts and element selection update the dock);
- shapes are Excalidraw's native rectangle/ellipse/diamond tools plus generated
  closed `line` elements (first point repeated so `isPathALoop` fills them), all
  with `roughness: 0`;
- autosave is a 500 ms debounce that fires only when the document changes, with
  the scene serialized synchronously before the first `await`, a captured board id
  and a live-board check, plus a forced save on every board switch and on
  `beforeunload`/`visibilitychange`;
- the canvas only ever mounts with data tagged for the on-screen board, so a
  board's first change notification can never be written into its successor;
- `lib/scene.ts` writes the file itself: Excalidraw's scene plus the camera and
  pen style that Excalidraw's own `serializeAsJSON` deliberately drops
  (`cleanAppStateForExport` keeps neither), so a board reopens where you left it.
  Legacy/foreign files are backed up rather than overwritten;
- the zoom HUD polls the API (200 ms) and recomputes `scrollX/scrollY` so zooming
  holds the viewport centre;
- Excalidraw's chrome (`.App-menu_top`, `.App-toolbar-container`,
  `.layer-ui__wrapper__footer`, `.layer-ui__wrapper__top-right`,
  `.welcome-screen-center`, …) is hidden with CSS scoped to `.wb-canvas`. Nothing
  in the engine is patched.

**Verified in the dev harness** (browser, `localStorage` backend): canvas mounts
and stays live; dock → tool sync both ways; style changes apply to the next shape
*and* to a selection; the shape catalogue places closed loops that really fill
(read back pixel-for-pixel from the static canvas); zoom HUD reads and changes the
zoom around the viewport centre; board creation, switching, per-board autosave,
reload-with-camera-and-style and delete all work; a seeded legacy tldraw board is
copied to `…legacy-tldraw` before its file is replaced.

**Verified in the packaged app** (`npm run tauri build`, running from
`WhiteyBoardy.app`, app data in
`~/Library/Application Support/com.whiteyboardy.app/`):

- a seeded Excalidraw scene (two closed `line` shapes plus an image with its
  binary) loaded and was written back with the same three elements, the same
  image file and the camera and pen style intact (`zoom {"value": 2}`,
  `scrollX: -100`, `scrollY: -50`, `currentItemStrokeColor: "#e03131"`,
  `currentItemStrokeWidth: 4`) — load, serialization and the file backend work
  end to end;
- a board with no file yet opens empty and writes an empty scene;
- the leftover tldraw snapshot in the app data directory was copied to
  `board-<id>.legacy-tldraw.json` (byte-identical, still `{document, session}`)
  before the empty scene was saved over the original;
- a throwaway self-test (added, run, then removed) sampled the real renderer in
  the packaged build: at 270 ms it had painted the seeded star (220,665 red
  pixels), at 9,020 ms the canvas was unchanged and still on screen, and a
  synthetic ctrl+wheel zoom at 9.6 s repainted it (242,836 red pixels, different
  bounding box). No licence/gate text appeared in the DOM. The previous engine
  was blank at 5 s in exactly this environment; nothing in this build is time- or
  licence-dependent.

### Still owed by Phase 2

1. **Pen tool** (anchor points, straight/smooth, point editing) as an Excalidraw
   custom tool (`{ type: "custom", customType }` + `onPointerDown`/`onPointerUp`).
   Excalidraw's own **Line** tool is in the dock as the interim.
2. **Tables** — composed from grouped rectangles plus container-bound text, with
   the add/remove row/col controls.
3. **Remaining shape work**: richer cloud/x-box/check-box compositions if wanted.
4. **Section-export polish** — the crop is currently a raster crop of a 2× board
   export (exact, but the region's background outside the board relies on
   `exportBackground`).
5. Optional: flush pending autosaves on window close (today up to ~500 ms of edits
   can be lost if the process is killed mid-debounce).
