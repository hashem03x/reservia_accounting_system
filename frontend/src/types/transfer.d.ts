import { Variant } from "./product";

type TransferedVariant = Omit<Variant, "stock">;

export type Transfer = {
  _id: string;
  sourceWarehouse: string; // from (warehouse id)
  targetWarehouse: string; // to (warehouse id)
  type: TransferType;
  product: {
    _id: string;
    title: { en: string; ar: string };
  };
  details: {
    _id: string;
    variant: TransferedVariant;
    quantity: number;
  }[];
  createdAt: Date;
  updatedAt: Date;
  transferredBy?: {
    _id: string;
    name: string;
  };
};

export type TransferType = "product" | "variants";
