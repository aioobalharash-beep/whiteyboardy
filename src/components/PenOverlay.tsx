import { useEffect, useMemo, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PenDraft, PenListener } from "../hooks/usePenTool";
import { penPathPoints, type PenStyle } from "../lib/pen";
import type { Point } from "../lib/shapes";

/**
 * The pen tool's own layer.
 *
 * Excalidraw cannot draw a path that is not in the scene, and putting the
 * work-in-progress into the scene would autosave it, push it onto the undo
 * stack and leave a stray line behind if the app died mid-draw. So the pen
 * paints itself, in scene coordinates projected through the board's camera, and
 * only hands Excalidraw the finished element.
 */
interface PenOverlayProps {
  api: ExcalidrawImperativeAPI | null;
  subscribe: (listener: PenListener) => () => void;
  getDraft: () => PenDraft;
  style: PenStyle;
}

/** The camera, as scene coordinates need it to become layer coordinates. */
interface Viewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

const IDENTITY: Viewport = { zoom: 1, scrollX: 0, scrollY: 0 };

function readViewport(api: ExcalidrawImperativeAPI | null): Viewport {
  if (!api) return IDENTITY;
  const { zoom, scrollX, scrollY } = api.getAppState();
  return { zoom: zoom.value, scrollX, scrollY };
}

function toLayer(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x + viewport.scrollX) * viewport.zoom,
    y: (point.y + viewport.scrollY) * viewport.zoom,
  };
}

function pathOf(points: Point[], viewport: Viewport): string {
  return points
    .map((point, index) => {
      const local = toLayer(point, viewport);
      return `${index === 0 ? "M" : "L"}${local.x.toFixed(2)} ${local.y.toFixed(2)}`;
    })
    .join(" ");
}

/** Half the side of an anchor's square, in screen px. */
const ANCHOR_HALF = 3.5;
/** Radius of a direction handle's dot, in screen px. */
const HANDLE_RADIUS = 3;

const HINT_BASE = "Click to add points · drag to curve";
const HINT_FINISH = "Enter to finish · Esc to cancel";

export function PenOverlay({
  api,
  subscribe,
  getDraft,
  style,
}: PenOverlayProps) {
  const [draft, setDraft] = useState<PenDraft>(getDraft);
  const [viewport, setViewport] = useState<Viewport>(() => readViewport(api));

  // Only this component re-renders while the path grows: the board and the
  // sidebar are untouched by every pointer move.
  useEffect(() => subscribe(setDraft), [subscribe]);

  useEffect(() => {
    setViewport(readViewport(api));
    if (!api) return;
    // Panning and zooming mid-path must move the preview with the board.
    return api.onScrollChange(() => setViewport(readViewport(api)));
  }, [api]);

  const { anchorPoints, committed, live, fill } = useMemo(() => {
    const { anchors, cursor, closing } = draft;
    return {
      anchorPoints: anchors.map((anchor) => toLayer(anchor, viewport)),
      committed:
        anchors.length >= 2 ? pathOf(penPathPoints(anchors), viewport) : "",
      // The dashes carry the segment that has not been placed yet.
      live:
        cursor && anchors.length >= 1
          ? pathOf(penPathPoints(anchors, { cursor }), viewport)
          : "",
      fill: closing
        ? pathOf(penPathPoints(anchors, { closed: true }), viewport)
        : "",
    };
  }, [draft, viewport]);

  if (draft.anchors.length === 0) return null;

  const stroke = style.strokeColor;
  const lineWidth = Math.max(1, style.strokeWidth * viewport.zoom);
  const hint = draft.closing
    ? "Click to close the path"
    : draft.anchors.length === 1
      ? `${HINT_BASE} · ${HINT_FINISH}`
      : `${HINT_BASE} · click the first point to close · ${HINT_FINISH}`;

  return (
    <>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      >
        {fill && style.fillColor && (
          <path d={fill} fill={style.fillColor} fillOpacity={0.3} stroke="none" />
        )}

        {live && (
          <path
            d={live}
            fill="none"
            stroke={stroke}
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={lineWidth}
            opacity={0.55}
          />
        )}

        {committed && (
          <path
            d={committed}
            fill="none"
            stroke={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={lineWidth}
          />
        )}

        {draft.anchors.map((anchor, index) => {
          const at = anchorPoints[index];
          return (
            <g key={`${index}-${anchor.x}-${anchor.y}`}>
              {(["in", "out"] as const).map((side) => {
                const handle = anchor[side];
                if (!handle) return null;
                const tip = toLayer(
                  { x: anchor.x + handle.x, y: anchor.y + handle.y },
                  viewport,
                );
                return (
                  <g key={side}>
                    <line
                      x1={at.x}
                      y1={at.y}
                      x2={tip.x}
                      y2={tip.y}
                      stroke={stroke}
                      strokeWidth={1}
                      opacity={0.6}
                    />
                    <circle
                      cx={tip.x}
                      cy={tip.y}
                      r={HANDLE_RADIUS}
                      fill="white"
                      stroke={stroke}
                      strokeWidth={1}
                    />
                  </g>
                );
              })}
              <rect
                x={at.x - ANCHOR_HALF}
                y={at.y - ANCHOR_HALF}
                width={ANCHOR_HALF * 2}
                height={ANCHOR_HALF * 2}
                fill={draft.closing && index === 0 ? stroke : "white"}
                stroke={stroke}
                strokeWidth={1}
              />
            </g>
          );
        })}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center">
        <span className="rounded-full bg-neutral-900/85 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
          {hint}
        </span>
      </div>
    </>
  );
}
