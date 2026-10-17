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

---

## Status after Phase 2 (pen tool + grouped shapes)

**The pen.** Phase 2's first item was a pen tool that is genuinely different from
the pencil: anchor points, curves and closable paths, rather than a freehand
stroke. Excalidraw has no path element, no bezier storage and no custom element
types, so the pen is built out of the two hooks the engine does offer — the
`{ type: "custom", customType }` tool and the imperative pointer subscriptions —
and its geometry is *sampled* into an ordinary `line` element.

What the engine does and does not give a custom tool (all read out of the
published 0.18.1 build):

- `api.onPointerDown` / `onPointerUp` fire for **every** tool and, unlike the
  `<Excalidraw onPointerDown>` props, they pass the native event, so the pen
  filters on `activeTool.type === "custom" && customType` and converts with
  `viewportCoordsToSceneCoords(event, appState)`.
- For a custom tool the engine's pointer-down does nothing but reset the cursor,
  and `handleCanvasDoubleClick` bails unless the tool is `selection` — so nothing
  fights the pen for the gesture.
- Space-drag and middle-drag panning return *before* the emitter fires, so
  panning can never place a phantom anchor.
- **An unlocked custom tool is handed back to `selection` after every pointer
  up**, which breaks a click-by-click tool. The pen therefore activates with
  `locked: true` (Excalidraw's own "keep this tool" flag), and every other tool
  is activated with `locked: false` so the flag cannot leak onto them.
- Custom tools get **no cursor** (`setCursorForShape` resets the canvas to
  `auto` on every pointer move), so the pen's crosshair comes from one CSS rule
  scoped to `.wb-canvas.wb-pen-active` rather than fighting the engine per event.
- A custom type is not part of Excalidraw's `ToolType`, so the dock's
  `DockToolId` gained `"pen"` and `syncDock` maps the engine's active tool back
  to it.
- A linear element has to be **normalised**: its `points[0]` must be `[0, 0]`
  with the element's `x`/`y` on that first point. Excalidraw logs
  `Linear element is not normalized` when its point editor meets an element that
  is not, and re-writes such elements the next time the board is loaded. Both the
  pen and the generated shapes now write elements in that form
  (`rebaseOnFirstPoint` in `shapes.ts`). The consequence for geometry code is
  that `x`/`y` is the element's *first point*, not the corner of its box — the
  bounding box has to be taken from the points.

The interaction: click to place an anchor; drag while placing one to bend the
segment through it (symmetric handles, or `Option` to break the incoming side
into a corner, `Shift` to snap a handle to 45°); click the first anchor to close
the path (a drag there curves the join); `Enter` or a double-click to finish it
open; `Backspace` to step back an anchor; `Esc` to throw the path away. A second
`Esc` on an empty path falls through to the engine, which hands the canvas back
to the selection tool — the same thing `Esc` does for Excalidraw's own tools.
Leaving the pen with a path in progress commits it open rather than losing it
(the way switching tools commits a work path), and switching **board** drops it,
because a half-drawn path belongs to the board it was started on.

The work in progress deliberately lives *outside* the scene: anchors, handles and
the rubber band are painted by the app in an SVG layer (`PenOverlay.tsx`) whose
coordinates go through the board camera (kept fresh with `api.onScrollChange`).
Nothing in progress can therefore be autosaved, land on the undo stack, or be
carried into another board, and the finished element is an ordinary linear
element, so stroke colour and width, fills (including hatched and cross-hatched),
resizing, `⌘`-double-click point editing, serialization, export and undo all
behave exactly as they do for the generated shapes.

**Grouped two-part shapes.** The cross box and check box are an outline plus a
glyph; they now share one Excalidraw `groupIds` entry, so the glyph can no longer
be left behind when the shape is moved, resized or rotated.

**Verified in the dev harness** (browser preview, `localStorage` backend,
synthetic pointer and real key input against the live engine):

- the pen activates from the dock button *and* from the new `N` shortcut, the dock
  highlights it, the canvas host gains `.wb-pen-active` and the computed cursor on
  the interactive canvas is `crosshair`;
- three clicks in three separate gestures placed three anchors: the overlay showed
  three anchor squares plus the dashed rubber band, the scene stayed empty, and the
  board file on disk was still empty 900 ms later — well past the 500 ms autosave
  debounce, so a pending path is never persisted;
- the rubber band follows the pointer, and with `Shift` a raw direction of
  (200, 40) snapped to a horizontal endpoint of the same length;
- dragging while placing an anchor produced symmetric handles (two handle lines,
  two dots) and the segment between the anchors was a sampled cubic (44 points for
  that span); `Option`-dragging produced a single outgoing handle (one line, one
  dot), i.e. a corner on the incoming side;
- `Enter` committed an open path: a `line` element of 3 points whose bounding box
  matched the clicked scene points exactly, `roughness: 0`, `roundness: null`, the
  dock's stroke colour and width, `backgroundColor: "transparent"`;
- clicking the first anchor closed the path: 130 points with the first point
  repeated at the end (which is what `isPathALoop` needs), the dock's fill
  (`#e03131`, solid) applied through the style the dock had synced from the
  engine, and 22,897 red pixels read back out of the static canvas — the fill
  really paints;
- `Esc` discarded the draft (overlay gone, scene still empty, pen still active);
  `Backspace` stepped back one anchor (3 → 2); a double-click (`detail === 2`)
  finished an open path as a 2-point element with no fill;
- switching tool mid-path with a real `V` keypress committed the open path and
  left the selection tool active; switching *board* mid-path committed nothing
  anywhere (the old board kept exactly its one element, the new board was empty,
  and the overlay was clear);
- at zoom 1.5 with `scrollX 100` / `scrollY 60` and a 256 px sidebar, a click at
  client (700, 400) committed at scene (196, 207) — the bounding box starts exactly
  there — and zooming mid-path doubled the overlay's coordinates exactly;
- after a reload the committed closed path came back with an identical bounding
  box, the same 94 points, fill, stroke colour and width;
- the check box placed two elements sharing one group id (both selected), and the
  tool returned to selection with `locked: false`;
- `⌘`-double-clicking a pen path entered Excalidraw's own point editing
  (`editingLinearElement.elementId` matched), so pen output stays fully editable;
- every linear element the app writes comes out normalised (`points[0] === [0,0]`
  with `x`/`y` on that point): the generated shapes still land exactly on the
  viewport centre (a half circle's absolute box centre read back as (372, 350) on
  a 744×700 canvas) and still fill (64,772 red pixels), and a closed pen path
  committed 5 points with the first repeated, the dock's `#e03131` solid fill and
  84,072 red pixels on the static canvas. Point-editing a pen path no longer
  makes the engine log `Linear element is not normalized`;
- no console errors or warnings over the whole session (the only warning seen was
  Chrome's note about repeated `getImageData` calls, which came from the harness's
  own pixel sampling).

**Verified in the packaged app** (`npm run tauri build`, `WhiteyBoardy.app`
launched from the bundle, app data in
`~/Library/Application Support/com.whiteyboardy.app/`):

- a seeded board holding exactly what the pen produces — a 9-point closed `line`
  with its first point repeated, `#e03131` solid fill, `roughness: 0`,
  `roundness: null` — plus camera (`zoom 1.5`, `scrollX -40`, `scrollY -25`) and
  pen style (`#1971c2`, `hachure`, width 4) loaded and was written back with the
  absolute geometry identical point for point, the fill, stroke, camera and style
  preserved, and the library index unchanged;
- pressing `N` in the shipped bundle activates the same custom tool the dev
  harness drives (both were checked with the same in-page assertions);
- deleting a board's file and launching the app recreated the very scene the app
  writes for a board with no file, and the app data directory was left exactly as
  it was found.

### Still owed

1. **Tables** — composed from grouped rectangles plus container-bound text, with
   add/remove row/column controls (Excalidraw has no table element).
2. **Remaining shape work**: richer cloud variants, and any further composition
   polish for the cross/check boxes.
3. **Section-export polish** — the crop is currently a raster crop of a 2× board
   export (exact, but the region's background outside the board relies on
   `exportBackground`).
4. Optional: flush pending autosaves on window close (today up to ~500 ms of edits
   can be lost if the process is killed mid-debounce).
5. Not machine-verifiable by the assistant: the native macOS image-open and
   save-confirm dialogs need a human at the keyboard (OS automation is unavailable
   in this environment).
