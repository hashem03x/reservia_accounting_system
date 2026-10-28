import { useEffect, useState } from "react";
import { Alert, Button, NumberInput, Select, Switch, Textarea, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import handleRequest from "@/utils/helpers/handle-request";
import { ACCOUNT_TYPES, accountTypeLabel } from "@/utils/helpers/account-parent-groups";
import { AccountParentGroup, AccountParentGroupInput } from "@/types/account-parent-group";
import { AccountType } from "@/types/chart-of-account";

/**
 * Create (group = null) or edit a Parent Account Group. Both names and the account type are
 * required. A system-default group keeps its names, type and status (automatic accounting rules
 * read it). A group with accounts keeps its type, and renaming it renames it on those accounts too
 * - the form says how many before saving.
 */
export default function ParentGroupModal({
  opened,
  close,
  group,
  canChangeStatus,
  onSubmit,
}: {
  opened: boolean;
  close: () => void;
  group: AccountParentGroup | null;
  canChangeStatus: boolean;
  onSubmit: (input: AccountParentGroupInput) => Promise<unknown>;
}) {
  const { translate, language } = useLanguage();
  const isEdit = !!group;
  const locked = !!group?.isSystemDefault;
  const accountCount = group?.accountCount ?? 0;

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [type, setType] = useState<string>("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState<number | string>("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Re-seed the form every time the modal opens (for a new group or a different one).
  useEffect(() => {
    if (!opened) return;
    setNameEn(group?.nameEn ?? "");
    setNameAr(group?.nameAr ?? "");
    setType(group?.type ?? "");
    setDescription(group?.description ?? "");
    setSortOrder(group?.sortOrder ?? "");
    setIsActive(group?.isActive ?? true);
    setError("");
    setSubmitted(false);
  }, [opened, group]);

  const renamed = isEdit && (nameEn.trim() !== group?.nameEn || nameAr.trim() !== group?.nameAr);
  const typeLocked = locked || (isEdit && accountCount > 0);
  const sortOrderValid = sortOrder === "" || (Number.isInteger(Number(sortOrder)) && Number(sortOrder) >= 0);
  const valid = !!nameEn.trim() && !!nameAr.trim() && !!type && sortOrderValid;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!valid || loading) return;
    handleRequest(language, setLoading, setError, async () => {
      const input: AccountParentGroupInput = { description: description.trim(), sortOrder: sortOrder === "" ? null : Number(sortOrder) };
      if (!locked) {
        input.nameEn = nameEn.trim();
        input.nameAr = nameAr.trim();
        if (!typeLocked) input.type = type as AccountType;
        if (isEdit && canChangeStatus) input.isActive = isActive;
      }
      await onSubmit(input);
      close();
    });
  }

  const requiredError = (value: string) => (submitted && !value.trim() ? translate("Required", "مطلوب") : undefined);

  return (
    <Modal
      opened={opened}
      onClose={() => !loading && close()}
      title={isEdit ? translate("Edit Parent Group", "تعديل المجموعة") : translate("Add Parent Group", "إضافة مجموعة")}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorAlert error={error} />}

        {locked && (
          <Alert color="blue" variant="light" title={translate("System-default group", "مجموعة افتراضية للنظام")}>
            {translate(
              "Automatic accounting rules use this group by name, so its names, type and status cannot be changed. You can still edit its description and order.",
              "تستخدم القواعد المحاسبية الآلية هذه المجموعة باسمها، لذلك لا يمكن تغيير أسمائها أو نوعها أو حالتها. يمكنك تعديل الوصف والترتيب فقط.",
            )}
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput
            label={translate("Name (English)", "الاسم (إنجليزي)")}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            maxLength={100}
            required
            disabled={locked}
            error={requiredError(nameEn)}
            data-autofocus
          />
          <TextInput
            label={translate("Name (Arabic)", "الاسم (عربي)")}
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            maxLength={100}
            required
            disabled={locked}
            error={requiredError(nameAr)}
            dir="rtl"
          />
        </div>

        <Select
          label={translate("Account Type", "نوع الحساب")}
          description={
            typeLocked && !locked
              ? translate(
                  `${accountCount} account(s) use this group, so its type cannot change. Move them to another group first.`,
                  `${accountCount} حساب يستخدم هذه المجموعة، لذلك لا يمكن تغيير نوعها. انقلها إلى مجموعة أخرى أولاً.`,
                )
              : translate("Every account in this group must have this type.", "يجب أن يكون لكل حساب في هذه المجموعة هذا النوع.")
          }
          value={type || null}
          onChange={(v) => setType(v || "")}
          data={ACCOUNT_TYPES.map((t) => ({ value: t, label: accountTypeLabel(t, translate) }))}
          allowDeselect={false}
          required
          disabled={typeLocked}
          error={submitted && !type ? translate("Required", "مطلوب") : undefined}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberInput
            label={translate("Sort Order", "الترتيب")}
            description={translate("Leave empty to add it at the end of its type", "اتركه فارغاً لإضافتها في آخر نوعها")}
            value={sortOrder}
            onChange={setSortOrder}
            min={0}
            allowDecimal={false}
            allowNegative={false}
            error={!sortOrderValid ? translate("Enter a whole number of 0 or more", "أدخل رقماً صحيحاً 0 أو أكبر") : undefined}
          />
          {isEdit && canChangeStatus && (
            <Switch
              className="self-end pb-2"
              label={translate("Active - offered for new accounts", "نشطة - متاحة للحسابات الجديدة")}
              checked={isActive}
              onChange={(e) => setIsActive(e.currentTarget.checked)}
              disabled={locked}
            />
          )}
        </div>

        <Textarea
          label={translate("Description (optional)", "الوصف (اختياري)")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          autosize
          minRows={2}
        />

        {renamed && accountCount > 0 && (
          <Alert color="orange" variant="light">
            {translate(
              `Renaming updates the group name on the ${accountCount} account(s) classified under it. Balances and journal entries are not affected.`,
              `تغيير الاسم سيحدّث اسم المجموعة في ${accountCount} حساب مصنف تحتها. لا تتأثر الأرصدة أو القيود.`,
            )}
          </Alert>
        )}
        {isEdit && !isActive && group?.isActive && accountCount > 0 && (
          <Alert color="gray" variant="light">
            {translate(
              "Accounts already in this group keep it; it just won't be offered for new accounts.",
              "تحتفظ الحسابات الموجودة بهذه المجموعة؛ لكنها لن تُعرض للحسابات الجديدة.",
            )}
          </Alert>
        )}

        <Button type="submit" loading={loading} mt="sm">
          {isEdit ? translate("Save", "حفظ") : translate("Create", "إنشاء")}
        </Button>
      </form>
    </Modal>
  );
}
