import { ReportResult, ReportRow } from "@/types/accounting-report";
import { formatCell, isFigure } from "./format";

// Print / "Save as PDF": the report (every row) as a self-contained HTML document in its own
// window, with the right direction for the language - the browser's print engine then renders the
// Arabic text and RTL layout correctly, with no PDF library and no change to the app's own layout.

const escape = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function printReport(result: ReportResult, isArabic: boolean, filterLines: string[]) {
  const t = (text: { en: string; ar: string }) => (isArabic ? text.ar : text.en);
  const rowHtml = (cells: string[], cls = "") => `<tr class="${cls}">${cells.join("")}</tr>`;

  const sections = result.sections
    .map((section) => {
      const head = section.columns.map((c) => `<th class="${isFigure(c) ? "num" : ""}">${escape(t(c.label))}</th>`).join("");
      const rows = section.rows
        .map((row: ReportRow) =>
          row._rowType === "header"
            ? rowHtml([`<td colspan="${section.columns.length}">${escape((isArabic ? row.nameAr : null) ?? row.name)}</td>`], "group")
            : rowHtml(
                section.columns.map((c) => `<td class="${isFigure(c) ? "num" : ""}">${escape(formatCell(c, row, isArabic))}</td>`),
                row._rowType || "",
              ),
        )
        .join("");
      const totals = section.totals ? rowHtml(section.columns.map((c) => `<td class="${isFigure(c) ? "num" : ""}">${escape(formatCell(c, section.totals as ReportRow, isArabic))}</td>`), "totals") : "";
      return `<h2>${escape(t(section.title))}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${section.columns.length}">-</td></tr>`}</tbody>${totals ? `<tfoot>${totals}</tfoot>` : ""}</table>`;
    })
    .join("");

  const summary = result.summary.length
    ? `<table class="summary">${result.summary
        .map((s) => `<tr><td>${escape(t(s.label))}</td><td class="num">${escape(s.value === null ? (isArabic ? "غير متاح" : "n/a") : s.type === "money" ? formatCell({ key: "v", type: "money", label: s.label }, { v: s.value }, isArabic) : s.type === "percent" ? `${s.value}%` : s.value)}</td></tr>`)
        .join("")}</table>`
    : "";
  const checks = result.checks.length ? `<ul class="checks">${result.checks.map((c) => `<li class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✗"} ${escape(t(c.label))}${c.detail ? ` (${escape(c.detail)})` : ""}</li>`).join("")}</ul>` : "";
  const notes = result.notes.length ? `<div class="notes">${result.notes.map((n) => `<p>${escape(t(n))}</p>`).join("")}</div>` : "";

  const html = `<!doctype html><html lang="${isArabic ? "ar" : "en"}" dir="${isArabic ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escape(t(result.title))}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #111; font-size: 11px; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 13px; margin: 18px 0 6px; }
  .meta { color: #444; margin-bottom: 10px; } .meta div { margin: 1px 0; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; } tr { page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 3px 5px; text-align: start; vertical-align: top; }
  th { background: #f1f1f1; } .num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.group td { background: #f7f7f7; font-weight: 600; } tr.subtotal td { font-weight: 600; } tr.total td, tr.totals td { font-weight: 700; background: #f1f1f1; }
  tr.muted td { color: #666; font-style: italic; }
  table.summary { width: auto; margin-bottom: 8px; } .checks { padding: 0; list-style: none; } .checks .ok { color: #166534; } .checks .bad { color: #b91c1c; font-weight: 700; }
  .notes { margin-top: 14px; color: #444; } thead { display: table-header-group; } tfoot { display: table-row-group; }
</style></head><body>
<h1>${escape(t(result.title))}</h1>
<div class="meta">${filterLines.map((l) => `<div>${escape(l)}</div>`).join("")}</div>
${summary}${checks}${sections}${notes}
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
}
