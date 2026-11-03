// Run as part of: npm run test:unit (Node's built-in test runner; Node strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeOwnershipTotal, combinedOwnershipTotal, isOwnershipFinalized, rowsOwnershipTotal } from "./ownership-math.ts";

test("activeOwnershipTotal: sums only active shareholders, ignoring inactive ones", () => {
  assert.equal(
    activeOwnershipTotal([
      { status: "active", ownershipPercentage: 30 },
      { status: "inactive", ownershipPercentage: 20 },
      { status: "active", ownershipPercentage: 10 },
    ]),
    40,
  );
  assert.equal(activeOwnershipTotal([]), 0);
});

test("rowsOwnershipTotal: sums numeric rows, treats a blank/non-numeric row as 0", () => {
  assert.equal(rowsOwnershipTotal([{ ownershipPercentage: 15 }, { ownershipPercentage: 40 }, { ownershipPercentage: 45 }]), 100);
  assert.equal(rowsOwnershipTotal([{ ownershipPercentage: "" }, { ownershipPercentage: 50 }]), 50);
});

test("the exact reported bug: 15 + 40 + 45 new rows with NO pre-existing shareholders totals 100%, not 130%", () => {
  const combined = combinedOwnershipTotal(0, [{ ownershipPercentage: 15 }, { ownershipPercentage: 40 }, { ownershipPercentage: 45 }]);
  assert.equal(combined, 100);
  assert.equal(isOwnershipFinalized(combined), true);
});

test("the realistic cause of the reported 130%: a pre-existing 30% active shareholder the wizard didn't account for", () => {
  const existing = activeOwnershipTotal([{ status: "active", ownershipPercentage: 30 }]);
  const combined = combinedOwnershipTotal(existing, [{ ownershipPercentage: 15 }, { ownershipPercentage: 40 }, { ownershipPercentage: 45 }]);
  assert.equal(combined, 130, "matches the backend's own (correct) rejection total exactly");
  assert.equal(isOwnershipFinalized(combined), false);
});

test("testing-scenario table: every required combination, with no pre-existing shareholders", () => {
  const cases: [number[], number][] = [
    [[15, 40, 45], 100],
    [[20, 30, 50], 100],
    [[25, 25, 25], 75],
    [[50, 40, 20], 110],
    [[10, 40, 30, 20], 100],
  ];
  for (const [pcts, expected] of cases) {
    const combined = combinedOwnershipTotal(
      0,
      pcts.map((p) => ({ ownershipPercentage: p })),
    );
    assert.equal(combined, expected, `[${pcts.join(",")}] should total ${expected}%, got ${combined}%`);
    assert.equal(isOwnershipFinalized(combined), expected === 100);
  }
});

test("inactive shareholders never count toward the combined total", () => {
  const existing = activeOwnershipTotal([
    { status: "active", ownershipPercentage: 20 },
    { status: "inactive", ownershipPercentage: 50 },
  ]);
  const combined = combinedOwnershipTotal(existing, [{ ownershipPercentage: 80 }]);
  assert.equal(combined, 100, "the inactive 50% must not block reaching 100%");
});
