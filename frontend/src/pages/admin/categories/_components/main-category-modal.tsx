import { useEffect, useState } from "react";
import { useMainCategories } from "@/context/MainCategoriesContext";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { MainCategory } from "@/types/categories";
import { Button, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function MainCategoryModal({
  opened,
  close,
  mainCategoryToUpdate,
  setMainCategoryToUpdate,
}: {
  opened: boolean;
  close: () => void;
  mainCategoryToUpdate: MainCategory | null;
  setMainCategoryToUpdate: React.Dispatch<React.SetStateAction<MainCategory | null>>;
}) {
  const { language, translate, translations } = useLanguage();

  const { setData: setMainCategories } = useMainCategories();

  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (mainCategoryToUpdate) {
      setNameEn(mainCategoryToUpdate.name.en);
      setNameAr(mainCategoryToUpdate.name.ar);
    } else reset();
  }, [mainCategoryToUpdate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        method: mainCategoryToUpdate ? "PUT" : "POST",
        url: mainCategoryToUpdate ? `categories/${mainCategoryToUpdate._id}` : "categories",
        data: { name: { en: nameEn, ar: nameAr } },
        language,
      });

      setMainCategories((prev) =>
        mainCategoryToUpdate
          ? prev.map((mainCategory) => (mainCategory._id === mainCategoryToUpdate._id ? res.data : mainCategory))
          : [...prev, res.data],
      );

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      if (mainCategoryToUpdate) setMainCategoryToUpdate(null);
      else reset();
      setError("");
    }, 250);
  }

  function reset() {
    setNameEn("");
    setNameAr("");
  }

  const title = translate(
    `${mainCategoryToUpdate ? "Update" : "Add"} Main Category`,
    `${mainCategoryToUpdate ? "تحديث الفئة الرئيسية" : "إضافة فئة رئيسية"}`,
  );

  const dataChanged = mainCategoryToUpdate
    ? nameEn !== mainCategoryToUpdate.name.en || nameAr !== mainCategoryToUpdate.name.ar
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextInput
          label={translate("Name in English", "الاسم بالإنجليزية")}
          placeholder={translate("Name in English", "الاسم بالإنجليزية")}
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          required
        />

        <TextInput
          label={translate("Name in Arabic", "الاسم بالعربية")}
          placeholder={translate("Name in Arabic", "الاسم بالعربية")}
          value={nameAr}
          onChange={(e) => setNameAr(e.target.value)}
          required
        />

        <div className="flex gap-2">
          <Button onClick={handleClose} variant="light" color="dark" fullWidth>
            {translations.cancel}
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!nameEn || !nameAr || (mainCategoryToUpdate ? !dataChanged : false)}
            fullWidth
          >
            {title}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
