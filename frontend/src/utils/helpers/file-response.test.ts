// Run with: npm run test:unit   (Node's built-in test runner; Node strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  downloadName,
  ensureExtension,
  errorFromResponse,
  filenameFromDisposition,
  isErrorResponse,
} from "./file-response.ts";

const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name.toLowerCase()] ?? null });

test("the server's UTF-8 name wins (Arabic, spaces, special characters), then the ASCII one", () => {
  const arabic = `attachment; filename="____ 1.pdf"; filename*=UTF-8''${encodeURIComponent("فاتورة المورد رقم 1.pdf")}`;
  assert.equal(filenameFromDisposition(arabic), "فاتورة المورد رقم 1.pdf");
  assert.equal(
    filenameFromDisposition(`attachment; filename*=UTF-8''${encodeURIComponent("Receipt #7 & co; _final_.pdf")}`),
    "Receipt #7 & co; _final_.pdf",
  );
  assert.equal(filenameFromDisposition('attachment; filename="sales order 456.pdf"'), "sales order 456.pdf");
  assert.equal(filenameFromDisposition("attachment; filename=backup.rsvbak"), "backup.rsvbak");
  assert.equal(filenameFromDisposition(null), undefined);
});

test("a saved file always has an extension matching what it is", () => {
  assert.equal(ensureExtension("contract-1712", "application/pdf"), "contract-1712.pdf");
  assert.equal(ensureExtension("invoice.pdf", "application/pdf"), "invoice.pdf");
  assert.equal(
    ensureExtension("reservia-backup.rsvbak", "application/gzip"),
    "reservia-backup.rsvbak",
    "a known extension is kept",
  );
  assert.equal(
    ensureExtension("report", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=binary"),
    "report.xlsx",
  );
  assert.equal(ensureExtension("download", "application/octet-stream"), "download", "unknown types are not guessed");
  assert.equal(downloadName(null, "application/pdf", "journal-entry-789"), "journal-entry-789.pdf");
  assert.equal(downloadName('attachment; filename="../../etc/x"', "text/csv"), ".._.._etc_x.csv", "no path parts");
});

test("an error response is never treated as the file - its message is read instead", async () => {
  assert.equal(isErrorResponse({ ok: false, headers: headers({ "content-type": "application/pdf" }) }), true);
  assert.equal(
    isErrorResponse({ ok: true, headers: headers({ "content-type": "application/json; charset=utf-8" }) }),
    true,
    "200 with a JSON body is an error, not a PDF",
  );
  assert.equal(isErrorResponse({ ok: true, headers: headers({ "content-type": "application/pdf" }) }), false);

  const json = {
    status: 403,
    headers: headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify({ message: "You are not allowed to access this resource" }),
  };
  assert.equal((await errorFromResponse(json)).message, "You are not allowed to access this resource");
  const html = {
    status: 502,
    headers: headers({ "content-type": "text/html" }),
    text: async () => "<html>Bad gateway</html>",
  };
  assert.equal((await errorFromResponse(html)).message, "<html>Bad gateway</html>");
  const binary = {
    status: 500,
    headers: headers({ "content-type": "application/octet-stream" }),
    text: async () => "\u0000\u0001",
  };
  assert.equal((await errorFromResponse(binary)).message, "The request failed (500).");
});
