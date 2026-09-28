import { ItemDiscount } from "@/types/orders";

export const calculateUnitPriceAfterDiscount = (unitPrice: number, itemDiscount: ItemDiscount) => {
  if (itemDiscount.type === "percentage") return unitPrice - (unitPrice * itemDiscount.value) / 100;
  else return unitPrice - itemDiscount.value;
};

export const calculateSubTotal = (unitPriceAfterDiscount: number, quantity: number) => {
  return unitPriceAfterDiscount * quantity;
};
