import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { Card, Table, Title } from "@mantine/core";
import { formatDate } from "@/utils/helpers/format-date";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";

interface VariantTransaction {
  _id: string;
  createdAt: string;
  createdBy: {
    _id: string;
    name: string;
  };
  vendor?: {
    _id: string;
    name: string;
    contact: {
      phone: string;
    };
  };
  customer?: {
    _id: string;
    name: string;
    phone: string;
  };
  items: {
    starterQuantity: number;
    returnedQuantity: number;
    variant: {
      _id: string;
      color: string;
      size: string;
      variantCode: string;
      sku: string;
      product: {
        title: {
          en: string;
          ar: string;
        };
      };
    };
  }[];
}

interface VariantTransactionsData {
  variant: {
    _id: string;
    productId: {
      title: {
        en: string;
        ar: string;
      };
    };
    color: string;
    size: string;
    variantCode: string;
    sku: string;
    stockLevel: number;
    stockStatus: string;
    stock: {
      _id: string;
      warehouse: string;
      quantity: number;
      starterQuantity: number | null;
    }[];
  };
  purchaseOrders: VariantTransaction[];
  salesOrders: VariantTransaction[];
}

export default function VariantTransactions() {
  const { variantCode } = useParams();
  const { translate, language } = useLanguage();
  const { getWarehouseNameById } = useWarehouseHelpers();
  const privateRequest = usePrivateRequest();

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<VariantTransactionsData | null>(null);

  const fetchData = async () => {
    if (!variantCode) {
      setError("No variant code provided");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await privateRequest({
        url: `variants/transactions/${variantCode}/`,
        method: "GET",
        params: { language: language === "en-US" ? "en" : "ar" },
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });

      if (response?.data) {
        setData(response.data);
      } else {
        setError("Invalid response format");
      }
    } catch (error) {
      console.error(error);
      setError("Failed to fetch variant data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [variantCode, language]);

  if (isLoading) {
    return <LoadingSection message={translate("Loading...", "جاري التحميل...")} className="min-h-full bg-white shadow" />;
  }

  if (error) {
    return (
      <ErrorSection
        errorTitle={translate("Error loading variant data", "خطأ في تحميل بيانات الصنف")}
        errorMessage={error}
        button={{ text: translate("Retry", "إعادة المحاولة"), onClick: fetchData }}
        className="min-h-full bg-white shadow"
      />
    );
  }

  if (!data) {
    return <div className="p-4">{translate("No data available", "لا توجد بيانات متاحة")}</div>;
  }

  const { variant, purchaseOrders, salesOrders } = data;

  const renderTransactionRow = (transaction: VariantTransaction, type: "purchase" | "sale") => {
    const item = transaction.items.find((item) => item.variant._id === variant._id) || {
      starterQuantity: 0,
      returnedQuantity: 0,
    };

    return (
      <Table.Tr key={transaction._id}>
        <Table.Td>
          <Link
            to={`/${paths.admin}/${paths.home}/${type === "purchase" ? paths.purchaseOrders : paths.salesOrders}/${transaction._id}`}
            className="text-blue-600 hover:underline"
          >
            {transaction._id}
          </Link>
        </Table.Td>
        <Table.Td>{formatDate(transaction.createdAt, language)}</Table.Td>
        <Table.Td>{transaction.createdBy?.name}</Table.Td>
        <Table.Td>{type === "purchase" ? transaction.vendor?.name : transaction.customer?.name}</Table.Td>
        <Table.Td>{type === "purchase" ? transaction.vendor?.contact.phone : transaction.customer?.phone}</Table.Td>
        <Table.Td>{item.starterQuantity}</Table.Td>
        <Table.Td>{item.returnedQuantity}</Table.Td>
        <Table.Td>{item.starterQuantity - item.returnedQuantity}</Table.Td>
      </Table.Tr>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Card withBorder className="w-full" radius={15}>
          <Title order={4} mb={4} className="border-b pb-3">
            {translate("Variant Details", "تفاصيل الصنف")}
          </Title>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="mb-1 text-sm text-gray-500">{translate("Product", "المنتج")}</p>
              <p className="font-medium">{variant.productId.title[language === "en-US" ? "en" : "ar"]}</p>
            </div>
            <div>
              <p className="mb-1 text-sm text-gray-500">{translate("Color & Size", "اللون والمقاس")}</p>
              <p className="font-medium">
                {variant.color} - {variant.size}
              </p>
            </div>
            <div>
              <p className="mb-1 text-sm text-gray-500">{translate("Variant Code", "كود الصنف")}</p>
              <p className="font-medium">{variant.variantCode}</p>
            </div>
            <div>
              <p className="mb-1 text-sm text-gray-500">{translate("Stock Status", "حالة المخزون")}</p>
              <div className="flex items-center gap-2">
                {/* <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    variant.stockStatus === "in_stock" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                  }`}
                >
                  {variant.stockStatus === "in_stock"
                    ? translate("In Stock", "متوفر")
                    : translate("Out of Stock", "غير متوفر")}
                </span> */}
                <span className="font-medium">
                  {translate("Current Stock", "المخزون الحالي")}: {variant.stockLevel}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card withBorder radius={15}>
        <Title order={5} mb={4}>
          {translate("Stock Details", "تفاصيل المخزون")}
        </Title>
        <div className="overflow-x-auto">
          <Table withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Warehouse", "المستودع")}</Table.Th>
                <Table.Th>{translate("Current Quantity", "الكمية الحالية")}</Table.Th>
                <Table.Th>{translate("Initial Quantity", "الكمية الأولية")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {variant.stock.map((stockItem) => (
                <Table.Tr key={stockItem._id}>
                  <Table.Td>{getWarehouseNameById(stockItem.warehouse)}</Table.Td>
                  <Table.Td>{stockItem.quantity}</Table.Td>
                  <Table.Td>{stockItem.starterQuantity || 0}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr className="font-bold">
                <Table.Td>{translate("Total", "الإجمالي")}</Table.Td>
                <Table.Td>{variant.stockLevel}</Table.Td>
                <Table.Td>{variant.stock.reduce((acc, item) => acc + (item.starterQuantity || 0), 0)}</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </div>
      </Card>

      <Card withBorder radius={15}>
        <Title order={5} mb={4}>
          {translate("Purchase Orders", "طلبات الشراء")}
        </Title>
        <div className="overflow-x-auto">
          <Table withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Created By", "تم بواسطة")}</Table.Th>
                <Table.Th>{translate("Vendor", "المورد")}</Table.Th>
                <Table.Th>{translate("Vendor Phone", "هاتف المورد")}</Table.Th>
                <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
                <Table.Th>{translate("Returned", "المرتجع")}</Table.Th>
                <Table.Th title={translate("Net quantity after returns", "صافي الكمية بعد المرتجعات")}>
                  {translate("Net Quantity", "صافي الكمية")}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{purchaseOrders.map((order) => renderTransactionRow(order, "purchase"))}</Table.Tbody>
          </Table>
        </div>
      </Card>

      <Card withBorder radius={15}>
        <Title order={5} mb={4}>
          {translate("Sales Orders", "طلبات البيع")}
        </Title>
        <div className="overflow-x-auto">
          <Table withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Created By", "تم بواسطة")}</Table.Th>
                <Table.Th>{translate("Customer", "العميل")}</Table.Th>
                <Table.Th>{translate("Customer Phone", "هاتف العميل")}</Table.Th>
                <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
                <Table.Th>{translate("Returned", "المرتجع")}</Table.Th>
                <Table.Th title={translate("Net quantity after returns", "صافي الكمية بعد المرتجعات")}>
                  {translate("Net Quantity", "صافي الكمية")}
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{salesOrders.map((order) => renderTransactionRow(order, "sale"))}</Table.Tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
