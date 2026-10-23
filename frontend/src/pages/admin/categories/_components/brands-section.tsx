import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { ActionIcon, Badge, Button, TextInput, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useBrands } from "@/context/BrandsContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import DeleteModal from "@/components/ui/delete-modal";
import { outlineIcons } from "@/components/icons";
import { Brand } from "@/types/categories";

/**
 * Brands - the third level of the product catalog (Main Category -> Subcategory -> Brand ->
 * Model/Item -> Specifications). A brand is not tied to one category (the same manufacturer can
 * make cables and pipes). A brand still used by products cannot be deleted (brandController.js).
 */
export default function BrandsSection({ canCreate, canUpdate, canDelete }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean }) {
  const { translate, language } = useLanguage();
  const { data: brands, setData: setBrands, loading, error } = useBrands();
  const [keyword, setKeyword] = useState("");

  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure();
  const [editing, setEditing] = useState<Brand | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const { privateRequest, loading: saving, setLoading: setSaving, error: saveError, setError: setSaveError } = useDataHandler({ initialData: null });

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure();
  const [deleting, setDeleting] = useState<Brand | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function startForm(brand: Brand | null) {
    setEditing(brand);
    setNameEn(brand?.name.en ?? "");
    setNameAr(brand?.name.ar ?? "");
    setSaveError("");
    openForm();
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!nameEn.trim() || !nameAr.trim()) return;
    handleRequest(language, setSaving, setSaveError, async () => {
      const res = await privateRequest({
        method: editing ? "PUT" : "POST",
        url: editing ? `brands/${editing._id}` : "brands",
        data: { name: { en: nameEn.trim(), ar: nameAr.trim() } },
        language,
      });
      setBrands((prev) => (editing ? prev.map((b) => (b._id === editing._id ? res.data : b)) : [...prev, res.data]));
      closeForm();
    });
  }

  function confirmDelete() {
    if (!deleting || deleteLoading) return;
    handleRequest(language, setDeleteLoading, setDeleteError, async () => {
      await privateRequest({ method: "DELETE", url: `brands/${deleting._id}`, language });
      setBrands((prev) => prev.filter((b) => b._id !== deleting._id));
      closeDelete();
    });
  }

  const kw = keyword.trim().toLowerCase();
  const shown = brands.filter((b) => !kw || b.name.en.toLowerCase().includes(kw) || b.name.ar.includes(keyword.trim()));

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-white p-4 shadow dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2>{translate("Brands", "الماركات")}</h2>
          <p className="text-sm text-gray-500">
            {translate("Brands are shared by all categories (Main Category -> Subcategory -> Brand -> Model).", "الماركات مشتركة بين كل الفئات (الفئة الرئيسية -> الفرعية -> الماركة -> الموديل).")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TextInput placeholder={translate("Search brands", "ابحث في الماركات")} aria-label={translate("Search brands", "ابحث في الماركات")} value={keyword} onChange={(e) => setKeyword(e.currentTarget.value)} />
          {canCreate && (
            <Button color="blue" variant="light" onClick={() => startForm(null)}>
              {translate("Add Brand", "إضافة ماركة")}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">{translate("Loading brands...", "جاري تحميل الماركات...")}</p>
      ) : error ? (
        <ErrorAlert error={error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-gray-500">{kw ? translate("No brands match your search.", "لا توجد ماركات مطابقة.") : translate("No brands yet.", "لا توجد ماركات بعد.")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {shown.map((brand) => (
            <Badge
              key={brand._id}
              size="lg"
              variant="light"
              color="gray"
              rightSection={
                (canUpdate || canDelete) && (
                  <span className="flex items-center gap-1">
                    {canUpdate && (
                      <Tooltip label={translate("Edit", "تعديل")}>
                        <ActionIcon size="xs" variant="subtle" aria-label={`${translate("Edit", "تعديل")} ${brand.name.en}`} onClick={() => startForm(brand)}>
                          <outlineIcons.Edit size={12} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                    {canDelete && (
                      <Tooltip label={translate("Delete", "حذف")}>
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="red"
                          aria-label={`${translate("Delete", "حذف")} ${brand.name.en}`}
                          onClick={() => {
                            setDeleting(brand);
                            setDeleteError("");
                            openDelete();
                          }}
                        >
                          <outlineIcons.Trash size={12} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </span>
                )
              }
            >
              {translate(brand.name.en, brand.name.ar)}
            </Badge>
          ))}
        </div>
      )}

      <Modal opened={formOpened} onClose={() => !saving && closeForm()} title={editing ? translate("Edit Brand", "تعديل الماركة") : translate("Add Brand", "إضافة ماركة")}>
        <form onSubmit={save} className="flex flex-col gap-3">
          {saveError && <ErrorAlert error={saveError} />}
          <TextInput label={translate("Name (English)", "الاسم (إنجليزي)")} value={nameEn} onChange={(e) => setNameEn(e.currentTarget.value)} required maxLength={32} data-autofocus />
          <TextInput label={translate("Name (Arabic)", "الاسم (عربي)")} value={nameAr} onChange={(e) => setNameAr(e.currentTarget.value)} required maxLength={32} dir="rtl" />
          <Button type="submit" loading={saving} disabled={!nameEn.trim() || !nameAr.trim()}>
            {editing ? translate("Save", "حفظ") : translate("Create", "إنشاء")}
          </Button>
        </form>
      </Modal>

      <DeleteModal
        opened={deleteOpened}
        onClose={() => !deleteLoading && closeDelete()}
        title={translate("Delete Brand", "حذف الماركة")}
        subTitle={translate(`Delete "${deleting?.name.en ?? ""}"? A brand still used by products cannot be deleted.`, `حذف "${deleting?.name.ar ?? ""}"؟ لا يمكن حذف ماركة مستخدمة في منتجات.`)}
        action={confirmDelete}
        loading={deleteLoading}
        error={deleteError}
      />
    </section>
  );
}
