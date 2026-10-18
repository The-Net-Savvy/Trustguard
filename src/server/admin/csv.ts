/**
 * CSV encoding for audit exports (pure, unit-tested in tests/admin.test.ts).
 *
 * Cells are always quoted. Values that a spreadsheet would treat as a formula
 * (starting with = + - @, tab or carriage return) are prefixed with an apostrophe:
 * audit data includes user-controlled text such as user agents, and an exported
 * log is likely to be opened in Excel (CSV/formula injection, OWASP).
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
