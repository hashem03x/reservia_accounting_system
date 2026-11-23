import { describe, it, expect } from "vitest";
import { buildTransferMoneyPayload } from "./transfer-money-payload";

const base = {
  fromWarehouseId: "wh1",
  toWarehouseId: "wh2",
  withdrawAccount: "acc1",
  depositAccount: "acc2",
  amount: 2000,
  currencyCode: "EGP",
};

describe("buildTransferMoneyPayload", () => {
  it("sends `amount` for an EGP (default) transfer - never a currency/foreign_amount", () => {
    const payload = buildTransferMoneyPayload(base);
    expect(payload).toEqual({
      from_warehouse_id: "wh1",
      to_warehouse_id: "wh2",
      withdraw_account: "acc1",
      deposit_account: "acc2",
      amount: 2000,
    });
    expect("currency" in payload).toBe(false);
    expect("foreign_amount" in payload).toBe(false);
  });

  it("sends `currency`/`foreign_amount` for a foreign-currency transfer - never `amount`", () => {
    const payload = buildTransferMoneyPayload({ ...base, amount: 100, currencyCode: "USD" });
    expect(payload).toEqual({
      from_warehouse_id: "wh1",
      to_warehouse_id: "wh2",
      withdraw_account: "acc1",
      deposit_account: "acc2",
      currency: "USD",
      foreign_amount: 100,
    });
    expect("amount" in payload).toBe(false);
  });
});
