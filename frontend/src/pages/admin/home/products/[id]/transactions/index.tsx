import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import useCategoryHelpers from "@/hooks/useCategoryHelpers";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import paths from "@/utils/constants/paths";
import { formatDate } from "@/utils/helpers/date-formaters";
import { Pagination, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";

type HistoryPage<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type PurchaseOrderRow = {
  orderId: string;
  code?: string;
  vendor: string;
  warehouse: string;
  quantityPurchased: number;
  quantityReturned: number;
  netQuantity: number;
  date: string;
};

type SalesOrderRow = {
  orderId: string;
  code?: string;
  customer: string;
  warehouse: string;
  quantitySold: number;
  quantityReturned: number;
  netQuantity: number;
  date: string;
};

type ReturnRow = {
  returnId: string;
  purchaseOrderId?: string;
  salesOrderId?: string;
  warehouse: string;
  quantityReturned: number;
  returnedAmount: number;
  notes?: string;
  date: string;
};

type TransferRow = {
  transferId: string;
  quantityTransferred: number;
  sourceWarehouse: string;
  targetWarehouse: string;
  status: string;
  date: string;
};

type MovementRow = {
  movementId: string;
  type: string;
  fromLocation: string;
  toLocation?: string;
  quantity: number;
  date: string;
};

type ProductHistoryData = {
  product: {
    _id: string;
    title: { en: string; ar: string };
    sku?: string;
    barcode?: string;
    capacity?: { value?: number; unit?: string };
    category?: string;
    subcategory?: string;
    stock: { warehouse: string; quantity: number; starterQuantity?: number }[];
    currentStock: number;
  };
  summary: {
    starterQuantity: number;
    totalPurchased: number;
    totalPurchaseReturned: number;
    totalSold: number;
    totalSalesReturned: number;
    totalTransferred: number;
    calculatedStock: number;
    actualStock: number;
    difference: number;
  };
  purchaseOrders: HistoryPage<PurchaseOrderRow>;
  salesOrders: HistoryPage<SalesOrderRow>;
  purchaseReturns: HistoryPage<ReturnRow>;
  salesReturns: HistoryPage<ReturnRow>;
  transfers: HistoryPage<TransferRow>;
  movements: HistoryPage<MovementRow>;
};

export default function ProductTransactions() {
  const { language, translate, translations } = useLanguage();
  const { id } = useParams<{ id: string }>();

  useDocumentTitle(`${translate("Product Transactions", "حركات المنتج")} | ${translations.adminPanel}`);

  const { getMainCategoryNameById, getSubcategoryNameById } = useCategoryHelpers();
  const { getWarehouseNameById } = useWarehouseHelpers();

  const [page, setPage] = useState(1);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<ProductHistoryData | null>({
    initialData: null,
    initialLoading: true,
  });

  function loadHistory() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      // One request to get the product's barcode (the history endpoint is keyed by barcode),
      // then one request for the actual history - not a request per section of the page.
      const productResponse = await privateRequest({ url: `products/${id}`, signal: controller.signal, language });
      const barcode = productResponse.data.barcode;

      const historyResponse = await privateRequest({
        url: `products/history/${barcode}`,
        params: { page, limit: 10 },
        signal: controller.signal,
        language,
      });
      setData(historyResponse.data);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = loadHistory();
    return cancelRequest;
  }, [id, page]);

  if (loading) return <LoadingSection message={translate("Loading product transactions...", "جاري تحميل حركات المنتج...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error", "خطأ")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: loadHistory }} />;
  if (!data) return null;

  const { product, summary } = data;

  const maxTotalPages = Math.max(
    data.purchaseOrders.totalPages,
    data.salesOrders.totalPages,
    data.purchaseReturns.totalPages,
    data.salesReturns.totalPages,
    data.transfers.totalPages,
    data.movements.totalPages,
  );

  return (
    <AdminLayoutBox
      header={{
        title: translate("Product Transactions", "حركات المنتج"),
        subTitle: translate(product.title.en, product.title.ar),
        backLink: `/${paths.admin}/${paths.home}/${paths.products}/${id}`,
        border: true,
      }}
    >
      <div className="flex flex-col gap-5">
        {/* Basic Details */}
        <section className="product-details-box">
          <h3>{translate("Product Information", "معلومات المنتج")}</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <InfoField label={translate("Product", "المنتج")} value={translate(product.title.en, product.title.ar)} />
            <InfoField label={translate("SKU", "رمز المنتج")} value={product.sku || "-"} />
            <InfoField label={translate("Barcode", "الباركود")} value={product.barcode || "-"} />
            <InfoField
              label={translate("Capacity", "السعة")}
              value={product.capacity?.value != null && product.capacity?.unit ? `${product.capacity.value} ${product.capacity.unit}` : "-"}
            />
            <InfoField label={translate("Category", "الفئة")} value={product.category ? getMainCategoryNameById(product.category) : "-"} />
            <InfoField label={translate("Subcategory", "الفئة الفرعية")} value={product.subcategory ? getSubcategoryNameById(product.subcategory) : "-"} />
          </div>
        </section>

        {/* Stock Details */}
        <section className="product-details-box">
          <h3>{translate("Stock Details", "تفاصيل المخزون")}</h3>
          <div className="overflow-x-auto">
            <Table withColumnBorders verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
                  <Table.Th>{translate("Starter Quantity", "الكمية الابتدائية")}</Table.Th>
                  <Table.Th>{translate("Current Quantity", "الكمية الحالية")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {product.stock.map((stockItem, index) => (
                  <Table.Tr key={index}>
                    <Table.Td>{getWarehouseNameById(stockItem.warehouse) || stockItem.warehouse}</Table.Td>
                    <Table.Td>{stockItem.starterQuantity || 0}</Table.Td>
                    <Table.Td>{stockItem.quantity}</Table.Td>
                  </Table.Tr>
                ))}
                <Table.Tr className="font-semibold">
                  <Table.Td>{translate("Total", "الإجمالي")}</Table.Td>
                  <Table.Td>{summary.starterQuantity}</Table.Td>
                  <Table.Td>{product.currentStock}</Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </div>
        </section>

        {/* Summary */}
        <section className="product-details-box">
          <h3>{translate("Transaction Summary", "ملخص الحركات")}</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <InfoField label={translate("Starter Quantity", "الكمية الابتدائية")} value={summary.starterQuantity} />
            <InfoField label={translate("Total Purchased", "إجمالي المشتريات")} value={summary.totalPurchased} />
            <InfoField label={translate("Total Sold", "إجمالي المبيعات")} value={summary.totalSold} />
            <InfoField label={translate("Total Purchase Returns", "مرتجعات المشتريات")} value={summary.totalPurchaseReturned} />
            <InfoField label={translate("Total Sales Returns", "مرتجعات المبيعات")} value={summary.totalSalesReturned} />
            <InfoField label={translate("Total Transferred", "إجمالي التحويلات")} value={summary.totalTransferred} />
          </div>
          <hr className="my-2" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <InfoField label={translate("Calculated Stock", "المخزون المحسوب")} value={summary.calculatedStock} />
            <InfoField label={translate("Actual Stock", "المخزون الفعلي")} value={summary.actualStock} />
            <InfoField
              label={translate("Difference", "الفرق")}
              value={summary.difference}
              valueClassName={summary.difference !== 0 ? "text-red-600" : "text-secondary-700"}
            />
          </div>
        </section>

        {/* Purchase Orders */}
        <TransactionSection title={translate("Purchase Orders", "أوامر الشراء")} emptyMessage={translate("No purchase transactions.", "لا توجد عمليات شراء.")} isEmpty={data.purchaseOrders.data.length === 0}>
          <Table withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Order", "الطلب")}</Table.Th>
                <Table.Th>{translate("Vendor", "المورد")}</Table.Th>
                <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
                <Table.Th>{translate("Purchased", "تم شراؤه")}</Table.Th>
                <Table.Th>{translate("Returned", "تم إرجاعه")}</Table.Th>
                <Table.Th>{translate("Net Qty", "صافي الكمية")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.purchaseOrders.data.map((row) => (
                <Table.Tr key={row.orderId}>
                  <Table.Td>{formatDate(row.date, language)}</Table.Td>
                  <Table.Td>
                    <Link className="text-primary-600 hover:underline" to={`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${row.orderId}`}>
                      {row.code || row.orderId}
                    </Link>
                  </Table.Td>
                  <Table.Td>{row.vendor}</Table.Td>
                  <Table.Td>{getWarehouseNameById(row.warehouse) || row.warehouse}</Table.Td>
                  <Table.Td>{row.quantityPurchased}</Table.Td>
                  <Table.Td>{row.quantityReturned}</Table.Td>
                  <Table.Td>{row.netQuantity}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TransactionSection>

        {/* Sales Orders */}
        <TransactionSection title={translate("Sales Orders", "أوامر البيع")} emptyMessage={translate("No sales transactions.", "لا توجد عمليات بيع.")} isEmpty={data.salesOrders.data.length === 0}>
          <Table withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Order", "الطلب")}</Table.Th>
                <Table.Th>{translate("Customer", "العميل")}</Table.Th>
                <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
                <Table.Th>{translate("Sold", "تم بيعه")}</Table.Th>
                <Table.Th>{translate("Returned", "تم إرجاعه")}</Table.Th>
                <Table.Th>{translate("Net Qty", "صافي الكمية")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.salesOrders.data.map((row) => (
                <Table.Tr key={row.orderId}>
                  <Table.Td>{formatDate(row.date, language)}</Table.Td>
                  <Table.Td>
                    <Link className="text-primary-600 hover:underline" to={`/${paths.admin}/${paths.home}/${paths.salesOrders}/${row.orderId}`}>
                      {row.code || row.orderId}
                    </Link>
                  </Table.Td>
                  <Table.Td>{row.customer}</Table.Td>
                  <Table.Td>{getWarehouseNameById(row.warehouse) || row.warehouse}</Table.Td>
                  <Table.Td>{row.quantitySold}</Table.Td>
                  <Table.Td>{row.quantityReturned}</Table.Td>
                  <Table.Td>{row.netQuantity}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TransactionSection>

        {/* Purchase Returns */}
        <TransactionSection title={translate("Purchase Returns", "مرتجعات الشراء")} emptyMessage={translate("No purchase returns.", "لا توجد مرتجعات شراء.")} isEmpty={data.purchaseReturns.data.length === 0}>
          <Table withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Order", "الطلب")}</Table.Th>
                <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
                <Table.Th>{translate("Quantity Returned", "الكمية المرتجعة")}</Table.Th>
                <Table.Th>{translate("Amount Returned", "المبلغ المرتجع")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.purchaseReturns.data.map((row) => (
                <Table.Tr key={row.returnId}>
                  <Table.Td>{formatDate(row.date, language)}</Table.Td>
                  <Table.Td>
                    {row.purchaseOrderId ? (
                      <Link className="text-primary-600 hover:underline" to={`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${row.purchaseOrderId}`}>
                        {row.purchaseOrderId}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </Table.Td>
                  <Table.Td>{getWarehouseNameById(row.warehouse) || row.warehouse}</Table.Td>
                  <Table.Td>{row.quantityReturned}</Table.Td>
                  <Table.Td>
                    {row.returnedAmount.toFixed(2)} {translations.currency}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TransactionSection>

        {/* Sales Returns */}
        <TransactionSection title={translate("Sales Returns", "مرتجعات البيع")} emptyMessage={translate("No sales returns.", "لا توجد مرتجعات بيع.")} isEmpty={data.salesReturns.data.length === 0}>
          <Table withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Order", "الطلب")}</Table.Th>
                <Table.Th>{translate("Warehouse", "المخزن")}</Table.Th>
                <Table.Th>{translate("Quantity Returned", "الكمية المرتجعة")}</Table.Th>
                <Table.Th>{translate("Amount Returned", "المبلغ المرتجع")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.salesReturns.data.map((row) => (
                <Table.Tr key={row.returnId}>
                  <Table.Td>{formatDate(row.date, language)}</Table.Td>
                  <Table.Td>
                    {row.salesOrderId ? (
                      <Link className="text-primary-600 hover:underline" to={`/${paths.admin}/${paths.home}/${paths.salesOrders}/${row.salesOrderId}`}>
                        {row.salesOrderId}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </Table.Td>
                  <Table.Td>{getWarehouseNameById(row.warehouse) || row.warehouse}</Table.Td>
                  <Table.Td>{row.quantityReturned}</Table.Td>
                  <Table.Td>
                    {row.returnedAmount.toFixed(2)} {translations.currency}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TransactionSection>

        {/* Transfers */}
        <TransactionSection title={translate("Transfers", "التحويلات")} emptyMessage={translate("No transfer transactions.", "لا توجد عمليات تحويل.")} isEmpty={data.transfers.data.length === 0}>
          <Table withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
                <Table.Th>{translate("From Warehouse", "من المخزن")}</Table.Th>
                <Table.Th>{translate("To Warehouse", "إلى المخزن")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.transfers.data.map((row) => (
                <Table.Tr key={row.transferId}>
                  <Table.Td>{formatDate(row.date, language)}</Table.Td>
                  <Table.Td>{row.quantityTransferred}</Table.Td>
                  <Table.Td>{getWarehouseNameById(row.sourceWarehouse) || row.sourceWarehouse}</Table.Td>
                  <Table.Td>{getWarehouseNameById(row.targetWarehouse) || row.targetWarehouse}</Table.Td>
                  <Table.Td>{row.status}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TransactionSection>

        {/* Movements / Adjustments */}
        <TransactionSection title={translate("Stock Movements", "حركات المخزون")} emptyMessage={translate("No stock movements found.", "لا توجد حركات مخزون.")} isEmpty={data.movements.data.length === 0}>
          <Table withColumnBorders verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Type", "النوع")}</Table.Th>
                <Table.Th>{translate("Quantity", "الكمية")}</Table.Th>
                <Table.Th>{translate("From", "من")}</Table.Th>
                <Table.Th>{translate("To", "إلى")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.movements.data.map((row) => (
                <Table.Tr key={row.movementId}>
                  <Table.Td>{formatDate(row.date, language)}</Table.Td>
                  <Table.Td>{row.type}</Table.Td>
                  <Table.Td>{row.quantity}</Table.Td>
                  <Table.Td>{row.fromLocation}</Table.Td>
                  <Table.Td>{row.toLocation || "-"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TransactionSection>

        {maxTotalPages > 1 && (
          <div className="flex justify-center">
            <Pagination total={maxTotalPages} value={page} onChange={setPage} size="sm" />
          </div>
        )}
      </div>
    </AdminLayoutBox>
  );
}

function InfoField({ label, value, valueClassName = "" }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`font-semibold text-gray-800 ${valueClassName}`}>{value}</span>
    </div>
  );
}

function TransactionSection({
  title,
  emptyMessage,
  isEmpty,
  children,
}: {
  title: string;
  emptyMessage: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="product-details-box">
      <h3>{title}</h3>
      {isEmpty ? <p className="text-sm text-gray-500">{emptyMessage}</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}
