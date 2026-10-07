import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import { solidIcons } from "@/components/icons";
import Modal from "@/components/ui/modal";

export default function BalanceModal({ opened, close }: { opened: boolean; close: () => void }) {
  const { translate, translations } = useLanguage();
  const { data: warehouses } = useWarehouses();

  function handleClose() {
    close();
    // setTimeout(() => {}, 250);
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Warehouse Balances", "أرصدة الفروع")}>
      <div className="flex flex-col gap-3">
        {warehouses.map((warehouse) => (
          <div key={warehouse._id} className="flex items-center justify-between gap-2.5 rounded-lg bg-gray-100 p-4">
            <div className="flex items-center gap-2.5">
              <span className="rounded-lg bg-orange-100 p-2.5">
                <solidIcons.DollarSign size={15} className="text-orange-600" />
              </span>
              <h4 className="font-medium">{warehouse.name}</h4>
            </div>

            <span className="font-semibold text-gray-800">
              {warehouse.balance.toLocaleString()} {translations.currency}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
