import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Vendor } from "@/types/vendor";
import { Button, Select, TextInput } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import VendorSearch from "@/components/global/vendor-search";
import VendorModal from "@/components/global/vendor-modal";

export default function VendorWarehouseSection({
  vendor,
  setVendor,
  warehouseId,
  setWarehouseId,
  // Set once a Purchase Order is selected (docs section "Link Purchase Invoices to Purchase
  // Orders") - the vendor is then that Purchase Order's own vendor, not independently choosable:
  // the backend rejects a mismatch, so the UI never offers to create one.
  locked = false,
}: {
  vendor: Vendor | null;
  setVendor: React.Dispatch<React.SetStateAction<Vendor | null>>;
  warehouseId: string;
  setWarehouseId: React.Dispatch<React.SetStateAction<string>>;
  locked?: boolean;
}) {
  const { translate } = useLanguage();

  const { data: warehouses } = useWarehouses();

  const canICreateVendors = useHasPermission(resources.vendors, actions.create);

  const [vendorModalOpened, { open: openVendorModal, close: closeVendorModal }] = useDisclosure(false);

  return (
    <section className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {/* Supplier = a Vendor. Its Vendor Number is the Sub Account the PO's journal entries post the
          supplier payable to (stamped server-side - see accountingEventService.js). */}
      <div className="flex flex-1 items-end gap-2">
        <div className="flex-1">
          {locked ? (
            <TextInput
              label={translate("Supplier (Vendor)", "المورد (البائع)")}
              value={vendor?.name || ""}
              readOnly
              description={translate(
                "Set by the selected Purchase Order.",
                "محدد من أمر الشراء المختار.",
              )}
            />
          ) : (
            <VendorSearch
              label={translate("Supplier (Vendor)", "المورد (البائع)")}
              placeholder={translate("Select Vendor", "اختر البائع")}
              vendor={vendor}
              setVendor={setVendor}
              withAsterisk
            />
          )}
          {vendor && (
            <p className="mt-1 text-xs text-gray-500">
              {translate("Sub Account (Vendor No.)", "الحساب الفرعي (رقم البائع)")}:{" "}
              <span className="font-medium text-gray-700">{vendor.vendorNumber ?? translate("Not assigned", "غير محدد")}</span>
            </p>
          )}
        </div>
        {!locked && canICreateVendors && !vendor && (
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
