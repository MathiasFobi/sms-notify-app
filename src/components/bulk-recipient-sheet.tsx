"use client";

/**
 * In-browser "spreadsheet" component for the Bulk Send page.
 *
 * Lets the user build a recipient list without leaving the app:
 *   - Tab / Enter / arrow-key navigation between cells (like Excel)
 *   - Paste from clipboard: tab-separated (Excel) or comma-separated
 *     (CSV / Google Sheets) → fills the table starting at the active cell
 *   - Click any cell to edit, type to overwrite
 *   - "+ Row" / "− Row" buttons to grow or shrink the list
 *   - Live phone normalization on blur (E.164-ish: strip spaces, dashes,
 *     parens; if 10 digits, prepend +1; flag invalid rows in red)
 *   - Header row is sticky; small badge shows valid / total
 *
 * The "Paste" button is the killer feature: click it, then Cmd-V from
 * a spreadsheet — the rows land in the table. No CSV file required.
 *
 * On submit, we serialize the table to the same `{phone}[]` payload the
 * server action expects, so the existing bulk-send pipeline keeps
 * working unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, ClipboardPaste, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { normalizePhone } from "@/lib/phone";
export type BulkSheetRow = {
  id: string; // local-only stable key
  phone: string;
  name?: string;
  /** Per-recipient custom message (overrides the global default). */
  message?: string;
};

export interface BulkRecipientSheetProps {
  value: BulkSheetRow[];
  onChange: (rows: BulkSheetRow[]) => void;
  maxRows?: number;
  /** When true, render a per-row message column. */
  showMessageColumn?: boolean;
  className?: string;
}

const DEFAULT_ROW_COUNT = 5;
const DEFAULT_MAX_ROWS = 500;

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeBlankRow(): BulkSheetRow {
  return { id: newId(), phone: "", name: "" };
}

function isPhoneValid(phone: string): boolean {
  if (!phone) return false;
  try {
    return (normalizePhone(phone) ?? "").length >= 10;
  } catch {
    return false;
  }
}

