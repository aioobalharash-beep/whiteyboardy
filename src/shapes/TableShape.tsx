import {
  DefaultColorStyle,
  DefaultFillStyle,
  DefaultSizeStyle,
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  createShapeId,
  getColorValue,
  useValue,
  type Editor,
  type RecordProps,
  type SvgExportContext,
  type TLBaseShape,
  type TLDefaultColorStyle,
  type TLDefaultFillStyle,
  type TLDefaultSizeStyle,
  type TLResizeInfo,
  type TLShapeId,
  type VecModel,
} from "tldraw";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ShapeStyle } from "../lib/shapes";

export const TABLE_SHAPE_TYPE = "wb-table" as const;

export interface TableShapeProps {
  w: number;
  h: number;
  rows: number;
  cols: number;
  /** Row-major cell contents; length is always `rows * cols`. */
  cells: string[];
  color: TLDefaultColorStyle;
  fill: TLDefaultFillStyle;
  size: TLDefaultSizeStyle;
}

export type TLTableShape = TLBaseShape<typeof TABLE_SHAPE_TYPE, TableShapeProps>;

const DEFAULT_ROWS = 3;
const DEFAULT_COLS = 4;
const MIN_ROWS = 1;
const MIN_COLS = 1;
const MAX_ROWS = 30;
const MAX_COLS = 20;

const FONT_SIZE: Record<TLDefaultSizeStyle, number> = {
  s: 12,
  m: 14,
  l: 18,
  xl: 24,
};

const cellIndex = (cols: number, row: number, col: number) => row * cols + col;
const emptyGrid = (rows: number, cols: number) => Array.from({ length: rows * cols }, () => "");

/** Grows or shrinks the cell grid, preserving the contents that still fit. */
function resizedCells(
  cells: string[],
  rows: number,
  cols: number,
  nextRows: number,
  nextCols: number,
): string[] {
  const next = emptyGrid(nextRows, nextCols);
  const rowCount = Math.min(rows, nextRows);
  const colCount = Math.min(cols, nextCols);
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      next[cellIndex(nextCols, row, col)] = cells[cellIndex(cols, row, col)] ?? "";
    }
  }
  return next;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function TableComponent({ shape, editor }: { shape: TLTableShape; editor: Editor }) {
  const { rows, cols, cells, color, fill, size } = shape.props;
  const [editing, setEditing] = useState<number | null>(null);
  const editingRef = useRef<HTMLDivElement | null>(null);

  const isSelected = useValue(
    `table-selected-${shape.id}`,
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id],
  );

  const theme = editor.getCurrentTheme().colors[editor.getColorMode()];
  const strokeColor = getColorValue(theme, color, "solid");
  const background =
    fill === "none" ? "transparent" : getColorValue(theme, color, "semi");

  // Seed the editable cell's text once, then leave it uncontrolled so React
  // never rewrites the DOM (which would reset the caret while typing).
  useEffect(() => {
    const element = editingRef.current;
    if (editing === null || !element) return;
    element.innerText = cells[editing] ?? "";
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commitCell = (index: number, value: string) => {
    if ((cells[index] ?? "") === value) return;
    const next = cells.slice();
    next[index] = value;
    editor.updateShape({ id: shape.id, type: shape.type, props: { cells: next } });
  };

  const stop = (
    event: PointerEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
    editor.markEventAsHandled(event.nativeEvent);
  };

  const handleCellKeyDown = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
    stop(event);
    const row = Math.floor(index / cols);
    const col = index % cols;

    if (event.key === "Escape") {
      setEditing(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setEditing(null);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      const nextIndex = index + delta;
      if (nextIndex >= 0 && nextIndex < rows * cols) {
        commitCell(index, event.currentTarget.innerText);
        setEditing(nextIndex);
      }
      return;
    }
    // Arrow keys only leave the cell when the caret is at the edge.
    const atStart =
      window.getSelection()?.anchorOffset === 0 && event.currentTarget.innerText
        ? (window.getSelection()?.anchorOffset ?? 0) === 0
        : true;
    if (event.key === "ArrowUp" && row > 0 && atStart) {
      event.preventDefault();
      commitCell(index, event.currentTarget.innerText);
      setEditing(cellIndex(cols, row - 1, col));
    }
    if (event.key === "ArrowDown" && row < rows - 1) {
      event.preventDefault();
      commitCell(index, event.currentTarget.innerText);
      setEditing(cellIndex(cols, row + 1, col));
    }
  };

  const adjustGrid = (rowDelta: number, colDelta: number) => {
    const nextRows = clamp(rows + rowDelta, MIN_ROWS, MAX_ROWS);
    const nextCols = clamp(cols + colDelta, MIN_COLS, MAX_COLS);
    if (nextRows === rows && nextCols === cols) return;
    setEditing(null);
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: {
        rows: nextRows,
        cols: nextCols,
        cells: resizedCells(cells, rows, cols, nextRows, nextCols),
        // Keep the row/column size roughly constant while growing.
        w: colDelta > 0 ? Math.max(shape.props.w, nextCols * 110) : shape.props.w,
        h: rowDelta > 0 ? Math.max(shape.props.h, nextRows * 44) : shape.props.h,
      },
    });
  };

  const buttonClass =
    "flex h-6 items-center rounded-md border border-neutral-200 bg-white px-1.5 text-[11px] font-medium text-neutral-600 shadow-sm transition-colors hover:bg-neutral-100 hover:text-neutral-900";

  return (
    <HTMLContainer
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: "all" }}
    >
      <div
        className="relative h-full w-full"
        onPointerDown={editing !== null ? (event) => event.stopPropagation() : undefined}
      >
        {isSelected && (
          <div
            className="absolute -top-9 right-0 z-10 flex items-center gap-1"
            onPointerDown={stop}
          >
            <button
              type="button"
              className={buttonClass}
              onClick={() => adjustGrid(1, 0)}
              title="Add a row"
            >
              + Row
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => adjustGrid(-1, 0)}
              title="Remove a row"
            >
              – Row
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => adjustGrid(0, 1)}
              title="Add a column"
            >
              + Col
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => adjustGrid(0, -1)}
              title="Remove a column"
            >
              – Col
            </button>
          </div>
        )}

        <div
          className="grid h-full w-full overflow-hidden rounded-md"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            border: `1px solid ${strokeColor}`,
            background,
          }}
        >
          {Array.from({ length: rows * cols }, (_, index) => {
            const isEditing = editing === index;
            return (
              <div
                key={index}
                onDoubleClick={() => setEditing(index)}
                onPointerDown={isEditing ? stop : undefined}
                className="overflow-hidden border-neutral-400/50 px-1.5 py-1 text-neutral-900 outline-none"
                style={{
                  borderRightWidth: (index % cols) === cols - 1 ? 0 : 1,
                  borderBottomWidth: index >= (rows - 1) * cols ? 0 : 1,
                  borderStyle: "solid",
                  fontSize: FONT_SIZE[size],
                  lineHeight: 1.25,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  cursor: isEditing ? "text" : "default",
                }}
              >
                {isEditing ? (
                  <div
                    ref={editingRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={(event) =>
                      commitCell(index, event.currentTarget.innerText)
                    }
                    onKeyDown={(event) => handleCellKeyDown(index, event)}
                    onBlur={() => setEditing(null)}
                    className="h-full w-full outline-none"
                  />
                ) : (
                  (cells[index] ?? "")
                )}
              </div>
            );
          })}
        </div>
      </div>
    </HTMLContainer>
  );
}

