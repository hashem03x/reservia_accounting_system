import { createContext, ReactNode, useContext } from "react";
import { SalesOrder, SalesOrderItem } from "@/types/orders";
import { Payment } from "@/types/payment";
import { ReturnRecord } from "@/types/orders";
import OrderPaymentStatus from "@/components/global/order-payment-status";

type OrderContextProps = {
  order: SalesOrder;
  setOrder: React.Dispatch<React.SetStateAction<SalesOrder>>;
  payments: Payment[];
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
  returnRecords: ReturnRecord[];
  setReturnRecords: React.Dispatch<React.SetStateAction<ReturnRecord[]>>;
  returnedItems: SalesOrderItem[];
  // Some Elements
  orderPaymentStatusElement: ReactNode;
};

const OrderContext = createContext<OrderContextProps>({
  order: {} as SalesOrder,
  setOrder: () => {},
  payments: [],
  setPayments: () => {},
  returnRecords: [],
  setReturnRecords: () => {},
  returnedItems: [],
  orderPaymentStatusElement: null,
});

export default function OrderProvider({
  order,
  setOrder,
  payments,
  setPayments,
  returnRecords,
  setReturnRecords,
  children,
}: {
  order: SalesOrder;
  setOrder: React.Dispatch<React.SetStateAction<SalesOrder>>;
  payments: Payment[];
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
  returnRecords: ReturnRecord[];
  setReturnRecords: React.Dispatch<React.SetStateAction<ReturnRecord[]>>;
  children: ReactNode;
}) {
  const orderPaymentStatusElement = order ? <OrderPaymentStatus order={order} /> : null;

  const returnedItems: SalesOrderItem[] = order.items.filter((item) => item.returnedQuantity > 0);
  // const returnedItems = mapReturnProcessesToReturnItems(returnProcesses, order.items.map((item) => item.variant) || []);

  return (
    <OrderContext.Provider
      value={{
        order,
        setOrder,
        payments,
        setPayments,
        returnRecords,
        setReturnRecords,
        returnedItems,
        orderPaymentStatusElement,
      }}
    >
      {children}
    </OrderContext.Provider>
  );
}

export const useOrder = () => useContext(OrderContext);
