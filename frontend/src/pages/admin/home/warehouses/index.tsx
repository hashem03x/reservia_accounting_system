import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Warehouse } from "@/types/warehouse";
import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import WarehouseCard from "./_components/warehouse-card";
import WarehouseModal from "./_components/warehouse-modal";
import DeleteWarehouseModal from "./_components/delete-warehouse-modal";

export default function Warehouses() {
  const { translations, translate } = useLanguage();

  useDocumentTitle(`${translations.pages.warehouses} | ${translations.adminPanel}`);

  const { loading, error, data: warehouses, reFetch } = useWarehouses();

  const canICreateWarehouses = useHasPermission(resources.warehouses, actions.create);
  const canIUpdateWarehouses = useHasPermission(resources.warehouses, actions.update);
  const canIDeleteWarehouses = useHasPermission(resources.warehouses, actions.delete);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);

  const [warehouseToUpdate, setWarehouseToUpdate] = useState<Warehouse | null>(null);
  const [warehouseToDelete, setWarehouseToDelete] = useState<Warehouse | null>(null);

  function handleOpenUpdateModal(warehouse: Warehouse) {
    setWarehouseToUpdate(warehouse);
    openModal();
  }

  function handleOpenDeleteModal(warehouse: Warehouse) {
    setWarehouseToDelete(warehouse);
    openDeleteModal();
  }

  return (
    <AdminLayoutBox
      header={{
        backLink: true,
        title: translations.pages.warehouses,
        sideElements: canICreateWarehouses && (
          <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
            {translate("Add New Warehouse", "إضافة مخزن جديد")}
          </Button>
        ),
        border: true,
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading Warehouses...", "جاري تحميل المخازن...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error Loading Warehouses", "خطأ في تحميل المخازن")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: reFetch }}
        />
      ) : warehouses.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No Warehouses Found", "لا توجد مخازن")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {warehouses.map((warehouse) => (
            <WarehouseCard
              key={warehouse._id}
              warehouse={warehouse}
              openUpdateModal={canIUpdateWarehouses ? () => handleOpenUpdateModal(warehouse) : null}
              openDeleteModal={canIDeleteWarehouses ? () => handleOpenDeleteModal(warehouse) : null}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <WarehouseModal
        opened={modalOpened}
        close={closeModal}
        warehouseToUpdate={warehouseToUpdate}
        setWarehouseToUpdate={setWarehouseToUpdate}
      />
      <DeleteWarehouseModal
        opened={deleteModalOpened}
        close={closeDeleteModal}
        warehouseToDelete={warehouseToDelete}
        setWarehouseToDelete={setWarehouseToDelete}
      />
    </AdminLayoutBox>
  );
}
