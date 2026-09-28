import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useMainCategories } from "@/context/MainCategoriesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { MainCategory } from "@/types/categories";
import { Button } from "@mantine/core";
import EmptySection from "@/components/ui/sections/empty";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import MainCategorySection from "./_components/main-category-section";
import MainCategoryModal from "./_components/main-category-modal";
import DeleteMainCategoryModal from "./_components/main-category-delete-modal";

export default function Categories() {
  const { translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.categories} | ${translations.adminPanel}`);

  const { loading, error, data: mainCategories, reFetch } = useMainCategories();

  const canIcreateMainCategories = useHasPermission(resources.categories, actions.create);
  const canIupdateMainCategories = useHasPermission(resources.categories, actions.update);
  const canIdeleteMainCategories = useHasPermission(resources.categories, actions.delete);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);

  const [mainCategoryToUpdate, setMainCategoryToUpdate] = useState<MainCategory | null>(null);
  const [mainCategoryToDelete, setMainCategoryToDelete] = useState<MainCategory | null>(null);

  function handleOpenUpdateModal(mainCategory: MainCategory) {
    setMainCategoryToUpdate(mainCategory);
    openModal();
  }

  function handleOpenDeleteModal(mainCategory: MainCategory) {
    setMainCategoryToDelete(mainCategory);
    openDeleteModal();
  }

  return (
    <div className="root-flex-1 flex h-full flex-col gap-4">
      <header className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-col gap-2">
          <h1>{translations.pages.categories}</h1>
          <p>
            {translate(
              "The main categories are each organized into several subcategories.",
              "إن كل فئة رئيسية مقسمة إلى عدة فئات فرعية.",
            )}
          </p>
        </div>

        {canIcreateMainCategories && (
          <Button color="blue" variant="light" onClick={openModal}>
            {translate("Add New Main Category", "إضافة فئة رئيسية جديدة")}
          </Button>
        )}
      </header>

      {loading ? (
        <LoadingSection message={translate("Loading categories...", "جاري تحميل الفئات...")} className="bg-white shadow" />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading categories", "خطأ في تحميل الفئات")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: reFetch }}
          className="border border-red-100"
        />
      ) : mainCategories.length === 0 ? (
        <EmptySection
          useDefaultImg
          message={translate("No main categories found", "لا توجد فئات رئيسية")}
          className="bg-white shadow"
        />
      ) : (
        mainCategories.map((category) => (
          <MainCategorySection
            key={category._id}
            mainCategory={category}
            openUpdateModal={canIupdateMainCategories ? () => handleOpenUpdateModal(category) : null}
            openDeleteModal={canIdeleteMainCategories ? () => handleOpenDeleteModal(category) : null}
          />
        ))
      )}

      {/* Modals */}
      <MainCategoryModal
        opened={modalOpened}
        close={closeModal}
        mainCategoryToUpdate={mainCategoryToUpdate}
        setMainCategoryToUpdate={setMainCategoryToUpdate}
      />
      <DeleteMainCategoryModal
        opened={deleteModalOpened}
        close={closeDeleteModal}
        mainCategoryToDelete={mainCategoryToDelete}
        setMainCategoryToDelete={setMainCategoryToDelete}
      />
    </div>
  );
}
