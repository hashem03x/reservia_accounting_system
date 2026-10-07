import { OrderItemInput } from "../types";

const noProductDetails: Omit<OrderItemInput, "productCode" | "productError"> = {
  productData: null,
  unitPrice: 0,
  itemDiscount: { type: "percentage", value: 0 },
  unitPriceAfterDiscount: 0,
  starterQuantity: 0,
  starterSubtotal: 0,
};

export default noProductDetails;
