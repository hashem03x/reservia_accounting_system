// Run with: npm run test:unit   (Node's built-in test runner; Node strips the types itself)
// Frontend rules behind the client requirements: payment-term schedules (G, K), vendor payment
// accounts (N), the Project / G&A label (B) and optional product prices (F). They mirror the backend
// rules (which validate again on save) - these tests keep the two in step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDocumentPaymentSchedule, resizeInstallments, toPaymentTermsPayload, validateDocumentPaymentTerms } from "./document-payment-terms.ts";
import { accountsForVendor, describeAccount, paymentAccountsPayload, setPrimary, validatePaymentAccounts } from "./vendor-payment-accounts.ts";
import { entryClassification, entryClassificationLabel } from "./accounting-labels.ts";
import { getProductFinalPrice, priceText } from "./product-helpers.ts";

const en = (e: string) => e;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getTime();

test("payment terms: choosing N installments shows N rows, keeping what was typed", () => {
  const three = resizeInstallments([], 3);
  assert.equal(three.length, 3);
  assert.deepEqual(three.map((r) => r.description), ["Installment 1", "Installment 2", "Installment 3"]);
  const edited = [{ ...three[0], description: "Advance" }, ...three.slice(1)];
  assert.equal(resizeInstallments(edited, 2)[0].description, "Advance");
  assert.equal(resizeInstallments(edited, 5).length, 5);
});

test("payment terms: % and fixed amounts, tenor from the issue date, allocated / unallocated", () => {
  const terms = {
    mode: "installments" as const,
    installments: [
      { description: "Advance", basis: "percentage" as const, percentage: 30, tenorDays: 0 },
      { description: "Delivery", basis: "amount" as const, amount: 250, tenorDays: 30 },
    ],
  };
  assert.equal(validateDocumentPaymentTerms(terms, { total: 1000, issueDate: "2026-04-01" }), null);
  const s = computeDocumentPaymentSchedule(terms, { total: 1000, issueDate: "2026-04-01" });
  assert.deepEqual(s.rows.map((r) => [r.amount, r.dueDate?.getTime()]), [[300, day("2026-04-01")], [250, day("2026-05-01")]]);
  assert.deepEqual([s.allocatedAmount, s.allocatedPercentage, s.unallocatedAmount], [550, 55, 450]);
  assert.deepEqual(toPaymentTermsPayload(terms).installments?.map((i) => Object.keys(i).sort()), [["basis", "description", "percentage", "tenorDays"], ["amount", "basis", "description", "tenorDays"]]);
});

test("payment terms: over-allocation, negative values, empty descriptions and an early lump-sum date are refused", () => {
  const row = (extra = {}) => ({ description: "x", basis: "percentage" as const, percentage: 50, tenorDays: 1, ...extra });
  assert.match(validateDocumentPaymentTerms({ mode: "installments", installments: [row(), row({ percentage: 60 })] }, { total: 100 }) ?? "", /cannot exceed 100%/);
  assert.match(validateDocumentPaymentTerms({ mode: "installments", installments: [row({ basis: "amount", amount: 150 })] }, { total: 100 }) ?? "", /cannot exceed 100%|more than the total/);
  assert.match(validateDocumentPaymentTerms({ mode: "installments", installments: [row({ percentage: -1 })] }, { total: 100 }) ?? "", /greater than 0/);
  assert.match(validateDocumentPaymentTerms({ mode: "installments", installments: [row({ description: " " })] }, { total: 100 }) ?? "", /description/);
  assert.match(validateDocumentPaymentTerms({ mode: "lump_sum", lumpSumDueDate: "2026-01-01" }, { total: 100, issueDate: "2026-02-01" }) ?? "", /before the issue date/);
  assert.equal(validateDocumentPaymentTerms(null), null, "not set is valid");
});

test("payment terms: rounding - 100% in percentages reconciles to the cent; the value changing recalculates percentages", () => {
  const thirds = { mode: "installments" as const, installments: [33.3333, 33.3333, 33.3334].map((p, i) => ({ description: `T${i}`, basis: "percentage" as const, percentage: p, tenorDays: i })) };
  assert.deepEqual(computeDocumentPaymentSchedule(thirds, { total: 100 }).rows.map((r) => r.amount), [33.33, 33.33, 33.34]);
  assert.deepEqual(computeDocumentPaymentSchedule(thirds, { total: 300 }).rows.map((r) => r.amount), [100, 100, 100]);
});

test("vendor payment accounts: several of each type, one primary, duplicates refused, legacy single method shown", () => {
  const accounts = [
    { type: "bank" as const, isPrimary: false, isActive: true, bank: { bankName: "Banque Misr", accountNumber: "1234567890" } },
    { type: "bank" as const, isPrimary: false, isActive: true, bank: { bankName: "NBE", iban: "EG380019000500000000263180099" } },
    { type: "wallet" as const, isPrimary: false, isActive: true, wallet: { provider: "vodafone_cash" as const, identifier: "01012345678" } },
    { type: "wallet" as const, isPrimary: false, isActive: true, wallet: { provider: "vodafone_cash" as const, identifier: "01198765432" } },
  ];
  assert.equal(validatePaymentAccounts(accounts), null);
  assert.deepEqual(setPrimary(accounts, 2).map((a) => a.isPrimary), [false, false, true, false]);
  assert.match(validatePaymentAccounts([accounts[2], accounts[2]]) ?? "", /listed twice/);
  assert.match(validatePaymentAccounts([{ type: "bank", isPrimary: false, isActive: true, bank: { bankName: "X" } }]) ?? "", /account number or IBAN/);
  assert.match(validatePaymentAccounts([{ type: "bank", isPrimary: false, isActive: true, bank: { bankName: "X", iban: "GB12" } }]) ?? "", /Egyptian IBAN/);
  assert.equal(describeAccount(accounts[0]), "Bank - Banque Misr ****7890", "masked");
  assert.deepEqual(Object.keys(paymentAccountsPayload([accounts[2]])[0]).sort(), ["isActive", "isPrimary", "label", "type", "wallet"].sort());
  // A vendor not migrated yet: its old single method appears as its primary account.
  const legacy = accountsForVendor({ paymentInfo: { mode: "instapay", instapay: { identifier: "nile@instapay" } } });
  assert.deepEqual(legacy.map((a) => [a.type, a.isPrimary]), [["instapay", true]]);
  assert.deepEqual(accountsForVendor({ paymentAccounts: accounts, paymentInfo: { mode: "bank" } }), accounts, "the list wins once it exists");
});

test("journal entries: Project / G&A label - a legacy entry without a project is Unclassified, never G&A", () => {
  assert.equal(entryClassification({ classification: "ga" }), "ga");
  assert.equal(entryClassification({ classification: "project", project: { _id: "p" } }), "project");
  assert.equal(entryClassification({ classification: null, project: { _id: "p" } }), "project");
  assert.equal(entryClassification({ classification: null, project: null }), "unclassified");
  assert.equal(entryClassificationLabel("ga", en), "G&A");
});

test("products: a missing price is shown as '-', never as 0", () => {
  assert.equal(priceText(undefined), "-");
  assert.equal(priceText(0), "0.00");
  assert.equal(getProductFinalPrice(null, undefined), null);
  assert.equal(getProductFinalPrice(80, 100), 80);
});
