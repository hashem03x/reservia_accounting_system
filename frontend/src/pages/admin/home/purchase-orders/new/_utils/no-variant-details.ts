import { OrderItemInput } from "../types";

const noVariantDetails: Omit<OrderItemInput, "variantCode" | "variantError"> = {
  variantData: null,
  unitPrice: 0,
  itemDiscount: { type: "percentage", value: 0 },
  unitPriceAfterDiscount: 0,
  starterQuantity: 0,
  starterSubtotal: 0,
};

export default noVariantDetails;
