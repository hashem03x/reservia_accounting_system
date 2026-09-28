import { useLanguage } from "@/context/LanguageContext";
import { createContext, ReactNode, useContext } from "react";
import { isPaid, isUnpaid, getPaymentStatusLabel } from "@/utils/constants/payment-statuses";
import { PurchaseOrder, PurchaseOrderItem } from "@/types/orders";
import { Payment } from "@/types/payment";
import { ReturnRecord } from "@/types/orders";
import { solidIcons } from "@/components/icons";
// import { mapReturnProcessesToReturnItems } from "./_utils";

type OrderContextProps = {
  order: PurchaseOrder;
  setOrder: React.Dispatch<React.SetStateAction<PurchaseOrder>>;
  payments: Payment[];
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
  returnRecords: ReturnRecord[];
  setReturnRecords: React.Dispatch<React.SetStateAction<ReturnRecord[]>>;
  returnedItems: PurchaseOrderItem[];
  // Some Elements
  orderPaymentStatusElement: ReactNode;
};

const OrderContext = createContext<OrderContextProps>({
  order: {} as PurchaseOrder,
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
  order: PurchaseOrder;
  setOrder: React.Dispatch<React.SetStateAction<PurchaseOrder>>;
  payments: Payment[];
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
  returnRecords: ReturnRecord[];
  setReturnRecords: React.Dispatch<React.SetStateAction<ReturnRecord[]>>;
  children: ReactNode;
}) {
  const { language } = useLanguage();

  const orderPaymentStatusElement = order ? (
    <div className="flex items-center gap-1.5">
      {isPaid(order.paymentStatus) ? (
        <solidIcons.CheckCircle className="text-green-500" />
      ) : isUnpaid(order.paymentStatus) ? (
        <solidIcons.XmarkCircle className="text-red-500" />
      ) : (
        <solidIcons.Circle className="text-orange-500" />
      )}
      <span className="font-bold text-gray-800">{getPaymentStatusLabel(order.paymentStatus, language)}</span>
    </div>
  ) : null;

  const returnedItems: PurchaseOrderItem[] = order.items.filter((item) => item.returnedQuantity > 0);
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
