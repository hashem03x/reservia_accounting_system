import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Button, Select, Textarea, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { AccountType, ChartOfAccount } from "@/types/chart-of-account";
import { AccountStates } from "@/utils/constants/accounting";
import { AccountParentGroup } from "@/types/account-parent-group";
import { groupFitsType, parentGroupPayload, typeForSelectedGroup } from "@/utils/helpers/account-parent-groups";
import ParentGroupSelect from "./parent-group-select";

const accountTypes: AccountType[] = ["asset", "liability", "equity", "revenue", "cogs", "expense"];

export default function CreateAccountModal({
  opened,
  close,
  onCreated,
}: {
  opened: boolean;
  close: () => void;
  onCreated: (account: ChartOfAccount) => void;
}) {
  const { translate, language } = useLanguage();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<string>("");
  const [state, setState] = useState("");
  const [parentAccount, setParentAccount] = useState("");
  // Parent group (Accounting -> Parent Account Groups) - stored on the account as its group names.
  const [parentGroup, setParentGroup] = useState("");
  const [groups, setGroups] = useState<AccountParentGroup[]>([]);
  const [description, setDescription] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // Only accounts designated as parents (`GET accounts/parent-eligible`) - the same rule the API
  // validates against on submit. Re-fetched on every open so a parent created since is offered.
  const { privateRequest: parentRequest, data: parentOptions, setData: setParentOptions } = useDataHandler<ChartOfAccount[]>({ initialData: [] });
  useEffect(() => {
    if (!opened) return;
    parentRequest({ url: "accounts/parent-eligible", language })
      .then((res) => setParentOptions(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setParentOptions([]));
  }, [opened]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: "accounts",
        data: {
          code,
          name,
          nameAr: nameAr || undefined,
          type,
          state: state || undefined,
          parentAccount: parentAccount || undefined,
          parentGroup: parentGroupPayload(parentGroup) ?? undefined,
          description,
        },
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
      setNameAr("");
      setType("");
      setState("");
      setParentAccount("");
      setParentGroup("");
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
        <TextInput label={translate("Arabic Name (optional)", "الاسم بالعربي (اختياري)")} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
        <ParentGroupSelect
          opened={opened}
          value={parentGroup}
          onGroupsLoaded={setGroups}
          accountType={type}
          onChange={(value) => {
            setParentGroup(value);
            // A group decides the account's type - every account in it shares the group's type.
            setType((current) => typeForSelectedGroup(groups, value, current));
          }}
        />
        <Select
          label={translate("Type", "النوع")}
          value={type}
          onChange={(v) => {
            const next = v || "";
            setType(next);
            // A group of another type can no longer be used - clear it rather than send a conflict.
            if (!groupFitsType(groups, parentGroup, next)) setParentGroup("");
          }}
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
          data={parentOptions.map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }))}
          searchable
          clearable
          nothingFoundMessage={translate("No parent accounts found", "لا توجد حسابات رئيسية")}
        />
        <Textarea label={translate("Description (optional)", "الوصف (اختياري)")} value={description} onChange={(e) => setDescription(e.target.value)} autosize minRows={2} />

        <Button type="submit" loading={loading} mt="md">
          {translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
