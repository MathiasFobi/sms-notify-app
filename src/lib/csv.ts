/**
 * Tiny CSV utility — used by the bulk-send templates download button.
 *
 * Properly escapes commas, quotes, and newlines per RFC 4180:
 *   - Wraps any field containing comma, quote, or newline in quotes
 *   - Doubles internal quotes
 *
 * For the bulk-send templates the columns are simple (phone, name, message)
 * so most cells are unquoted.
 */

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(rows: Array<Record<string, string>>, headers?: string[]): string {
  if (rows.length === 0 && (!headers || headers.length === 0)) return "";
  const cols = headers ?? Object.keys(rows[0]!);
  const lines: string[] = [];
  lines.push(cols.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(cols.map((c) => csvEscape(r[c] ?? "")).join(","));
  }
  return lines.join("\n");
}

/**
 * Trigger a browser download of a CSV string as a file.
 *
 * Uses a Blob + temporary <a download> — no server roundtrip, no deps.
 * Caller is responsible for putting this behind a user gesture handler
 * (click handler) so the browser allows the download.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the object URL on the next tick to allow the download to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Pre-baked templates the bulk-send UI offers for download. */
export const BULK_TEMPLATES = {
  standard: () =>
    toCsv(
      [
        { phone: "+15551234567", name: "Alice" },
        { phone: "+15559876543", name: "Bob" },
        { phone: "+15555555555", name: "Charlie" },
      ],
      ["phone", "name"]
    ),
  perRecipient: () =>
    toCsv(
      [
        {
          phone: "+15551234567",
          name: "Alice",
          message: "Hi Alice, your order #1234 has shipped.",
        },
        {
          phone: "+15559876543",
          name: "Bob",
          message: "Hi Bob, your appointment is at 3pm tomorrow.",
        },
        {
          phone: "+15555555555",
          name: "Charlie",
          message: "Reminder: your prescription is ready for pickup.",
        },
      ],
      ["phone", "name", "message"]
    ),
} as const;