export class TableShapeUtil extends BaseBoxShapeUtil<TLTableShape> {
  static override type = TABLE_SHAPE_TYPE;

  static override props: RecordProps<TLTableShape> = {
    w: T.number,
    h: T.number,
    rows: T.number,
    cols: T.number,
    cells: T.arrayOf(T.string),
    color: DefaultColorStyle,
    fill: DefaultFillStyle,
    size: DefaultSizeStyle,
  };

  override canEdit() {
    return false;
  }

  override getDefaultProps(): TLTableShape["props"] {
    return {
      w: 460,
      h: 150,
      rows: DEFAULT_ROWS,
      cols: DEFAULT_COLS,
      cells: emptyGrid(DEFAULT_ROWS, DEFAULT_COLS),
      color: "black",
      fill: "none",
      size: "m",
    };
  }

  override component(shape: TLTableShape) {
    return <TableComponent shape={shape} editor={this.editor} />;
  }

  override indicator(shape: TLTableShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} />;
  }

  override toSvg(shape: TLTableShape, ctx: SvgExportContext) {
    const { w, h, rows, cols, cells, color, fill, size } = shape.props;
    const theme = this.editor.getCurrentTheme().colors[ctx.colorMode];
    const stroke = getColorValue(theme, color, "solid");
    const background = fill === "none" ? "none" : getColorValue(theme, color, "semi");
    const fontSize = FONT_SIZE[size];
    const colWidth = w / cols;
    const rowHeight = h / rows;

    return (
      <g>
        {background !== "none" && (
          <rect width={w} height={h} rx={6} fill={background} />
        )}
        {Array.from({ length: rows * cols }, (_, index) => {
          const row = Math.floor(index / cols);
          const col = index % cols;
          const x = col * colWidth;
          const y = row * rowHeight;
          const text = cells[index] ?? "";
          return (
            <g key={index}>
              {col < cols - 1 && (
                <line x1={x + colWidth} y1={y} x2={x + colWidth} y2={y + rowHeight} stroke={stroke} />
              )}
              {row < rows - 1 && (
                <line x1={x} y1={y + rowHeight} x2={x + colWidth} y2={y + rowHeight} stroke={stroke} />
              )}
              {text && (
                <text
                  x={x + 6}
                  y={y + rowHeight / 2}
                  dominantBaseline="middle"
                  fontSize={fontSize}
                  fill={getColorValue(theme, "black", "solid")}
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
        <rect
          width={w}
          height={h}
          rx={6}
          fill="none"
          stroke={stroke}
          strokeWidth={1}
        />
      </g>
    );
  }
}

export const tableShapeUtils = [TableShapeUtil];

/** Inserts a fresh table centred on `point`. */
export function insertTable(
  editor: Editor,
  point: VecModel,
  style: ShapeStyle,
): TLShapeId {
  const id = createShapeId();
  const cols = DEFAULT_COLS;
  const rows = DEFAULT_ROWS;
  editor.createShape({
    id,
    type: TABLE_SHAPE_TYPE,
    x: point.x - 230,
    y: point.y - 75,
    props: {
      color: style.color,
      fill: style.fill,
      size: style.size,
      rows,
      cols,
      cells: emptyGrid(rows, cols),
    },
  });
  editor.setSelectedShapes([id]);
  editor.setCurrentTool("select");
  return id;
}
