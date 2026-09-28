import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import InfoItem from "@/components/ui/info-item";
import { Table } from "@mantine/core";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import { solidIcons } from "@/components/icons";
import { getColorLabel } from "@/utils/constants/colors";
import { Color } from "@/types/product";
import { getOrderSourceLabel } from "@/utils/constants/order-sources";
import { OrderSource } from "@/types/orders";

type VariantHistoryData = {
  variant: {
    _id: string;
    variantCode: string;
    sku: string;
    color: Color;
    size: string;
    stock: Array<{
      warehouse: string;
      quantity: number;
      starterQuantity: number | null;
      _id: string;
      id: string;
    }>;
    product: {
      _id: string;
      title: { en: string; ar: string };
      cost: number;
      price: number;
      priceAfterDiscount: number | null;
    };
    currentStock: number;
  };
  summary: {
    starterQuantity: number;
    totalPurchased: number;
    totalPurchaseReturned: number;
    totalSold: number;
    totalSalesReturned: number;
    totalTransferred: number;
    currentStock: number;
    calculatedBalance: number;
  };
  purchaseOrders: Array<{
    orderId: string;
    code: string;
    type: string;
    vendor: string;
    warehouse: string;
    quantityPurchased: number;
    quantityReturned: number;
    netQuantity: number;
    unitPrice: number;
    unitPriceAfterDiscount: number;
    starterSubtotal: number;
    finalSubtotal: number;
    date: string;
  }>;
  salesOrders: Array<{
    orderId: string;
    code: string;
    type: string;
    customer: string;
    warehouse: string;
    orderSource: OrderSource;
    quantitySold: number;
    quantityReturned: number;
    netQuantity: number;
    unitPrice: number;
    unitPriceAfterDiscount: number;
    starterSubtotal: number;
    finalSubtotal: number;
    date: string;
  }>;
  transfers: Array<{
    transferId: string;
    type: string;
    quantityTransferred: number;
    sourceWarehouse: string;
    targetWarehouse: string;
    status: string;
    transferredBy: string;
    date: string;
  }>;
};

