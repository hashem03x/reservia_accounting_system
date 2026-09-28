import { Subcategory } from "@/types/categories";
import { useLanguage } from "@/context/LanguageContext";
import { useSubcategories } from "@/context/SubcategoriesContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";

export default function DeleteSubcategoryModal({
  opened,
  close,
  subcategoryToDelete,
  setSubcategoryToDelete,
}: {
  opened: boolean;
  close: () => void;
  subcategoryToDelete: Subcategory | null;
  setSubcategoryToDelete: React.Dispatch<React.SetStateAction<Subcategory | null>>;
}) {
  const { language, translate } = useLanguage();

  const { setData: setSubcategories } = useSubcategories();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteSubcategory() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `subcategories/${subcategoryToDelete?._id}`, language });
      setSubcategories((prev) => prev.filter((subcategory) => subcategory._id !== subcategoryToDelete?._id));
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setSubcategoryToDelete(null);
      setError("");
    }, 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(
        `Delete Subategory "${subcategoryToDelete?.name.en}"`,
        `حذف الفئة الفرعية "${subcategoryToDelete?.name.ar}"`,
      )}
      subTitle={translate(
        `Are you sure you want to delete this subcategory?`,
        `هل أنت متأكد أنك تريد حذف هذه الفئة الفرعية؟`,
      )}
      action={deleteSubcategory}
      loading={loading}
      error={error}
    ></DeleteModal>
  );
}
