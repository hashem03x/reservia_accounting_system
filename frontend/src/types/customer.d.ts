export type CustomerType = "online" | "offline";

export type Customer = {
  _id: string;
  name: string;
  balance: number;
  isDeleted: boolean;
  type: CustomerType;
  phone: string;
  additionalPhone: string;
  email?: string;
  offlineAddress?: {
    country?: string;
    city?: string;
    street?: string;
    postalCode?: string;
  };
};