export default function Variant() {
  const { language, translate, translations } = useLanguage();
  const { getWarehouseNameById } = useWarehouseHelpers();

  useDocumentTitle(`${translate("Variant Information", "معلومات الصنف")} | ${translations.adminPanel}`);

  const { code } = useParams<{ code: string }>();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: variant,
    setData: setVariant,
  } = useDataHandler<VariantHistoryData | null>({ initialData: null, initialLoading: true });

  function handleLoadVariant() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({ url: `variants/history/${code}`, signal: controller.signal, language });
      setVariant(response.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadVariant(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isStockBalanced = variant && variant.summary.currentStock === variant.summary.calculatedBalance;

  return (
    <AdminLayoutBox
      header={{
        title: translate("Variant Information", "معلومات الصنف"),
        backLink: true,
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading variant information", "جاري تحميل معلومات الصنف")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("An error occurred while loading variant information", "حدث خطأ أثناء تحميل معلومات الصنف")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadVariant }}
        />
      ) : (
        variant && (
          <section className="flex flex-1 flex-col gap-4">
            {/* Variant Basic Info */}
            <div className="rounded-lg bg-gray-100 px-6 py-4">
              <h2 className="mb-3 text-lg">{translate("Basic Details", "التفاصيل الأساسية")}</h2>
              <hr className="mb-3" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                <InfoItem label={translate("Code", "الكود")} value={variant.variant.variantCode} />
                <InfoItem
                  label={translate("Product", "المنتج")}
                  value={translate(variant.variant.product.title.en, variant.variant.product.title.ar)}
                />
                <InfoItem label={translate("Color", "اللون")} value={getColorLabel(variant.variant.color, language)} />
                <InfoItem label={translate("Size", "المقاس")} value={variant.variant.size} />
              </div>
            </div>

            {/* Stock by Warehouse */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-gray-800">{translate("Stock Details", "تفاصيل المخزون")}</h2>
              <div className="overflow-x-auto">
                <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                      <Table.Th>{translate("Initial Quantity", "الكمية الإبتدائية")}</Table.Th>
                      <Table.Th>{translate("Current Quantity", "الكمية الحالية")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {variant.variant.stock.map((stock) => (
                      <Table.Tr key={stock._id}>
                        <Table.Td>{getWarehouseNameById(stock.warehouse)}</Table.Td>
                        <Table.Td>{stock.starterQuantity ?? 0}</Table.Td>
                        <Table.Td className="font-semibold">{stock.quantity}</Table.Td>
                      </Table.Tr>
                    ))}
                    <Table.Tr bg={"#f3f4f6"}>
                      <Table.Td>{translate("Total", "الإجمالي")}</Table.Td>
                      <Table.Td>
                        {variant.variant.stock.reduce((sum, stock) => sum + (stock.starterQuantity ?? 0), 0)}
                      </Table.Td>
                      <Table.Td className="font-bold">
                        {variant.variant.stock.reduce((sum, stock) => sum + stock.quantity, 0)}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </div>
            </div>

            {/* Summary with Balance Indicator */}
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-800">{translate("Summary", "الملخص")}</h2>
                {!isStockBalanced && (
                  <div className="flex items-center gap-1.5 rounded-md bg-red-50 px-2.5 py-1 text-red-700">
                    <solidIcons.ExclamationCircle className="h-4 w-4" />
                    <span className="text-xs font-medium">
                      {translate("Stock Imbalance Detected", "اكتشاف عدم توازن في المخزون")}
                    </span>
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                  <Table.Tbody>
                    <Table.Tr>
                      <Table.Td className="font-medium text-gray-600">
                        {translate("Starter Quantity", "الكمية الابتدائية")}
                      </Table.Td>
                      <Table.Td className="font-semibold">{variant.summary.starterQuantity}</Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td className="font-medium text-gray-600">
                        {translate("Total Purchased", "إجمالي المشتريات")}
                      </Table.Td>
                      <Table.Td className="font-semibold">
                        {variant.summary.totalPurchased - variant.summary.totalPurchaseReturned}
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Td className="font-medium text-gray-600">{translate("Total Sold", "إجمالي المبيعات")}</Table.Td>
                      <Table.Td className="font-semibold">
                        {variant.summary.totalSold - variant.summary.totalSalesReturned}
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr style={{ height: "2.5px" }} />
                    <Table.Tr bg={isStockBalanced ? "#f0fdf4" : "#fef2f2"}>
                      <Table.Td className="font-medium text-gray-600">
                        {translate("Calculated Stock (Based on Transactions)", "المخزون المحسوب (بناءً على الحركات)")}
                      </Table.Td>
                      <Table.Td className={`font-bold ${isStockBalanced ? "text-green-700" : "text-red-700"}`}>
                        {variant.summary.calculatedBalance}
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr bg={isStockBalanced ? "#f0fdf4" : "#fef2f2"}>
                      <Table.Td className="font-medium text-gray-600">
                        {translate("Actual Stock", "المخزون الفعلي")}
                      </Table.Td>
                      <Table.Td className={`font-bold ${isStockBalanced ? "text-green-700" : "text-red-700"}`}>
                        {variant.summary.currentStock}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </div>
            </div>

            {/* Purchase Orders */}
            {variant.purchaseOrders.length > 0 && (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-gray-800">
                  {translate("Purchase Orders", "طلبات الشراء")}
                </h2>
                <div className="overflow-x-auto">
                  <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                        <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
                        <Table.Th>{translate("Vendor", "البائع")}</Table.Th>
                        <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                        <Table.Th>{translate("Purchased", "المشتراة")}</Table.Th>
                        <Table.Th>{translate("Returned", "المرتجعة")}</Table.Th>
                        <Table.Th>{translate("Net Qty", "الصافي")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {variant.purchaseOrders.map((order) => (
                        <Table.Tr key={order.orderId}>
                          <Table.Td>{formatDateAndTime(order.date, language)}</Table.Td>
                          <Table.Td className="font-bold">
                            <Link to={`/admin/home/purchase-orders/${order.orderId}`} className="hover:underline">
                              {order.orderId}
                            </Link>
                          </Table.Td>
                          <Table.Td>{order.vendor}</Table.Td>
                          <Table.Td>{getWarehouseNameById(order.warehouse)}</Table.Td>
                          <Table.Td>{order.quantityPurchased}</Table.Td>
                          <Table.Td>{order.quantityReturned}</Table.Td>
                          <Table.Td className="font-semibold">{order.netQuantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>
              </div>
            )}

            {/* Sales Orders */}
            {variant.salesOrders.length > 0 && (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-gray-800">{translate("Sales Orders", "طلبات البيع")}</h2>
                <div className="overflow-x-auto">
                  <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                        <Table.Th>{translate("Order ID", "رقم الطلب")}</Table.Th>
                        <Table.Th>{translate("Customer", "العميل")}</Table.Th>
                        <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                        <Table.Th>{translate("Source", "المصدر")}</Table.Th>
                        <Table.Th>{translate("Sold", "المباعة")}</Table.Th>
                        <Table.Th>{translate("Returned", "المرتجعة")}</Table.Th>
                        <Table.Th>{translate("Net Qty", "الصافي")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {variant.salesOrders.map((order) => (
                        <Table.Tr key={order.orderId}>
                          <Table.Td>{formatDateAndTime(order.date, language)}</Table.Td>
                          <Table.Td className="font-bold">
                            <Link to={`/admin/home/sales-orders/${order.orderId}`} className="hover:underline">
                              {order.orderId}
                            </Link>
                          </Table.Td>
                          <Table.Td>{order.customer}</Table.Td>
                          <Table.Td>{getWarehouseNameById(order.warehouse)}</Table.Td>
                          <Table.Td className="capitalize">{getOrderSourceLabel(order.orderSource, language)}</Table.Td>
                          <Table.Td>{order.quantitySold}</Table.Td>
                          <Table.Td>{order.quantityReturned}</Table.Td>
                          <Table.Td className="font-semibold">{order.netQuantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>
              </div>
            )}

            {/* Transfers */}
            {variant.transfers.length > 0 && (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-gray-800">
                  {translate("Inventory Transfers", "عمليات النقل")}
                </h2>
                <div className="overflow-x-auto">
                  <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                        <Table.Th>{translate("Transfer ID", "معرف التحويلة")}</Table.Th>
                        <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
                        <Table.Th>{translate("From Warehouse", "من الفرع")}</Table.Th>
                        <Table.Th>{translate("To Warehouse", "إلى الفرع")}</Table.Th>
                        <Table.Th>{translate("Transferred By", "تم النقل بواسطة")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {variant.transfers.map((transfer) => (
                        <Table.Tr key={transfer.transferId}>
                          <Table.Td>{formatDateAndTime(transfer.date, language)}</Table.Td>
                          <Table.Td className="font-bold">
                            <Link to={`/admin/home/transfers/${transfer.transferId}`} className="hover:underline">
                              {transfer.transferId}
                            </Link>
                          </Table.Td>
                          <Table.Td className="font-semibold">{transfer.quantityTransferred}</Table.Td>
                          <Table.Td>{getWarehouseNameById(transfer.sourceWarehouse)}</Table.Td>
                          <Table.Td>{getWarehouseNameById(transfer.targetWarehouse)}</Table.Td>
                          <Table.Td>{transfer.transferredBy}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>
              </div>
            )}
          </section>
        )
      )}
    </AdminLayoutBox>
  );
}
