import { Box, Text } from 'ink';

/** A run of text with one style. */
export interface Span {
  readonly text: string;
  readonly color?: string | undefined;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly inverse?: boolean;
}

export interface Column<Row> {
  readonly header: string;
  /** Extra text after the header, e.g. the holder of the fastest sector. */
  readonly headerNote?: Span | undefined;
  readonly width: number;
  readonly align?: 'left' | 'right';
  /** Draw this column inverted on the selected row. */
  readonly marksSelection?: boolean;
  readonly render: (row: Row) => Span | readonly Span[];
}

export function span(text: string, style: Omit<Span, 'text'> = {}): Span {
  return { text, ...style };
}

/** Total width of a row of columns, with one space between columns. */
export function tableWidth(columns: readonly Column<never>[]): number {
  return columns.reduce((total, column) => total + column.width, 0) + Math.max(0, columns.length - 1);
}

/** Cut or pad spans to exactly `width` characters. */
export function fitSpans(spans: readonly Span[], width: number, align: 'left' | 'right' = 'left'): Span[] {
  const out: Span[] = [];
  let used = 0;
  for (const item of spans) {
    if (used >= width) break;
    const text = item.text.slice(0, width - used);
    used += text.length;
    out.push({ ...item, text });
  }
  const pad = ' '.repeat(width - used);
  return align === 'right' ? [{ text: pad }, ...out] : [...out, { text: pad }];
}

function SpanText({ item }: { item: Span }) {
  return (
    <Text
      {...(item.color ? { color: item.color } : {})}
      bold={item.bold ?? false}
      dimColor={item.dim ?? false}
      inverse={item.inverse ?? false}
    >
      {item.text}
    </Text>
  );
}

interface TableProps<Row> {
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /** Dim a whole row (retired cars). */
  readonly dimRow?: (row: Row) => boolean;
  readonly height: number;
  readonly selected?: string | undefined;
  readonly emptyText?: string;
}

/** A header line and one line per row, scrolled so the selected row stays visible. */
export function Table<Row>({ columns, rows, rowKey, dimRow, height, selected, emptyText }: TableProps<Row>) {
  const visible = windowAround(rows, rows.findIndex((row) => rowKey(row) === selected), Math.max(1, height - 1));
  return (
    <Box flexDirection="column">
      <Text wrap="truncate" dimColor>
        {columns.map((column, index) => {
          const header = fitSpans(
            [span(column.header), ...(column.headerNote ? [span(' '), column.headerNote] : [])],
            column.width,
            column.align,
          );
          return (
            <Text key={index}>
              {index > 0 ? ' ' : ''}
              {header.map((item, spanIndex) => (
                <SpanText key={spanIndex} item={item} />
              ))}
            </Text>
          );
        })}
      </Text>
      {rows.length === 0 && emptyText ? <Text dimColor>{emptyText}</Text> : null}
      {visible.map((row) => {
        const key = rowKey(row);
        const isSelected = key === selected;
        return (
          <Text key={key} wrap="truncate" dimColor={dimRow?.(row) ?? false}>
            {columns.map((column, index) => {
              const rendered = column.render(row);
              const fitted = fitSpans(Array.isArray(rendered) ? rendered : [rendered as Span], column.width, column.align);
              const spans = isSelected && column.marksSelection ? fitted.map((item) => ({ ...item, inverse: true })) : fitted;
              return (
                <Text key={index}>
                  {index > 0 ? ' ' : ''}
                  {spans.map((item, spanIndex) => (
                    <SpanText key={spanIndex} item={item} />
                  ))}
                </Text>
              );
            })}
          </Text>
        );
      })}
    </Box>
  );
}

/** At most `size` items, starting so that `index` stays in view. */
export function windowAround<T>(items: readonly T[], index: number, size: number): T[] {
  if (items.length <= size) return [...items];
  const centre = Math.max(0, index);
  const start = Math.min(Math.max(0, centre - Math.floor(size / 2)), items.length - size);
  return items.slice(start, start + size);
}
