import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useSubcategories } from "@/context/SubcategoriesContext";
import { useLanguage } from "@/context/LanguageContext";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import copyToClipboard from "@/utils/helpers/copy-to-clipboard";
import { MainCategory, Subcategory } from "@/types/categories";
import { Button, Menu } from "@mantine/core";
import { solidIcons, outlineIcons } from "@/components/icons";
import ErrorSection from "@/components/ui/sections/error";
import LoadingSection from "@/components/ui/sections/loading";
import SubcategoryCard from "./subcategory-card";
import SubcategoryModal from "./subcategory-modal";
import DeleteSubcategoryModal from "./subcategory-delete-modal";

export default function MainCategorySection({
  mainCategory,
  openUpdateModal,
  openDeleteModal,
}: {
  mainCategory: MainCategory;
  openUpdateModal: (() => void) | null;
  openDeleteModal: (() => void) | null;
}) {
  const { translate, translations } = useLanguage();

  const { loading, error, reFetch } = useSubcategories();
  const { getSubcategoriesByMainCategoryId } = useCategoryHelpers();
  const subcategories = mainCategory?._id ? getSubcategoriesByMainCategoryId(mainCategory._id) : [];

  const [copied, setCopied] = useState(false);

  const canIcreateSubcategories = useHasPermission(resources.subcategories, actions.create);
  const canIupdateSubcategories = useHasPermission(resources.subcategories, actions.update);
  const canIdeleteSubcategories = useHasPermission(resources.subcategories, actions.delete);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteSubcatModalOpened, { open: openDeleteSubcatModal, close: closeDeleteSubcatModal }] = useDisclosure(false);

  const [subcategoryToUpdate, setSubcategoryToUpdate] = useState<Subcategory | null>(null);
  const [subcategoryToDelete, setSubcategoryToDelete] = useState<Subcategory | null>(null);

  function handleOpenSubUpdateModal(subcategory: Subcategory) {
    setSubcategoryToUpdate(subcategory);
    openModal();
  }

  function handleOpenSubDeleteModal(subcategory: Subcategory) {
    setSubcategoryToDelete(subcategory);
    openDeleteSubcatModal();
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg bg-white p-3 shadow sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2>{translate(mainCategory?.name.en, mainCategory?.name.ar)}</h2>
        {(canIcreateSubcategories || openUpdateModal || openDeleteModal) && (
          <Menu withArrow width={215} radius={7.5} shadow="md">
            <Menu.Target>
              <Button variant="light">
                <solidIcons.TbMenu />
              </Button>
            </Menu.Target>

            <Menu.Dropdown dir={translations.dir}>
              <Menu.Item
                leftSection={copied ? <solidIcons.Check /> : <outlineIcons.Copy />}
                onClick={() => copyToClipboard(mainCategory?._id, setCopied)}
              >
                {translate("Copy ID", "نسخ الرقم التعريفى")}
              </Menu.Item>
              {canIcreateSubcategories && (
                <Menu.Item leftSection={<solidIcons.Plus />} onClick={openModal}>
                  {translate("Add Subcategory", "إضافة فئة فرعية")}
                </Menu.Item>
              )}

              {openUpdateModal && (
                <Menu.Item leftSection={<outlineIcons.Edit />} onClick={openUpdateModal}>
                  {translate("Update Main Category", "تعديل الفئة الرئيسية")}
                </Menu.Item>
              )}

              {openDeleteModal ? (
                openUpdateModal ? (
                  <Menu.Divider />
                ) : canIcreateSubcategories ? (
                  <Menu.Divider />
                ) : null
              ) : null}

              {openDeleteModal && (
                <>
                  <Menu.Label>{translate("Danger Zone", "منطقة الخطر")}</Menu.Label>
                  <Menu.Item color="red" leftSection={<outlineIcons.Trash />} onClick={openDeleteModal}>
                    {translate("Delete Main Category", "حذف الفئة الرئيسية")}
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </header>

      {loading ? (
        <LoadingSection message={translate("Loading Subcategories...", "جاري تحميل الفئات الفرعية...")} className="py-28" />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Failed to Load Subcategories", "فشل تحميل الفئات الفرعية")}
          errorMessage={error}
          button={{ text: translate("Try Again", "حاول مرة أخرى"), onClick: reFetch }}
          className="py-20"
        />
      ) : subcategories.length === 0 ? (
        <p>{translate("No Subcategories Found", "لا توجد فئات فرعية")}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {subcategories.map((subcategory) => (
            <SubcategoryCard
              key={subcategory._id}
              subcategory={subcategory}
              openUpdateModal={canIupdateSubcategories ? () => handleOpenSubUpdateModal(subcategory) : null}
              openDeleteModal={canIdeleteSubcategories ? () => handleOpenSubDeleteModal(subcategory) : null}
            />
          ))}
        </div>
      )}

      <SubcategoryModal
        opened={modalOpened}
        close={closeModal}
        mainCategoryId={mainCategory?._id}
        subcategoryToUpdate={subcategoryToUpdate}
        setSubcategoryToUpdate={setSubcategoryToUpdate}
      />
      <DeleteSubcategoryModal
        opened={deleteSubcatModalOpened}
        close={closeDeleteSubcatModal}
        subcategoryToDelete={subcategoryToDelete}
        setSubcategoryToDelete={setSubcategoryToDelete}
      />
    </section>
  );
}
