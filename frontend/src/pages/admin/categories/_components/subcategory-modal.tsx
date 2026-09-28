import { useEffect, useState } from "react";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Subcategory } from "@/types/categories";
import { Button, TextInput } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import ImgController from "@/components/ui/img-controller";

export default function SubcategoryModal({
  opened,
  close,
  mainCategoryId,
  subcategoryToUpdate,
  setSubcategoryToUpdate,
}: {
  opened: boolean;
  close: () => void;
  mainCategoryId: string;
  subcategoryToUpdate: Subcategory | null;
  setSubcategoryToUpdate: React.Dispatch<React.SetStateAction<Subcategory | null>>;
}) {
  const { language, translate, translations } = useLanguage();

  const { setData: setSubcategories } = useSubcategories();

  const [image, setImage] = useState<File | string | null>(null);
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (subcategoryToUpdate) {
      setImage(subcategoryToUpdate.image);
      setNameEn(subcategoryToUpdate.name.en);
      setNameAr(subcategoryToUpdate.name.ar);
    } else reset();
  }, [subcategoryToUpdate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      const formData = new FormData();

      if (image) formData.append("image", image);
      formData.append("mainCategory", mainCategoryId);
      formData.append("name[en]", nameEn);
      formData.append("name[ar]", nameAr);

      const res = await privateRequest({
        method: subcategoryToUpdate ? "PUT" : "POST",
        url: subcategoryToUpdate ? `subcategories/${subcategoryToUpdate._id}` : "subcategories",
        data: formData,
        language,
      });

      setSubcategories(
        (prev) =>
          subcategoryToUpdate
            ? prev.map((subcategory) => (subcategory._id === subcategoryToUpdate._id ? res.data : subcategory))
            : [{ ...res.data, mainCategory: { _id: mainCategoryId } }, ...prev], // Backend issue: mainCategory property sometimes is and id and sometimes is an object.
      );

      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      if (subcategoryToUpdate) setSubcategoryToUpdate(null);
      else reset();
      setError("");
    }, 250);
  }

  function reset() {
    setImage(null);
    setNameEn("");
    setNameAr("");
  }

  const title = translate(
    `${subcategoryToUpdate ? "Update" : "Add"} Subcategory`,
    `${subcategoryToUpdate ? "تحديث الفئة الفرعية" : "إضافة فئة فرعية"}`,
  );

  const dataChanged = subcategoryToUpdate
    ? image !== subcategoryToUpdate.image || nameEn !== subcategoryToUpdate.name.en || nameAr !== subcategoryToUpdate.name.ar
    : false;

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs sm:text-sm">
            {translate("Please upload a squared image for the subcategory.", "يرجى تحميل صورة مربعة للفئة الفرعية.")}{" "}
            <span className="font-bold text-red-500">*</span>
          </p>
          <ImgController image={image} setImage={setImage} mini className="aspect-square w-[200px]" />
        </div>

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
            disabled={!image || !nameEn || !nameAr || (subcategoryToUpdate ? !dataChanged : false)}
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
