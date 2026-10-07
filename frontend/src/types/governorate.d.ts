import { ContextProps } from "@/types/global";

export type Governorate = {
  _id: string;
  name: {
    en: string;
    ar: string;
  };
  shippingCost: number;
};

export type GovernorateContextProps = ContextProps<Governorate[]>;
