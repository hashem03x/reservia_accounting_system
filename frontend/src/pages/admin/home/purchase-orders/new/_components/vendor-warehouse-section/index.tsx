import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Vendor } from "@/types/vendor";
import { Button, Select } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import VendorSearch from "@/components/global/vendor-search";
import VendorModal from "@/components/global/vendor-modal";

export default function VendorWarehouseSection({
  vendor,
  setVendor,
  warehouseId,
  setWarehouseId,
}: {
  vendor: Vendor | null;
  setVendor: React.Dispatch<React.SetStateAction<Vendor | null>>;
  warehouseId: string;
  setWarehouseId: React.Dispatch<React.SetStateAction<string>>;
}) {
  const { translate } = useLanguage();

  const { data: warehouses } = useWarehouses();

  const canICreateVendors = useHasPermission(resources.vendors, actions.create);

  const [vendorModalOpened, { open: openVendorModal, close: closeVendorModal }] = useDisclosure(false);

  return (
    <section className="flex flex-col gap-3 lg:flex-row lg:items-center">
<<<<<<< HEAD
      {/* Supplier = a Vendor. Its Vendor Number is the Sub Account the PO's journal entries post the
          supplier payable to (stamped server-side - see accountingEventService.js). */}
      <div className="flex flex-1 items-end gap-2">
        <div className="flex-1">
          <VendorSearch
            label={translate("Supplier (Vendor)", "المورد (البائع)")}
=======
      {/* Vendor */}
      <div className="flex flex-1 items-end gap-2">
        <div className="flex-1">
          <VendorSearch
            label={translate("Vendor", "البائع")}
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
            placeholder={translate("Select Vendor", "اختر البائع")}
            vendor={vendor}
            setVendor={setVendor}
            withAsterisk
          />
<<<<<<< HEAD
          {vendor && (
            <p className="mt-1 text-xs text-gray-500">
              {translate("Sub Account (Vendor No.)", "الحساب الفرعي (رقم البائع)")}:{" "}
              <span className="font-medium text-gray-700">{vendor.vendorNumber ?? translate("Not assigned", "غير محدد")}</span>
            </p>
          )}
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        </div>
        {canICreateVendors && !vendor && (
          <>
            <Button
              onClick={openVendorModal}
              title={translate("New Vendor", "بائع جديد")}
              variant="light"
              color="teal"
              px="md"
            >
              <solidIcons.Plus size={15} />
            </Button>
            <VendorModal opened={vendorModalOpened} close={closeVendorModal} callback={(response) => setVendor(response)} />
          </>
        )}
      </div>

      {/* Warehouse */}
      <Select
        label={translate("Warehouse", "المخزن")}
        placeholder={translate("Select Warehouse", "اختر المخزن")}
        value={warehouseId}
        onChange={(value) => setWarehouseId(value || "")}
        data={warehouses.map((warehouse) => ({ value: warehouse._id, label: warehouse.name }))}
        allowDeselect={false}
        withAsterisk
        flex={1}
      />
    </section>
  );
}
