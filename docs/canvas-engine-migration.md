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
   there is nothing to migrate; old tldraw snapshot files would be ignored (or a
   one-off converter written if you have boards you care about).
