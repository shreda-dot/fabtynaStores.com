import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ColumnAlign = "left" | "right" | "center";

export type ResponsiveTableColumn<Row> = {
  header: string;
  render: (row: Row) => ReactNode;
  /**
   * Desktop alignment. Money/quantity columns should use `"right"` so digits
   * line up. Defaults to `"left"`. (Backwards-compatible addition.)
   */
  align?: ColumnAlign;
  /** Extra classes applied to both the header cell and the body cell. */
  className?: string;
};

type ResponsiveTableProps<Row> = {
  rows: readonly Row[];
  columns: readonly ResponsiveTableColumn<Row>[];
  getKey: (row: Row) => string;
};

const ALIGN: Record<ColumnAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function ResponsiveTable<Row>({
  rows,
  columns,
  getKey,
}: ResponsiveTableProps<Row>) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-border md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={cn(
                    "px-4 py-3 font-medium",
                    ALIGN[column.align ?? "left"],
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {rows.map((row) => (
              <tr key={getKey(row)} className="transition-colors hover:bg-muted/50">
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={cn(
                      "px-4 py-3 align-middle",
                      ALIGN[column.align ?? "left"],
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <article
            key={getKey(row)}
            className="space-y-3 rounded-md border border-border bg-card p-4"
          >
            {columns.map((column, index) => (
              <div
                key={column.header}
                className={cn(
                  "flex items-start justify-between gap-4",
                  index === columns.length - 1 && "border-t border-border pt-3",
                )}
              >
                <span className="shrink-0 text-sm text-muted-foreground">
                  {column.header}
                </span>
                <span className="min-w-0 text-right text-sm">
                  {column.render(row)}
                </span>
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
