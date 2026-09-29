import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { FixedAsset } from "@/types/fixed-asset";
import { PaginatedData } from "@/types/global";
import { ChartOfAccount } from "@/types/chart-of-account";

export default function CreateFixedAssetModal({
  opened,
  close,
  setPaginatedAssets,
}: {
  opened: boolean;
  close: () => void;
  setPaginatedAssets: React.Dispatch<React.SetStateAction<PaginatedData<FixedAsset>>>;
}) {
  const { translate, language } = useLanguage();
  const { data: warehouses } = useWarehouses();

  const [name, setName] = useState("");
  const [bookValue, setBookValue] = useState<string | number>("");
  const [fairValue, setFairValue] = useState<string | number>("");
  const [warehouseId, setWarehouseId] = useState("");
  // Accounting-foundation fields - all optional, so the pre-existing create flow keeps working
  // exactly as before when they're left blank (see backend/server/models/fixedAssets.js).
  const [price, setPrice] = useState<string | number>("");
  const [assetAccountId, setAssetAccountId] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState("");
  const [notes, setNotes] = useState("");
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const { privateRequest: fetchAccounts } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    fetchAccounts({ url: "accounts", params: { limit: 500 }, language })
      .then((res) => setAccounts(res.data.filter((a: ChartOfAccount) => a.type === "asset")))
      .catch(() => {});
  }, [opened]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "fixed-assets",
        data: {
          name,
          bookValue,
          fairValue,
          warehouseId,
          price: price || undefined,
          assetAccountId: assetAccountId || undefined,
          acquisitionDate: acquisitionDate || undefined,
          notes: notes || undefined,
        },
      });

      // Update the data
      setPaginatedAssets((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: [res.data, ...prev.data],
        };
      });

      close();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setName("");
      setBookValue("");
      setFairValue("");
      setWarehouseId("");
      setPrice("");
      setAssetAccountId("");
      setAcquisitionDate("");
      setNotes("");
      setError("");
    }, 250);
  }

  const title = translate("Create Fixed Asset", "إنشاء أصل ثابت");

  return (
    <Modal opened={opened} onClose={handleClose} title={title} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Error Alert */}
        {error && <ErrorAlert error={error} />}

        {/* Name */}
        <TextInput
          label={translate("Asset Name", "اسم الأصل")}
          placeholder={translate("Enter asset name", "أدخل اسم الأصل")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        {/* Book Value */}
        <NumberInput
          label={translate("Book Value", "القيمة الدفترية")}
          placeholder={translate("Enter book value", "أدخل القيمة الدفترية")}
          value={bookValue}
          onChange={(value) => setBookValue(value)}
          min={0}
          required
        />

        {/* Fair Value */}
        <NumberInput
          label={translate("Fair Value", "القيمة العادلة")}
          placeholder={translate("Enter fair value", "أدخل القيمة العادلة")}
          value={fairValue}
          onChange={(value) => setFairValue(value)}
          min={0}
          required
        />

        {/* Warehouse */}
        <Select
          label={translate("Warehouse", "المخزن")}
          placeholder={translate("Select Warehouse", "اختر المخزن")}
          value={warehouseId}
          onChange={(value) => setWarehouseId(value || "")}
          data={warehouses.map((warehouse) => ({ value: warehouse._id, label: warehouse.name }))}
          required
        />

        <hr />
        <p className="text-xs text-gray-500">{translate("Accounting (optional)", "المحاسبة (اختياري)")}</p>

        {/* Price */}
        <NumberInput
          label={translate("Price", "السعر")}
          placeholder={translate("Enter acquisition price", "أدخل سعر الشراء")}
          value={price}
          onChange={setPrice}
          min={0}
        />

        {/* Asset Account */}
        <Select
          label={translate("Asset Account (Chart of Accounts)", "حساب الأصل (دليل الحسابات)")}
          placeholder={translate("Select account", "اختر الحساب")}
          value={assetAccountId}
          onChange={(value) => setAssetAccountId(value || "")}
          data={accounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          searchable
          clearable
        />

        {/* Acquisition Date */}
        <TextInput
          type="date"
          label={translate("Acquisition Date", "تاريخ الشراء")}
          value={acquisitionDate}
          onChange={(e) => setAcquisitionDate(e.target.value)}
        />

        {/* Notes */}
        <Textarea label={translate("Notes", "ملاحظات")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />

        {/* Submit Button */}
        <Button type="submit" loading={loading} mt="md">
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
