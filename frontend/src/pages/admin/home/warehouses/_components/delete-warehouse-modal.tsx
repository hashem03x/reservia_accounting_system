import { Warehouse } from "@/types/warehouse";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import DeleteModal from "@/components/ui/delete-modal";
import { solidIcons } from "@/components/icons";
import { Alert, TextInput } from "@mantine/core";
import { useState } from "react";

export default function DeleteWarehouseModal({
  opened,
  close,
  warehouseToDelete,
  setWarehouseToDelete,
}: {
  opened: boolean;
  close: () => void;
  warehouseToDelete: Warehouse | null;
  setWarehouseToDelete: React.Dispatch<React.SetStateAction<Warehouse | null>>;
}) {
  const { language, translate } = useLanguage();

  const { setData: setWarehouses } = useWarehouses();

  const [confimation, setConfimation] = useState("");

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  function deleteWarehouse() {
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({ method: "DELETE", url: `warehouses/${warehouseToDelete?._id}`, language });
      setWarehouses((prev) => prev.filter((warehouse) => warehouse._id !== warehouseToDelete?._id));
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setWarehouseToDelete(null);
      setConfimation("");
      setError("");
    }, 250);
  }

  return (
    <DeleteModal
      opened={opened}
      onClose={handleClose}
      title={translate(`Delete Warehouse "${warehouseToDelete?.name}"`, `حذف المخزن "${warehouseToDelete?.name}"`)}
      subTitle={translate(`Are you sure you want to delete this warehouse?`, `هل أنت متأكد أنك تريد حذف هذه المخزن؟`)}
      disabled={confimation !== warehouseToDelete?.name}
      action={deleteWarehouse}
      loading={loading}
      error={error}
    >
      <TextInput
        required
        value={confimation}
        onChange={(e) => setConfimation(e.currentTarget.value)}
        label={translate("Please type the warehouse name to confirm", "الرجاء كتابة اسم المخزن للتأكيد")}
        placeholder={translate("Warehouse name", "اسم المخزن")}
      />
      <Alert color="orange" icon={<solidIcons.ExclamationCircle />}>
        {translate("Be careful! This action is irreversible!", "كن حذرًا! لا يمكن التراجع عن هذا الإجراء!")}
      </Alert>
    </DeleteModal>
  );
}
