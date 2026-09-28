import { Variant } from "@/types/product";

export type OrderItemInput = {
  variantCode: string;
  variantError: boolean;
  // The following always come together (variant data and its inputs)
  // 1. The original variant data coming from the server
  variantData:
    | (Variant & {
        product: {
          _id: string;
          title: { en: string; ar: string };
          cost: number;
          price: number;
        };
      })
    | null;
  // 2. For the inputs
  unitPrice: number;
  itemDiscount: ItemDiscount;
  unitPriceAfterDiscount: number;
  starterQuantity: number;
  starterSubtotal: number;
};
