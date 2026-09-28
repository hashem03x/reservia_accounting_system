export type Coupon = {
  _id: number;
  name: string;
  expire: string;
  discount: number;
  maxUses: number;
  remainingUses: number;
};