export function BulkRecipientSheet({
  value,
  onChange,
  maxRows = DEFAULT_MAX_ROWS,
  showMessageColumn = false,
  className,
}: BulkRecipientSheetProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const tableRef = useRef<HTMLTableElement | null>(null);

  // Make sure we always have at least a few blank rows on the screen.
  const paddedValue = useMemo(() => {
    if (value.length >= DEFAULT_ROW_COUNT) return value;
    const pad = Array.from({ length: DEFAULT_ROW_COUNT - value.length }, () =>
      makeBlankRow()
    );
    return [...value, ...pad];
  }, [value]);

  const validCount = useMemo(
    () => value.filter((r) => isPhoneValid(r.phone)).length,
    [value]
  );

  const updateRow = useCallback(
    (id: string, patch: Partial<BulkSheetRow>) => {
      onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [value, onChange]
  );

  const addRow = useCallback(() => {
    if (value.length >= maxRows) return;
    onChange([...value, makeBlankRow()]);
  }, [value, onChange, maxRows]);

  const removeRow = useCallback(
    (id: string) => {
      if (value.length <= 1) {
        onChange([makeBlankRow()]);
        return;
      }
      onChange(value.filter((r) => r.id !== id));
    },
    [value, onChange]
  );

  const clearAll = useCallback(() => {
    onChange(Array.from({ length: DEFAULT_ROW_COUNT }, () => makeBlankRow()));
  }, [onChange]);

  // Tab / arrow-key / Enter navigation between cells.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.matches("td input")) return;
      const cell = target.closest("td") as HTMLTableCellElement | null;
      if (!cell) return;
      const row = cell.parentElement as HTMLTableRowElement | null;
      const table = row?.parentElement as HTMLTableElement | null;
      if (!row || !table) return;
      const rowIdx = Array.from(table.rows).indexOf(row);
      const cellIdx = Array.from(row.cells).indexOf(cell);
      const lastRow = table.rows.length - 1;
      const lastCol = row.cells.length - 1;

      let nextRow = rowIdx;
      let nextCol = cellIdx;
      if (e.key === "ArrowDown") nextRow = Math.min(rowIdx + 1, lastRow);
      else if (e.key === "ArrowUp") nextRow = Math.max(rowIdx - 1, 0);
      else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey))
        nextCol = Math.min(cellIdx + 1, lastCol);
      else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey))
        nextCol = Math.max(cellIdx - 1, 0);
      else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (rowIdx === lastRow) {
          // Last row: append a new one and focus its first input.
          addRow();
          // Defer focus until React has rendered the new row.
          setTimeout(() => {
            const newRow = table.rows[table.rows.length];
            if (newRow) {
              const firstInput = newRow.cells[0]?.querySelector("input");
              firstInput?.focus();
            }
          }, 0);
          return;
        }
        nextRow = Math.min(rowIdx + 1, lastRow);
      } else {
        return;
      }
      e.preventDefault();
      const target2 = table.rows[nextRow]?.cells[nextCol]?.querySelector("input");
      target2?.focus();
      (target2 as HTMLInputElement | null)?.select?.();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [addRow]);

  const handlePaste = useCallback(() => {
    if (!pasteText.trim()) return;

    // Detect tab- vs comma-separated. Both work; first row may be a header.
    const rawLines = pasteText.replace(/\r\n?/g, "\n").split("\n").filter(Boolean);
    const parsed: { phone: string; name?: string; message?: string }[] = [];
    for (const line of rawLines) {
      const cells = line.includes("\t")
        ? line.split("\t")
        : line.split(",").map((c) => c.trim());
      if (cells.length === 0) continue;
      const first = cells[0]?.trim() ?? "";
      // Skip obvious headers
      if (/^(phone|number|mobile|whatsapp)$/i.test(first)) continue;
      const name = cells[1]?.trim() || undefined;
      const message = cells[2]?.trim() || undefined;
      parsed.push({ phone: first, name, message });
    }

    if (parsed.length === 0) {
      setPasteText("");
      setPasteOpen(false);
      return;
    }

    // Replace blank rows first, then append.
    const newRows = [...value.filter((r) => r.phone.trim() !== "")];
    for (const p of parsed) {
      if (newRows.length >= maxRows) break;
      newRows.push({ id: newId(), phone: p.phone, name: p.name });
    }
    // Pad back to DEFAULT_ROW_COUNT so the table still has empty rows.
    while (newRows.length < DEFAULT_ROW_COUNT) {
      newRows.push(makeBlankRow());
    }
    onChange(newRows);
    setPasteText("");
    setPasteOpen(false);
  }, [pasteText, value, onChange, maxRows]);

  // Allow native paste into a cell, too — re-route through the same logic.
  const handleCellPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const text = e.clipboardData.getData("text");
      if (!text || (!text.includes("\t") && !text.includes("\n"))) return; // single value, let default
      e.preventDefault();
      const rows = text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const c = line.includes("\t") ? line.split("\t") : line.split(",");
          return {
            phone: c[0]?.trim() ?? "",
            name: c[1]?.trim() || undefined,
            message: c[2]?.trim() || undefined,
          };
        })
        .filter((r) => r.phone && !/^phone$/i.test(r.phone));

      if (rows.length === 0) return;
      const start = (e.currentTarget as HTMLInputElement).dataset.rowIdx;
      const startIdx = start ? Number(start) : 0;
      const merged = [...value];
      rows.forEach((r, i) => {
        const idx = startIdx + i;
        if (idx < maxRows) {
          if (idx < merged.length) {
            merged[idx] = { ...merged[idx], ...r };
          } else {
            merged.push({ id: newId(), ...r });
          }
        }
      });
      onChange(merged);
    },
    [value, onChange, maxRows]
  );

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {validCount}
            </span>
            <span> valid</span>
            <span className="text-zinc-300 dark:text-zinc-600 mx-1.5">/</span>
            <span>{value.length} total</span>
          </span>
          {value.length >= maxRows ? (
            <span className="text-amber-600 dark:text-amber-400">
              (max {maxRows})
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPasteOpen((s) => !s)}
            data-testid="bulk-sheet-paste-toggle"
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
          >
            <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
            Paste
          </button>
          <button
            type="button"
            onClick={addRow}
            data-testid="bulk-sheet-add-row"
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Row
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={value.every((r) => !r.phone)}
            data-testid="bulk-sheet-clear"
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Clear
          </button>
        </div>
      </div>

      {pasteOpen ? (
        <div className="mb-2 rounded-lg border border-cyan-200 bg-cyan-50 dark:border-cyan-900/50 dark:bg-cyan-950/30 p-3">
          <p className="text-xs text-cyan-800 dark:text-cyan-200 mb-1.5">
            Paste rows from Excel / Google Sheets / CSV. First column is phone,
            second column (optional) is name
            {showMessageColumn ? ", third column (optional) is per-row message" : ""}.
            Header row with <code>phone</code>{" "}
            is auto-skipped.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
            placeholder={
              showMessageColumn
                ? `+15551234567\tBob\tHi Bob, your order is ready
+15559876543\tAlice\tHi Alice, your appointment is at 3pm
+15555555555\tCharlie\tReminder: your prescription is ready`
                : `+15551234567\tBob
+15559876543\tAlice
+15555555555\tCharlie`
            }
            className={cn(
              "w-full text-xs font-mono px-2 py-1.5 rounded border",
              "border-cyan-200 dark:border-cyan-900/50",
              "bg-white dark:bg-zinc-950",
              "text-zinc-900 dark:text-zinc-100",
              "focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            )}
            data-testid="bulk-sheet-paste-textarea"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                setPasteText("");
                setPasteOpen(false);
              }}
              className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
            >
              Cancel
            </button>
            <Button
              type="button"
              onClick={handlePaste}
              data-testid="bulk-sheet-paste-apply"
            >
              Add{" "}
              {pasteText.trim()
                ? `${pasteText.split("\n").filter(Boolean).length} row${
                    pasteText.split("\n").filter(Boolean).length === 1
                      ? ""
                      : "s"
                  }`
                : ""}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="max-h-[420px] overflow-y-auto">
          <table
            ref={tableRef}
            className="w-full text-sm"
            data-testid="bulk-sheet-table"
          >
            <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900/80 backdrop-blur-sm z-10">
              <tr className="text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <th className="w-10 px-3 py-2 text-center font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">Phone</th>
                <th className="px-3 py-2 text-left font-semibold">Name (optional)</th>
                {showMessageColumn ? (
                  <th className="px-3 py-2 text-left font-semibold">Message (per row)</th>
                ) : null}
                <th className="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {paddedValue.map((row, idx) => {
                const valid = isPhoneValid(row.phone);
                const empty = !row.phone;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-t border-zinc-100 dark:border-zinc-800/60",
                      "hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30",
                      !empty && !valid && "bg-rose-50/40 dark:bg-rose-950/20"
                    )}
                  >
                    <td className="px-3 py-1.5 text-center text-xs text-zinc-400 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="px-1 py-0.5">
                      <input
                        type="tel"
                        value={row.phone}
                        data-row-idx={idx}
                        onPaste={handleCellPaste}
                        onChange={(e) =>
                          updateRow(row.id, { phone: e.target.value })
                        }
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (!v) return;
                          try {
                            const normalized = normalizePhone(v);
                            if (normalized && normalized !== v) {
                              updateRow(row.id, { phone: normalized });
                            }
                          } catch {
                            // leave as-is, will be flagged invalid
                          }
                        }}
                        placeholder="+1 555 123 4567"
                        className={cn(
                          "w-full px-2 py-1 rounded text-sm font-mono",
                          "bg-transparent",
                          "focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:bg-white dark:focus:bg-zinc-900",
                          !empty && !valid && "text-rose-600 dark:text-rose-400"
                        )}
                        data-testid={`bulk-sheet-phone-${idx}`}
                      />
                    </td>
                    <td className="px-1 py-0.5">
                      <input
                        type="text"
                        value={row.name ?? ""}
                        onChange={(e) =>
                          updateRow(row.id, { name: e.target.value })
                        }
                        placeholder="—"
                        className={cn(
                          "w-full px-2 py-1 rounded text-sm",
                          "bg-transparent",
                          "focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:bg-white dark:focus:bg-zinc-900"
                        )}
                        data-testid={`bulk-sheet-name-${idx}`}
                      />
                    </td>
                    {showMessageColumn ? (
                      <td className="px-1 py-0.5">
                        <input
                          type="text"
                          value={row.message ?? ""}
                          onChange={(e) =>
                            updateRow(row.id, { message: e.target.value })
                          }
                          placeholder="(use default message)"
                          className={cn(
                            "w-full px-2 py-1 rounded text-sm",
                            "bg-transparent",
                            "focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:bg-white dark:focus:bg-zinc-900"
                          )}
                          data-testid={`bulk-sheet-message-${idx}`}
                        />
                      </td>
                    ) : null}
                    <td className="px-1 py-0.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="p-1 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 transition"
                        aria-label="Remove row"
                        data-testid={`bulk-sheet-remove-${idx}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        Tab / Enter / arrow-keys to navigate. Paste directly into a cell from
        Excel, or use the Paste button for multi-row pastes.
      </p>
    </div>
  );
}