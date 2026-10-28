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
import {
  KEEP_CURRENT_GROUP,
  groupFitsType,
  initialGroupValue,
  parentGroupPayload,
  typeForSelectedGroup,
} from "@/utils/helpers/account-parent-groups";
import ParentGroupSelect from "./parent-group-select";

const accountTypes: AccountType[] = ["asset", "liability", "equity", "revenue", "cogs", "expense"];

export default function EditAccountModal({
  opened,
  close,
  account,
  onUpdated,
}: {
  opened: boolean;
  close: () => void;
  account: ChartOfAccount | null;
  onUpdated: (account: ChartOfAccount) => void;
}) {
  const { translate, language } = useLanguage();

  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<string>("");
  const [state, setState] = useState("");
  const [parentAccount, setParentAccount] = useState("");
  // Parent group. Starts as "keep the current group" (KEEP_CURRENT_GROUP is never sent to the API),
  // so saving before the groups have loaded - or when they fail to load - never clears it; once
  // loaded it becomes the matching group's id.
  const [parentGroup, setParentGroup] = useState("");
  const [groups, setGroups] = useState<AccountParentGroup[]>([]);
  const [description, setDescription] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  // Only accounts designated as parents, minus this account and its own sub-accounts (`exclude`) -
  // the same rule the API validates against on submit.
  const { privateRequest: parentRequest, data: parentOptions, setData: setParentOptions } = useDataHandler<ChartOfAccount[]>({ initialData: [] });
  useEffect(() => {
    if (!opened || !account) return;
    parentRequest({ url: "accounts/parent-eligible", params: { exclude: account._id }, language })
      .then((res) => setParentOptions(Array.isArray(res?.data) ? res.data : []))
      .catch(() => setParentOptions([]));
  }, [opened, account]);

  // The account's existing parent stays selectable even if it is no longer eligible (e.g. since
  // deactivated) - the API accepts re-saving an unchanged parent, so editing other fields never
  // forces the relationship to change.
  const currentParent = account?.parentAccount;
  const parentSelectData = [
    ...(currentParent && !parentOptions.some((a) => a._id === currentParent._id) ? [currentParent] : []),
    ...parentOptions,
  ].map((a) => ({ value: a._id, label: `${a.code} - ${a.name}` }));

  // Re-seed the form fields every time a different account is opened for editing.
  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setNameAr(account.nameAr || "");
    setType(account.type);
    setState(account.state || "");
    setParentAccount(account.parentAccount?._id || "");
    setParentGroup(account.parentGroupNameEn ? KEEP_CURRENT_GROUP : "");
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
        data: {
          name,
          nameAr: nameAr || null,
          type,
          state: state || null,
          parentAccount: parentAccount || null,
          // undefined (current group kept) is dropped from the request body - the group is left untouched.
          parentGroup: parentGroupPayload(parentGroup),
          description,
        },
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
        <ParentGroupSelect
          opened={opened}
          value={parentGroup}
          accountType={type}
          currentAccount={account}
          onGroupsLoaded={(loaded) => {
            setGroups(loaded);
            setParentGroup(initialGroupValue(loaded, account));
          }}
          onChange={(value) => {
            setParentGroup(value);
            setType((current) => typeForSelectedGroup(groups, value, current));
          }}
        />
        <Select
          label={translate("Type", "النوع")}
          value={type}
          onChange={(v) => {
            const next = v || "";
            setType(next);
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
          data={parentSelectData}
          searchable
          clearable
          nothingFoundMessage={translate("No parent accounts found", "لا توجد حسابات رئيسية")}
        />
        <Textarea label={translate("Description (optional)", "الوصف (اختياري)")} value={description} onChange={(e) => setDescription(e.target.value)} autosize minRows={2} />

        <Button type="submit" loading={loading} mt="md">
          {translate("Save", "حفظ")}
        </Button>
      </form>
    </Modal>
  );
}
