import { useWarehouses } from "@/context/WarehousesContext";
import { PaymentType } from "@/types/payment";

export default function useWarehouseHelpers() {
  const { data: warehouses, setData: setWarehouses } = useWarehouses();

  function getWarehouseById(warehouseId: string) {
    return warehouses.find((warehouse) => warehouse._id === warehouseId);
  }

  function getWarehouseNameById(warehouseId: string): string {
    const warehouse = getWarehouseById(warehouseId);
    if (!warehouse) return "";
    return warehouse.name;
  }

  function updateWarehouseBalanceById(warehouseId: string, amount: number, type: PaymentType) {
    const warehouse = getWarehouseById(warehouseId);
    if (!warehouse) return;

    if (type === "in") {
      warehouse.balance += amount;
    } else if (type === "out") {
      warehouse.balance -= amount;
    }

    setWarehouses((prev) => {
      return prev.map((prevWarehouse) => {
        if (prevWarehouse._id === warehouseId) {
          return warehouse;
        }
        return prevWarehouse;
      });
    });
  }

  return {
    getWarehouseById,
    getWarehouseNameById,
    updateWarehouseBalanceById,
  };
}
