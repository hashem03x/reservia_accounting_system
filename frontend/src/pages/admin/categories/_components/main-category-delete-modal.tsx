import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { MainCategory } from "@/types/categories";
import { Alert } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import DeleteModal from "@/components/ui/delete-modal";

export default function DeleteMainCategoryModal({
  opened,
  close,
  mainCategoryToDelete,
  setMainCategoryToDelete,
}: {
  opened: boolean;
  close: () => void;
  mainCategoryToDelete: MainCategory | null;
  setMainCategoryToDelete: React.Dispatch<React.SetStateAction<MainCategory | null>>;
}) {
  const { language, translate } = useLanguage();

  const { setData: setMainCategories } = useMainCategories();

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteMainCategory() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `categories/${mainCategoryToDelete?._id}`, language });
      setMainCategories((prev) => prev.filter((mainCategory) => mainCategory._id !== mainCategoryToDelete?._id));
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setMainCategoryToDelete(null);
      setError("");
    }, 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(
        `Delete Main Category "${mainCategoryToDelete?.name.en}"`,
        `حذف الفئة الرئيسية "${mainCategoryToDelete?.name.ar}"`,
      )}
      subTitle={translate(
        `Are you sure you want to delete this main category?`,
        `هل أنت متأكد أنك تريد حذف هذه الفئة الرئيسية؟`,
      )}
      action={deleteMainCategory}
      loading={loading}
      error={error}
    >
      <Alert color="orange" icon={<solidIcons.ExclamationCircle />}>
        {translate(
          `This action is irreversible and will delete all the subcategories under this main category.`,
          `هذا الإجراء لا يمكن التراجع عنه وسيقوم بحذف جميع الفئات الفرعية تحت هذه الفئة الرئيسية.`,
        )}
      </Alert>
    </DeleteModal>
  );
}
