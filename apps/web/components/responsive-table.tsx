import type { ReactNode } from "react";

export type ResponsiveTableColumn<Row> = {
  header: string;
  render: (row: Row) => ReactNode;
};

type ResponsiveTableProps<Row> = {
  rows: readonly Row[];
  columns: readonly ResponsiveTableColumn<Row>[];
  getKey: (row: Row) => string;
};

export function ResponsiveTable<Row>({
  rows,
  columns,
  getKey,
}: ResponsiveTableProps<Row>) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column.header} scope="col" className="px-4 py-3 font-medium">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {rows.map((row) => (
              <tr key={getKey(row)}>
                {columns.map((column) => (
                  <td key={column.header} className="px-4 py-3 align-middle">
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
            className="space-y-3 rounded-lg border border-border bg-card p-4"
          >
            {columns.map((column, index) => (
              <div
                key={column.header}
                className={`flex items-start justify-between gap-4 ${
                  index === columns.length - 1 ? "border-t border-border pt-3" : ""
                }`}
              >
                <span className="shrink-0 text-sm text-muted-foreground">
                  {column.header}
                </span>
                <span className="min-w-0 text-right text-sm">{column.render(row)}</span>
              </div>
            ))}
          </article>
        ))}
      </div>
    </>
  );
}
