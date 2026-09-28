import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/format-date";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Table } from "@mantine/core";
import { LoadingOverlay } from "@mantine/core";

interface VariantTransaction {
  _id: string;
  items: {
    starterQuantity: number;
    returnedQuantity: number;
    variant: {
      variantCode: string;
      color: string;
      size: string;
      product: {
        title: {
          en: string;
          ar: string;
        };
        price: number;
        priceAfterDiscount: number | null;
      };
    };
  }[];
  createdBy: {
    name: string;
  };
  createdAt: string;
  vendor?: {
    name: string;
    contact: {
      phone: string;
    };
  };
  customer?: {
    name: string;
    phone: string;
  };
}

interface VariantTransactionsResponse {
  status: string;
  data: {
    purchaseOrders: VariantTransaction[];
    salesOrders: VariantTransaction[];
  };
}

export default function VariantTransactionsModal({
  opened,
  close,
  variantCode,
}: {
  opened: boolean;
  close: () => void;
  variantCode: string;
}) {
  const { translate, language } = useLanguage();
  const { privateRequest, loading, error, setLoading, setError } = useDataHandler<VariantTransactionsResponse>({ initialData: { status: "success", data: { purchaseOrders: [], salesOrders: [] } } });
  const [transactions, setTransactions] = useState<VariantTransactionsResponse>({ status: "success", data: { purchaseOrders: [], salesOrders: [] } });

  useEffect(() => {
    if (opened && variantCode) {
      handleRequest(language, setLoading, setError, async () => {
        const response = await privateRequest({
          url: `variants/transactions/${variantCode}`,
          language,
        });
        setTransactions(response);
      });
    }
  }, [opened, variantCode]);

  const renderTransactionRow = (transaction: VariantTransaction, type: 'purchase' | 'sale') => {
    const item = transaction.items.find(item => item.variant.variantCode === variantCode);
    if (!item) return null;

    return (
      <tr key={transaction._id}>
        <td>{transaction._id}</td>
        <td>{formatDate(transaction.createdAt, language)}</td>
        <td>{transaction.createdBy.name}</td>
        <td>{type === 'purchase' ? transaction.vendor?.name : transaction.customer?.name}</td>
        <td>{item.starterQuantity}</td>
        <td>{item.returnedQuantity}</td>
        <td>{item.starterQuantity - item.returnedQuantity}</td>
      </tr>
    );
  };

  return (
    <Modal 
      opened={opened} 
      onClose={close} 
      title={translate("Variant Transactions", "معاملات المنتج")}
      size="xl"
    >
      <div className="relative">
        <LoadingOverlay visible={loading} />
        {error ? (
          <ErrorAlert error={error} />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Purchase Orders */}
            <div>
              <h3 className="mb-3 text-lg font-medium">
                {translate("Purchase Orders", "أوامر الشراء")}
              </h3>
              <Table>
                <thead>
                  <tr>
                    <th>{translate("Order ID", "رقم الطلب")}</th>
                    <th>{translate("Date", "التاريخ")}</th>
                    <th>{translate("Created By", "تم بواسطة")}</th>
                    <th>{translate("Vendor", "المورد")}</th>
                    <th>{translate("Quantity", "الكمية")}</th>
                    <th>{translate("Returned", "المرتجع")}</th>
                    <th>{translate("Net", "الصافي")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions?.data.purchaseOrders.map(order => renderTransactionRow(order, 'purchase'))}
                </tbody>
              </Table>
            </div>

            {/* Sales Orders */}
            <div>
              <h3 className="mb-3 text-lg font-medium">
                {translate("Sales Orders", "أوامر البيع")}
              </h3>
              <Table>
                <thead>
                  <tr>
                    <th>{translate("Order ID", "رقم الطلب")}</th>
                    <th>{translate("Date", "التاريخ")}</th>
                    <th>{translate("Created By", "تم بواسطة")}</th>
                    <th>{translate("Customer", "العميل")}</th>
                    <th>{translate("Quantity", "الكمية")}</th>
                    <th>{translate("Returned", "المرتجع")}</th>
                    <th>{translate("Net", "الصافي")}</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions?.data.salesOrders.map(order => renderTransactionRow(order, 'sale'))}
                </tbody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
