import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { Variant } from "@/types/product";
import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import EmptySection from "@/components/ui/sections/empty";
import { NavMethods } from "..";
import { useProduct } from "../context";
import SavingAlert from "./_components/saving-alert";
import VariantCard from "./_components/variant-card";
import VariantModal from "./_components/variant-modal";
import DeleteVariantModal from "./_components/delete-variant-modal";
import PrintAllVariantsBarcode from "./_components/print-all-variants-barcode";

export default function Variants({ navMethods }: { navMethods: NavMethods }) {
  const { translate } = useLanguage();

  const { currentProduct, variants, canIUpdateProducts } = useProduct();

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);

  const [variantToUpdate, setVariantToUpdate] = useState<Variant | null>(null);
  const [variantToDelete, setVariantToDelete] = useState<Variant | null>(null);

  function handleOpenUpdateModal(variant: Variant) {
    setVariantToUpdate(variant);
    openModal();
  }

  function handleOpenDeleteModal(variant: Variant) {
    setVariantToDelete(variant);
    openDeleteModal();
  }

  return (
    <div className="flex min-h-full flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-4 shadow">
        <div className="flex flex-col">
          <h2>{translate("Variants", "الأصناف")}</h2>
          <p className="text-xs sm:text-sm">
            {translate(
              "Here you can control sizes and inventory of the product.",
              "هنا يمكن التحكم في المقاسات وتخزين المنتج.",
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {currentProduct && variants.length > 0 && (
            <PrintAllVariantsBarcode product={currentProduct} variants={variants.filter((v) => !v.isDeleted)} />
          )}
          {currentProduct && canIUpdateProducts && (
            <Button onClick={openModal} leftSection={<solidIcons.Plus />} variant="light" color="teal" radius="md">
              {translate("Add Variant", "اضافة صنف")}
            </Button>
          )}
        </div>
      </header>

      {currentProduct ? (
        <div className="flex min-h-full flex-1 flex-col">
          {variants.filter((variant) => !variant.isDeleted).length > 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {variants
                .filter((variant) => !variant.isDeleted)
                .map((variant, index) => (
                  <VariantCard
                    key={index}
                    variant={variant}
                    openUpdateModal={() => handleOpenUpdateModal(variant)}
                    openDeleteModal={() => handleOpenDeleteModal(variant)}
                  />
                ))}
            </div>
          ) : (
            <EmptySection
              useDefaultImg
              className="min-h-full flex-1 rounded-xl bg-white py-20 shadow"
              message={translate("No variants found.", "لا يوجد أي صنف.")}
            />
          )}
        </div>
      ) : (
        // Alert to save the basic information first
        <SavingAlert toBasicInfo={navMethods.basic} />
      )}

      {/* Modals */}
      {currentProduct && (
        <>
          <VariantModal
            opened={modalOpened}
            close={closeModal}
            variantToUpdate={variantToUpdate}
            setVariantToUpdate={setVariantToUpdate}
          />
          <DeleteVariantModal
            opened={deleteModalOpened}
            close={closeDeleteModal}
            variantToDelete={variantToDelete}
            setVariantToDelete={setVariantToDelete}
          />
        </>
      )}
    </div>
  );
}
