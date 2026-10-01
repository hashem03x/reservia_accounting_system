export type OrderItemInput = {
  productCode: string;
  productError: boolean;
  // The following always come together (product data and its inputs)
  // 1. The original product data coming from the server
  productData: {
    _id: string;
    title: { en: string; ar: string };
    cost: number;
    price: number;
  } | null;
  // 2. For the inputs
  unitPrice: number;
  itemDiscount: ItemDiscount;
  unitPriceAfterDiscount: number;
  starterQuantity: number;
  starterSubtotal: number;
};
