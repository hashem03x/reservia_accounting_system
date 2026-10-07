import { CartItem } from "./cart";

export type Transaction = {
  transactionId: string;
  createdAt: string;
  amount: number;
  success: boolean;
  userId: string;
  orderId: string;
  cartItems: CartItem[];
};
