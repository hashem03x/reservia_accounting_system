import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, Select, Textarea, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { AccountType, ChartOfAccount } from "@/types/chart-of-account";

const accountTypes: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

export default function CreateAccountModal({
  opened,
  close,
  accounts,
  onCreated,
}: {
  opened: boolean;
  close: () => void;
  accounts: ChartOfAccount[];
  onCreated: (account: ChartOfAccount) => void;
}) {
  const { translate, language } = useLanguage();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("");
  const [parentAccount, setParentAccount] = useState("");
  const [description, setDescription] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "accounts",
        data: { code, name, type, parentAccount: parentAccount || undefined, description },
      });

      onCreated(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setCode("");
      setName("");
      setType("");
      setParentAccount("");
      setDescription("");
      setError("");
    }, 250);
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Create Account", "إنشاء حساب")} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <TextInput label={translate("Code", "الرمز")} value={code} onChange={(e) => setCode(e.target.value)} required />
        <TextInput label={translate("Name", "الاسم")} value={name} onChange={(e) => setName(e.target.value)} required />
        <Select
          label={translate("Type", "النوع")}
          value={type}
          onChange={(v) => setType(v || "")}
          data={accountTypes.map((t) => ({ value: t, label: t }))}
          required
        />
        <Select
          label={translate("Parent Account (optional)", "الحساب الرئيسي (اختياري)")}
          value={parentAccount}
          onChange={(v) => setParentAccount(v || "")}
          data={accounts.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          searchable
          clearable
        />
        <Textarea label={translate("Description (optional)", "الوصف (اختياري)")} value={description} onChange={(e) => setDescription(e.target.value)} autosize minRows={2} />

        <Button type="submit" loading={loading} mt="md">
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
