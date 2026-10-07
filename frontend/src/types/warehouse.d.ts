import { ContextProps } from "@/types/global";

export type Warehouse = {
  _id: string;
  name: string;
  location: string;
  image: string | null;
  balance: number;
  usd: {
    balance: number;
    exchangeRate: number;
  };
  eur: {
    balance: number;
    exchangeRate: number;
  };
  try: {
    balance: number;
    exchangeRate: number;
  };
  cny: {
    balance: number;
    exchangeRate: number;
  };
  totalBalanceEGP: number; // total balance of all currencies (after exchange) in EGP
  isDefault: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WarehousesContextProps = ContextProps<Warehouse[]>;
