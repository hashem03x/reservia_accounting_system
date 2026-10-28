import { useEffect, useMemo, useState } from "react";
import { Anchor, Select } from "@mantine/core";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import paths from "@/utils/constants/paths";
import { AccountParentGroup } from "@/types/account-parent-group";
import { ChartOfAccount } from "@/types/chart-of-account";
import { buildGroupSelectData } from "@/utils/helpers/account-parent-groups";

/**
 * The Chart of Accounts form's Parent Group selector. Options are the ACTIVE groups from the backend
 * (`GET account-parent-groups/selectable`, Accounting -> Parent Account Groups) - never a hardcoded
 * list - re-fetched every time the form opens so a group created or edited meanwhile shows up.
 *
 * Groups of another type than `accountType` are shown disabled. `currentAccount` (edit form) keeps
 * the account's current group selectable even if it has since been deactivated or is a legacy name
 * with no managed group (utils/helpers/account-parent-groups.ts#KEEP_CURRENT_GROUP).
 *
 * This is independent of the Parent Account selector (`parentAccount`, another ChartOfAccount).
 */
export default function ParentGroupSelect({
  opened,
  value,
  onChange,
  accountType,
  currentAccount = null,
  onGroupsLoaded,
}: {
  opened: boolean;
  value: string;
  onChange: (value: string, group: AccountParentGroup | null) => void;
  accountType?: string;
  currentAccount?: ChartOfAccount | null;
  onGroupsLoaded?: (groups: AccountParentGroup[]) => void;
}) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [groups, setGroups] = useState<AccountParentGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "account-parent-groups/selectable", language });
      const loaded: AccountParentGroup[] = Array.isArray(res?.data) ? res.data : [];
      setGroups(loaded);
      onGroupsLoaded?.(loaded);
    });
  }

  useEffect(() => {
    if (opened) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const data = useMemo(
    () => buildGroupSelectData(groups, { isArabic: language === "ar-EG", translate, accountType, currentAccount }),
    [groups, language, translate, accountType, currentAccount],
  );

  return (
    <Select
      label={translate("Parent Group (optional)", "مجموعة الحساب الرئيسية (اختياري)")}
      description={
        groups.length === 0 && !loading && !error ? (
          <span>
            {translate("No active parent groups. ", "لا توجد مجموعات نشطة. ")}
            <Anchor component={Link} to={`/${paths.admin}/${paths.accountParentGroups}`} size="xs">
              {translate("Manage parent groups", "إدارة المجموعات")}
            </Anchor>
          </span>
        ) : (
          translate(
            "Classification such as Cash & Cash Equivalents - choosing one sets the account type.",
            "تصنيف مثل النقدية وما في حكمها - اختيار مجموعة يحدد نوع الحساب.",
          )
        )
      }
      placeholder={
        loading
          ? translate("Loading parent groups...", "جاري تحميل المجموعات...")
          : groups.length === 0 && !error
            ? translate("No active parent groups yet", "لا توجد مجموعات نشطة بعد")
            : translate("Select a parent group", "اختر مجموعة")
      }
      value={value || null}
      onChange={(v) => onChange(v || "", groups.find((g) => g._id === v) ?? null)}
      data={data}
      searchable
      clearable
      disabled={loading && groups.length === 0}
      nothingFoundMessage={translate("No matching parent groups", "لا توجد مجموعات مطابقة")}
      error={
        error ? (
          <span>
            {translate("Could not load parent groups.", "تعذر تحميل المجموعات.")}{" "}
            <Anchor component="button" type="button" size="xs" onClick={load}>
              {translate("Retry", "إعادة المحاولة")}
            </Anchor>
          </span>
        ) : undefined
      }
    />
  );
}
