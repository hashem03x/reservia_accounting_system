import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, Select, Textarea, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { AccountType, ChartOfAccount } from "@/types/chart-of-account";
import { AccountStates } from "@/utils/constants/accounting";

const accountTypes: AccountType[] = ["asset", "liability", "equity", "revenue", "cogs", "expense"];

export default function EditAccountModal({
  opened,
  close,
  account,
  accounts,
  onUpdated,
}: {
  opened: boolean;
  close: () => void;
  account: ChartOfAccount | null;
  accounts: ChartOfAccount[];
  onUpdated: (account: ChartOfAccount) => void;
}) {
  const { translate, language } = useLanguage();

  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<string>("");
  const [state, setState] = useState("");
  const [parentAccount, setParentAccount] = useState("");
  const [description, setDescription] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // Re-seed the form fields every time a different account is opened for editing.
  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setNameAr(account.nameAr || "");
    setType(account.type);
    setState(account.state || "");
    setParentAccount(account.parentAccount?._id || "");
    setDescription(account.description || "");
    setError("");
  }, [account]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "PATCH",
        url: `accounts/${account._id}`,
        data: { name, nameAr: nameAr || null, type, state: state || null, parentAccount: parentAccount || null, description },
      });

      onUpdated(res.data);
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Edit Account", "تعديل الحساب")} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <TextInput label={translate("Code", "الرمز")} value={account?.code || ""} disabled />
        <TextInput label={translate("Name", "الاسم")} value={name} onChange={(e) => setName(e.target.value)} required />
        <TextInput label={translate("Arabic Name (optional)", "الاسم بالعربي (اختياري)")} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
        <Select
          label={translate("Type", "النوع")}
          value={type}
          onChange={(v) => setType(v || "")}
          data={accountTypes.map((t) => ({ value: t, label: t }))}
          required
        />
        <Select
          label={translate("State (optional)", "الحالة الفرعية (اختياري)")}
          description={translate(
            "Secondary classification, e.g. Current/Non-Current for an asset, Direct/Indirect for an expense",
            "تصنيف فرعي، مثل متداول/غير متداول للأصول، أو مباشر/غير مباشر للمصروفات"
          )}
          value={state}
          onChange={(v) => setState(v || "")}
          data={AccountStates.map((s) => ({ value: s, label: s }))}
          clearable
        />
        <Select
          label={translate("Parent Account (optional)", "الحساب الرئيسي (اختياري)")}
          value={parentAccount}
          onChange={(v) => setParentAccount(v || "")}
          data={accounts.filter((a) => a._id !== account?._id).map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          searchable
          clearable
        />
        <Textarea label={translate("Description (optional)", "الوصف (اختياري)")} value={description} onChange={(e) => setDescription(e.target.value)} autosize minRows={2} />

        <Button type="submit" loading={loading} mt="md">
          {translate("Save", "حفظ")}
        </Button>
      </form>
    </Modal>
  );
}
