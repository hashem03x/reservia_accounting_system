import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import { outlineIcons } from "@/components/icons";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import PaymentAccountSelect from "@/components/global/payment-account-select";
import { Button, NumberInput, Select } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Payment } from "@/types/payment";
import { Currency } from "@/types/currency";
import { BASE_CURRENCY_CODE } from "@/utils/helpers/currency-math";
import { PaginatedData } from "@/types/global";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import { buildTransferMoneyPayload } from "./transfer-money-payload";

export default function TransferMoneyModal({
  opened,
  close,
  setPaginatedPayments,
}: {
  opened: boolean;
  close: () => void;
  setPaginatedPayments: React.Dispatch<React.SetStateAction<PaginatedData<Payment>>>;
}) {
  const { translate, translations, language } = useLanguage();

  const { data: warehouses = [] } = useWarehouses();

  const { updateWarehouseBalanceById } = useWarehouseHelpers();

  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");
  const [amount, setAmount] = useState<string | number>("");
  const [withdrawAccount, setWithdrawAccount] = useState("");
  const [depositAccount, setDepositAccount] = useState("");
  // Optional foreign-currency transfer - converted to EGP server-side via the real Currency
  // Manager rate for the transfer date (never a client-supplied rate, see
  // services/accounting/moneyTransferService.js). EGP (the default) sends `amount` as-is.
  const [currencyCode, setCurrencyCode] = useState(BASE_CURRENCY_CODE);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const isForeign = currencyCode !== BASE_CURRENCY_CODE;

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({
    initialData: null,
  });

  useEffect(() => {
    if (!opened) return;
    privateRequest({ url: "currencies", params: { status: "active", limit: 200 }, language })
      .then((res) => setCurrencies(res.data || []))
      .catch(() => setCurrencies([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const warehouseOptions = useMemo(
    () =>
      (warehouses ?? [])
        .filter((warehouse) => warehouse && typeof warehouse === "object" && warehouse._id && warehouse.name)
        .map((warehouse) => ({
          value: warehouse._id,
          label: String(warehouse.name),
        })),
    [warehouses],
  );

  const currencyOptions = useMemo(
    () => [
      { value: BASE_CURRENCY_CODE, label: BASE_CURRENCY_CODE },
      ...currencies.filter((c) => c.code !== BASE_CURRENCY_CODE).map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` })),
    ],
    [currencies],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "transfer/money",
        data: buildTransferMoneyPayload({
          fromWarehouseId: sourceWarehouseId,
          toWarehouseId: targetWarehouseId,
          withdrawAccount,
          depositAccount,
          amount,
          currencyCode,
        }),
      });

      setPaginatedPayments((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          data: [res.data.paymentIn, res.data.paymentOut, ...prev.data],
        };
      });

      updateWarehouseBalanceById(sourceWarehouseId, +res.data.amount, "out");
      updateWarehouseBalanceById(targetWarehouseId, +res.data.amount, "in");

      close();
    });
  }

  function handleClose() {
    close();

    setTimeout(() => {
      setSourceWarehouseId("");
      setTargetWarehouseId("");
      setAmount("");
      setWithdrawAccount("");
      setDepositAccount("");
      setCurrencyCode(BASE_CURRENCY_CODE);
      setError("");
    }, 250);
  }

  const title = translate("Transfer Money", "تحويل الأموال");

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <Select
            label={translate("From Warehouse", "من المخزن")}
            placeholder={translate("Select Warehouse", "اختر المخزن")}
            value={sourceWarehouseId}
            onChange={(value) => setSourceWarehouseId(value || "")}
            data={warehouseOptions}
            required
            flex={1}
          />

          <Select
            label={translate("To Warehouse", "إلى المخزن")}
            placeholder={translate("Select Warehouse", "اختر المخزن")}
            value={targetWarehouseId}
            onChange={(value) => setTargetWarehouseId(value || "")}
            data={warehouseOptions}
            required
            flex={1}
          />

          <Button
            type="button"
            title={translate("Swap Warehouses", "تبديل المخازن")}
            onClick={() => {
              setSourceWarehouseId(targetWarehouseId);
              setTargetWarehouseId(sourceWarehouseId);
              setWithdrawAccount(depositAccount);
              setDepositAccount(withdrawAccount);
            }}
            variant="light"
            color="gray"
            px="xs"
          >
            <outlineIcons.Transaction size={20} />
          </Button>
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <NumberInput
            value={amount}
            onChange={setAmount}
            label={isForeign ? translate(`Amount (${currencyCode})`, `المبلغ (${currencyCode})`) : translate("Amount", "المبلغ")}
            placeholder={translate("Enter amount", "أدخل المبلغ")}
            min={0}
            decimalScale={2}
            hideControls
            required
            flex={1}
          />

          <Select
            label={translate("Currency", "العملة")}
            value={currencyCode}
            onChange={(v) => setCurrencyCode(v || BASE_CURRENCY_CODE)}
            data={currencyOptions}
            allowDeselect={false}
            flex={1}
          />
        </div>

        <div className="flex flex-col gap-2 md:flex-row">
          <PaymentAccountSelect value={withdrawAccount} onChange={setWithdrawAccount} label={translate("Withdraw Account", "حساب السحب")} required />

          <PaymentAccountSelect value={depositAccount} onChange={setDepositAccount} label={translate("Deposit Account", "حساب الإيداع")} required />
        </div>

        <div className="flex gap-2">
          <Button type="button" onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>

          <Button
            type="submit"
            loading={loading}
            disabled={!sourceWarehouseId || !targetWarehouseId || !amount || !withdrawAccount || !depositAccount}
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
