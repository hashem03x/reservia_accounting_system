import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Customer } from "@/types/customer";
import { Button, Select } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import CustomerSearch from "@/components/global/customer-search";
import CustomerModal from "@/components/global/customer-modal";

export default function CustomerWarehouseSection({
  customer,
  setCustomer,
  warehouseId,
  setWarehouseId,
}: {
  customer: Customer | null;
  setCustomer: React.Dispatch<React.SetStateAction<Customer | null>>;
  warehouseId: string;
  setWarehouseId: React.Dispatch<React.SetStateAction<string>>;
}) {
  const { translate } = useLanguage();

  const { data: warehouses } = useWarehouses();

  const canICreateCustomers = useHasPermission(resources.customers, actions.create);

  const [customerModalOpened, { open: openCustomerModal, close: closeCustomerModal }] = useDisclosure(false);

  return (
    <section className="flex flex-col gap-3 lg:flex-row lg:items-center">
      {/* Customer */}
      <div className="flex flex-1 items-end gap-2">
        <div className="flex-1">
          <CustomerSearch
            label={translate("Customer", "العميل")}
            placeholder={translate("Select Customer", "اختر العميل")}
            customer={customer}
            setCustomer={setCustomer}
            withAsterisk
          />
        </div>
        {canICreateCustomers && !customer && (
          <>
            <Button
              onClick={openCustomerModal}
              title={translate("New Customer", "عميل جديد")}
              variant="light"
              color="teal"
              px="md"
            >
              <solidIcons.Plus size={15} />
            </Button>
            <CustomerModal
              opened={customerModalOpened}
              close={closeCustomerModal}
              callback={(response) => setCustomer(response)}
            />
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
