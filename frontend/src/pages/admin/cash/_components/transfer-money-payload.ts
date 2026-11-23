import { BASE_CURRENCY_CODE } from "@/utils/helpers/currency-math";

// The Transfer Money request body: EGP (the default) sends `amount` as-is; a foreign currency
// sends `currency`/`foreign_amount` instead - the backend (services/accounting/
// moneyTransferService.js) resolves the real EGP amount from the Currency Manager rate, never a
// client-supplied rate, so `amount` itself is never sent once a foreign currency is chosen.
export function buildTransferMoneyPayload({
  fromWarehouseId,
  toWarehouseId,
  withdrawAccount,
  depositAccount,
  amount,
  currencyCode,
}: {
  fromWarehouseId: string;
  toWarehouseId: string;
  withdrawAccount: string;
  depositAccount: string;
  amount: string | number;
  currencyCode: string;
}) {
  const isForeign = currencyCode !== BASE_CURRENCY_CODE;
  return {
    from_warehouse_id: fromWarehouseId,
    to_warehouse_id: toWarehouseId,
    withdraw_account: withdrawAccount,
    deposit_account: depositAccount,
    ...(isForeign ? { currency: currencyCode, foreign_amount: amount } : { amount }),
  };
}
