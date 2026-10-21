// Run with: npm run test:unit   (Node's built-in test runner; Node strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRate, inverseRate, isValidRate, toBaseAmount } from "./currency-math.ts";

test("the inverse rate follows 1 EGP = X units (USD @ 0.02 -> 1 USD = 50 EGP)", () => {
  assert.equal(inverseRate(0.02), 50);
  assert.equal(inverseRate(1), 1);
  assert.equal(inverseRate(0), null);
  assert.equal(inverseRate(-1), null);
  assert.equal(inverseRate(Number.NaN), null);
  assert.equal(inverseRate(Number.POSITIVE_INFINITY), null);
});

test("amounts convert to EGP from the full-precision rate, rounded to 2 decimals", () => {
  assert.equal(toBaseAmount(100, 0.02), 5000);
  // 1000 / 0.0204 = 49,019.61 - the rounded inverse (49.02) would wrongly give 49,020.00.
  assert.equal(toBaseAmount(1000, 0.0204), 49019.61);
  assert.equal(toBaseAmount(10, 0), null);
});

test("only finite rates greater than zero are valid", () => {
  for (const bad of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, "0.02", null, undefined]) {
    assert.equal(isValidRate(bad), false, String(bad));
  }
  assert.equal(isValidRate(0.0001), true);
});

test("rates are displayed with enough precision for small and large values", () => {
  assert.equal(formatRate(0.0204), "0.0204");
  assert.equal(formatRate(1 / 0.0204), "49.019608");
  assert.equal(formatRate(0.00001234), "0.00001234");
  assert.equal(formatRate(1500), "1,500");
  assert.equal(formatRate(null), "-");
});
