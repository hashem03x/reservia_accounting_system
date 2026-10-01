export type Transfer = {
  _id: string;
  sourceWarehouse: string; // from (warehouse id)
  targetWarehouse: string; // to (warehouse id)
  type: TransferType;
  product: {
    _id: string;
    title: { en: string; ar: string };
    sku?: string;
    barcode?: string;
  };
  details: {
    _id: string;
    product: {
      _id: string;
      title: { en: string; ar: string };
      sku?: string;
      barcode?: string;
    };
    quantity: number;
  }[];
  createdAt: Date;
  updatedAt: Date;
  transferredBy?: {
    _id: string;
    name: string;
  };
};

export type TransferType = "product" | "products";
