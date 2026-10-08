import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { toDateOnly } from "@/utils/helpers/format-date";
import { Button, NumberInput, Select, Textarea, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import VendorSearch from "@/components/global/vendor-search";
import { Vendor } from "@/types/vendor";
import { FixedAsset, FixedAssetAccountOption, FixedAssetAccountOptions } from "@/types/fixed-asset";

const accountLabel = (a: FixedAssetAccountOption) => `${a.code} - ${a.name}`;

export default function CreateFixedAssetModal({
  opened,
  close,
  onCreated,
}: {
  opened: boolean;
  close: () => void;
  onCreated: (asset: FixedAsset) => void;
}) {
  const { language, translate, translations } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [name, setName] = useState("");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [assetAccountId, setAssetAccountId] = useState("");
  const [accumulatedAccountId, setAccumulatedAccountId] = useState("");
  const [depreciationAccountId, setDepreciationAccountId] = useState("");
  const [acquisitionDate, setAcquisitionDate] = useState<Date | null>(new Date());
  const [price, setPrice] = useState<string | number>("");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState<string | number>("");
  const [vatPercentage, setVatPercentage] = useState<string | number>(0);
  const [notes, setNotes] = useState("");

  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });
  const { privateRequest: loadOptions, data: options, setData: setOptions } = useDataHandler<FixedAssetAccountOptions | null>({ initialData: null });

  // The selectable accounts come from the Chart of Accounts groups on the server.
  useEffect(() => {
    if (!opened || options) return;
    loadOptions({ url: "fixed-assets/account-options", language })
      .then((res) => setOptions(res.data))
      .catch(() => setOptions(null));
  }, [opened]);

  const assetAccount = options?.assetAccounts.find((a) => a._id === assetAccountId);
  const assetClass = assetAccount?.assetClass;
  const accumulatedOptions = assetClass === "intangible" ? options?.accumulatedAmortizationAccounts || [] : options?.accumulatedDepreciationAccounts || [];

  const cost = typeof price === "number" ? price : 0;
  const months = typeof usefulLifeMonths === "number" ? usefulLifeMonths : 0;
  const vat = typeof vatPercentage === "number" ? vatPercentage : 0;
  const vatAmount = Math.round(cost * vat) / 100;
  const monthly = cost > 0 && months > 0 ? Math.round((cost / months) * 100) / 100 : 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "fixed-assets",
        data: {
          name,
          vendor: vendor?._id,
          assetAccountId,
          accumulatedAccountId,
          depreciationAccountId,
          acquisitionDate: acquisitionDate ? toDateOnly(acquisitionDate) : undefined,
          price,
          usefulLifeMonths,
          vatPercentage: vat,
          notes: notes || undefined,
        },
      });
      onCreated(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setName("");
      setVendor(null);
      setAssetAccountId("");
      setAccumulatedAccountId("");
      setDepreciationAccountId("");
      setAcquisitionDate(new Date());
      setPrice("");
      setUsefulLifeMonths("");
      setVatPercentage(0);
      setNotes("");
      setError("");
    }, 250);
  }

  const canSubmit = !!name && !!vendor && !!assetAccountId && !!accumulatedAccountId && !!depreciationAccountId && !!acquisitionDate && cost > 0 && months > 0;

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Create Fixed Asset", "إنشاء أصل ثابت")} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <TextInput label={translate("Asset Name", "اسم الأصل")} value={name} onChange={(e) => setName(e.target.value)} required />

        <VendorSearch vendor={vendor} setVendor={setVendor} label={translate("Vendor", "البائع")} placeholder={translate("Search for a vendor", "ابحث عن بائع")} required />

        <Select
          label={translate("Asset Account", "حساب الأصل")}
          description={translate("Property, Plant & Equipment or Intangible Assets", "الأصول الثابتة أو الأصول غير الملموسة")}
          placeholder={translate("Select account", "اختر الحساب")}
          value={assetAccountId || null}
          onChange={(v) => {
            setAssetAccountId(v || "");
            setAccumulatedAccountId("");
          }}
          data={(options?.assetAccounts || []).map((a) => ({
            value: a._id,
            label: `${accountLabel(a)} (${a.assetClass === "intangible" ? translate("Intangible", "غير ملموس") : translate("Tangible", "ملموس")})`,
          }))}
          nothingFoundMessage={translate("No eligible accounts in the Chart of Accounts", "لا توجد حسابات مؤهلة في دليل الحسابات")}
          searchable
          required
        />

        <Select
          label={assetClass === "intangible" ? translate("Accumulated Amortization Account", "حساب مجمع الاستهلاك") : translate("Accumulated Depreciation Account", "حساب مجمع الإهلاك")}
          placeholder={assetAccountId ? translate("Select account", "اختر الحساب") : translate("Select the asset account first", "اختر حساب الأصل أولاً")}
          value={accumulatedAccountId || null}
          onChange={(v) => setAccumulatedAccountId(v || "")}
          data={accumulatedOptions.map((a) => ({ value: a._id, label: accountLabel(a) }))}
          disabled={!assetAccountId}
          nothingFoundMessage={translate("No eligible accounts in the Chart of Accounts", "لا توجد حسابات مؤهلة في دليل الحسابات")}
          searchable
          required
        />

        <Select
          label={translate("Depreciation & Amortization Account", "حساب الإهلاك والاستهلاك")}
          placeholder={translate("Select account", "اختر الحساب")}
          value={depreciationAccountId || null}
          onChange={(v) => setDepreciationAccountId(v || "")}
          data={(options?.depreciationExpenseAccounts || []).map((a) => ({ value: a._id, label: accountLabel(a) }))}
          nothingFoundMessage={translate("No eligible accounts in the Chart of Accounts", "لا توجد حسابات مؤهلة في دليل الحسابات")}
          searchable
          required
        />

        <DateInput
          label={translate("Asset Date", "تاريخ الأصل")}
          description={translate("Depreciation starts with this month", "يبدأ الإهلاك من هذا الشهر")}
          value={acquisitionDate}
          onChange={setAcquisitionDate}
          required
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberInput label={translate("Cost", "التكلفة")} value={price} onChange={setPrice} min={0.01} decimalScale={2} thousandSeparator required />
          <NumberInput label={translate("Useful Life (months)", "العمر الإنتاجي بالشهور")} value={usefulLifeMonths} onChange={setUsefulLifeMonths} min={1} allowDecimal={false} required />
          <NumberInput label={translate("VAT %", "ضريبة القيمة المضافة %")} value={vatPercentage} onChange={setVatPercentage} min={0} max={100} decimalScale={2} />
        </div>

        <div className="flex flex-col gap-1 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          <span>
            {translate("VAT amount", "قيمة الضريبة")}: <b>{vatAmount.toLocaleString()} {translations.currency}</b>
          </span>
          <span>
            {translate("Owed to the vendor", "المستحق للبائع")}: <b>{(cost + vatAmount).toLocaleString()} {translations.currency}</b>
          </span>
          <span>
            {translate("Monthly depreciation", "الإهلاك الشهري")}: <b>{monthly.toLocaleString()} {translations.currency}</b>
          </span>
        </div>

        <Textarea label={translate("Notes (optional)", "ملاحظات (اختياري)")} value={notes} onChange={(e) => setNotes(e.target.value)} autosize minRows={2} />

        <Button type="submit" loading={loading} disabled={!canSubmit} mt="md">
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
