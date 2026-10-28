import { ItemDiscount } from "@/types/orders";

// Inputs may be empty while being typed (a line without a price yet) - treated as 0, never NaN.
export const calculateUnitPriceAfterDiscount = (unitPrice: number, itemDiscount: ItemDiscount) => {
  const price = Number(unitPrice) || 0;
  const discount = Number(itemDiscount.value) || 0;
  if (itemDiscount.type === "percentage") return price - (price * discount) / 100;
  else return price - discount;
};

export const calculateSubTotal = (unitPriceAfterDiscount: number, quantity: number) => {
  return (Number(unitPriceAfterDiscount) || 0) * (Number(quantity) || 0);
};
