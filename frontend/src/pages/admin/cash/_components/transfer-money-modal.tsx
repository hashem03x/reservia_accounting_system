import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import { outlineIcons } from "@/components/icons";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, NumberInput, Select } from "@mantine/core";
import { useMemo, useState } from "react";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { paymentMethodsArray } from "@/utils/constants/payment-methods";
import { Payment, PaymentMethod } from "@/types/payment";
import { PaginatedData } from "@/types/global";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";

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
  const [withdrawMethod, setWithdrawMethod] = useState<PaymentMethod | null>(null);
  const [depositMethod, setDepositMethod] = useState<PaymentMethod | null>(null);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({
    initialData: null,
  });

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

  const paymentMethodOptions = useMemo(
    () =>
      (paymentMethodsArray ?? [])
        .filter((method) => method && typeof method === "object" && method.value && method.label)
        .map((method) => ({
          value: method.value,
          label: translate(method.label?.en ?? "", method.label?.ar ?? ""),
        })),
    [translate],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "transfer/money",
        data: {
          from_warehouse_id: sourceWarehouseId,
          to_warehouse_id: targetWarehouseId,
          amount,
          withdraw_method: withdrawMethod,
          deposit_method: depositMethod,
        },
      });

      setPaginatedPayments((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          data: [res.data.paymentIn, res.data.paymentOut, ...prev.data],
        };
      });

      updateWarehouseBalanceById(sourceWarehouseId, +amount, "out");
      updateWarehouseBalanceById(targetWarehouseId, +amount, "in");

      close();
    });
  }

  function handleClose() {
    close();

    setTimeout(() => {
      setSourceWarehouseId("");
      setTargetWarehouseId("");
      setAmount("");
      setWithdrawMethod(null);
      setDepositMethod(null);
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
              setWithdrawMethod(depositMethod);
              setDepositMethod(withdrawMethod);
            }}
            variant="light"
            color="gray"
            px="xs"
          >
            <outlineIcons.Transaction size={20} />
          </Button>
        </div>

        <NumberInput
          value={amount}
          onChange={(value) => setAmount(value)}
          label={translate("Amount", "المبلغ")}
          placeholder={translate("Enter amount", "أدخل المبلغ")}
          min={0}
          decimalScale={2}
          hideControls
          required
        />

        <div className="flex flex-col gap-2 md:flex-row">
          <Select
            clearable
            value={withdrawMethod}
            onChange={(value) => setWithdrawMethod(value as PaymentMethod | null)}
            data={paymentMethodOptions}
            label={translate("Withdraw Method", "طريقة السحب")}
            placeholder={translate("Select withdraw method", "اختر طريقة السحب")}
            required
            flex={1}
          />

          <Select
            clearable
            value={depositMethod}
            onChange={(value) => setDepositMethod(value as PaymentMethod | null)}
            data={paymentMethodOptions}
            label={translate("Deposit Method", "طريقة الإيداع")}
            placeholder={translate("Select deposit method", "اختر طريقة الإيداع")}
            required
            flex={1}
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>

          <Button
            type="submit"
            loading={loading}
            disabled={!sourceWarehouseId || !targetWarehouseId || !amount || !withdrawMethod || !depositMethod}
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
