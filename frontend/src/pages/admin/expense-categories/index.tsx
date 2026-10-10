import { useEffect, useState } from "react";
import { Badge, Button, Switch, Table, TextInput, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import Modal from "@/components/ui/modal";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { outlineIcons } from "@/components/icons";
import { ExpenseCategory } from "@/types/accounting-period";

/**
 * Admin -> Expense Categories: the groupings expenses are analyzed by (Expenses by Category report,
 * expense filters). An inactive category stays on the expenses that use it but cannot be chosen for
 * a new one; a category in use cannot be deleted - deactivate it instead.
 */
export default function ExpenseCategories() {
  const { language, translate, translations } = useLanguage();
  useDocumentTitle(`${translations.pages.expenseCategories} | ${translations.adminPanel}`);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ExpenseCategory[]>({
    initialData: [],
    initialLoading: true,
  });
  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "expense-categories", language });
      setData(res.data || []);
    });
  }
  useEffect(() => {
    load();
  }, []);

  const [editing, setEditing] = useState<ExpenseCategory | "new" | null>(null);
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const {
    loading: saving,
    setLoading: setSaving,
    error: saveError,
    setError: setSaveError,
    privateRequest: saveRequest,
  } = useDataHandler({ initialData: null });
  const [actionError, setActionError] = useState("");

  function openForm(category: ExpenseCategory | "new") {
    setEditing(category);
    setSaveError("");
    setName(category === "new" ? "" : category.name);
    setNameAr(category === "new" ? "" : category.nameAr || "");
    setDescription(category === "new" ? "" : category.description || "");
    setIsActive(category === "new" ? true : category.isActive);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    handleRequest(language, setSaving, setSaveError, async () => {
      const body = { name, nameAr: nameAr || null, description: description || null, isActive };
      if (editing === "new") await saveRequest({ method: "POST", url: "expense-categories", data: body, language });
      else await saveRequest({ method: "PATCH", url: `expense-categories/${editing._id}`, data: body, language });
      setEditing(null);
      load();
    });
  }

  async function toggleActive(category: ExpenseCategory) {
    setActionError("");
    try {
      await privateRequest({
        method: "PATCH",
        url: `expense-categories/${category._id}`,
        data: { isActive: !category.isActive },
        language,
      });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(category: ExpenseCategory) {
    if (!confirm(translate(`Delete the category "${category.name}"?`, `حذف التصنيف "${category.nameAr || category.name}"؟`)))
      return;
    setActionError("");
    try {
      await privateRequest({ method: "DELETE", url: `expense-categories/${category._id}`, language });
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.expenseCategories,
        sideElements: (
          <Button
            leftSection={<outlineIcons.Squares size={16} />}
            onClick={() => openForm("new")}
            data-tour="expense-categories-create"
          >
            {translate("New Category", "تصنيف جديد")}
          </Button>
        ),
      }}
    >
      {actionError && <ErrorAlert error={actionError} />}
      {loading ? (
        <LoadingSection message={translate("Loading categories...", "جاري تحميل التصنيفات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading categories", "خطأ في تحميل التصنيفات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : data.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500 dark:border-gray-700">
          {translate(
            "No expense categories yet. Create one to start grouping expenses.",
            "لا توجد تصنيفات بعد. أنشئ تصنيفاً لبدء تجميع المصروفات.",
          )}
        </p>
      ) : (
        <DataTableContainer>
          <DataTable className="text-sm">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                <Table.Th>{translate("Description", "الوصف")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                <Table.Th className="text-end">{translate("Expenses", "المصروفات")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((c) => (
                <Table.Tr key={c._id}>
                  <Table.Td className="max-w-[240px]">
                    <p className="truncate font-medium">{language === "ar-EG" && c.nameAr ? c.nameAr : c.name}</p>
                    {c.nameAr && (
                      <p className="truncate text-xs text-gray-500">{language === "ar-EG" ? c.name : c.nameAr}</p>
                    )}
                  </Table.Td>
                  <Table.Td className="max-w-[320px] truncate" title={c.description || undefined}>
                    {c.description || "-"}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={c.isActive ? "green" : "gray"} variant="light">
                      {c.isActive ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="text-end tabular-nums">{c.expenseCount ?? 0}</Table.Td>
                  <Table.Td className="whitespace-nowrap text-end">
                    <div className="flex justify-end gap-1">
                      <Button size="compact-sm" variant="subtle" onClick={() => openForm(c)}>
                        {translate("Edit", "تعديل")}
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color={c.isActive ? "gray" : "green"}
                        onClick={() => toggleActive(c)}
                      >
                        {c.isActive ? translate("Deactivate", "إيقاف") : translate("Activate", "تفعيل")}
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="red"
                        disabled={(c.expenseCount ?? 0) > 0}
                        title={
                          (c.expenseCount ?? 0) > 0
                            ? translate(
                                "Used by expenses - deactivate it instead",
                                "مستخدم في مصروفات - قم بإيقافه بدلاً من الحذف",
                              )
                            : undefined
                        }
                        onClick={() => remove(c)}
                      >
                        {translate("Delete", "حذف")}
                      </Button>
                    </div>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}

      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={
          editing === "new"
            ? translate("New Expense Category", "تصنيف مصروفات جديد")
            : translate("Edit Expense Category", "تعديل تصنيف المصروفات")
        }
      >
        <form onSubmit={save} className="flex flex-col gap-3">
          {saveError && <ErrorAlert error={saveError} />}
          <TextInput
            label={translate("Name (English)", "الاسم (إنجليزي)")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
          <TextInput
            label={translate("Name (Arabic)", "الاسم (عربي)")}
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            maxLength={100}
            dir="rtl"
          />
          <Textarea
            label={translate("Description", "الوصف")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            autosize
            minRows={2}
          />
          <Switch
            label={translate("Active - can be chosen for new expenses", "نشط - يمكن اختياره للمصروفات الجديدة")}
            checked={isActive}
            onChange={(e) => setIsActive(e.currentTarget.checked)}
          />
          <Button type="submit" loading={saving} disabled={!name.trim()}>
            {translate("Save", "حفظ")}
          </Button>
        </form>
      </Modal>
    </AdminLayoutBox>
  );
}
