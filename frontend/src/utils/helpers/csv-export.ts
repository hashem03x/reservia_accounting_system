// Minimal client-side CSV builder for downloading a row-level import-error report (docs section
// "Allow downloading an error report as CSV"). This never goes through the server - the error
// report only exists in the browser's own memory (the preview/commit response), so there's
// nothing for a round trip to fetch. UTF-8 BOM-prefixed so Arabic values open correctly in Excel,
// mirroring the server's own utils/exportToCsv.js convention.

function escapeCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  // Formula-injection guard (docs section "Permissions and Security") - mirrors the backend's
  // utils/csvImport/formulaGuard.js exactly, since this file is also downloaded and opened in a
  // spreadsheet application.
  const guarded = /^[=+\-@]/.test(str) ? `'${str}` : str;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function exportRowsToCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const lines = [headers, ...rows].map(row => row.map(escapeCell).join(","));
  const csvContent = `﻿${lines.join("\r\n")}`;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
