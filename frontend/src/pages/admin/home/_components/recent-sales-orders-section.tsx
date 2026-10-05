import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Table } from "@mantine/core";
import { SalesOrder } from "@/types/orders";
import { PaginatedData } from "@/types/global";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatCurrency } from "@/utils/helpers/format-currency";
import { formatDate } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import SectionCard from "@/components/ui/section-card";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import EmptySection from "@/components/ui/sections/empty";
import ErrorSection from "@/components/ui/sections/error";
import LoadingSection from "@/components/ui/sections/loading";

const statusColors: Record<string, string> = { pending: "yellow", delivered: "green", canceled: "red" };

// Recent Sales Orders (docs section "Recent Sales Orders") - newest 5 orders, not the full Sales
// Orders page. Amount shown is `totalAmount` (pre-tax - see salesOrderModel.js), never
// `grandTotal`, so VAT never leaks into a figure meant to represent sales excluding taxes. Sales
// Orders have no ResourceGuard on their read route (see App.tsx), so this section is always shown.
export default function RecentSalesOrdersSection() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();

  const { privateRequest, loading, setLoading, error, setError, data, setData } =
    useDataHandler<PaginatedData<SalesOrder> | null>({
      initialData: null,
      initialLoading: true,
    });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "sale-orders",
        params: { limit: "5", sort: "-createdAt" },
        signal: controller.signal,
        language,
      });
      setData(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = load();
    return cancelRequest;
  }, []);

  return (
    <SectionCard
      title={translate("Recent Sales Orders", "آخر طلبات المبيعات")}
      viewAllTo={`/${paths.admin}/${paths.home}/${paths.salesOrders}`}
      viewAllLabel={translate("View all", "عرض الكل")}
    >
      {loading ? (
        <LoadingSection message={translate("Loading sales orders...", "جاري تحميل طلبات المبيعات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading sales orders", "خطأ في تحميل طلبات المبيعات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No sales orders yet", "لا توجد طلبات مبيعات")} />
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[560px]">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th className="whitespace-nowrap">{translate("Document", "المستند")}</Table.Th>
                <Table.Th>{translate("Customer", "العميل")}</Table.Th>
                <Table.Th>{translate("Project", "المشروع")}</Table.Th>
                <Table.Th className="whitespace-nowrap text-right">{translate("Amount", "المبلغ")}</Table.Th>
                <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.data.map((order) => (
                <Table.Tr
                  key={order._id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/${paths.admin}/${paths.home}/${paths.salesOrders}/${order._id}`)}
                >
                  <Table.Td className="whitespace-nowrap font-medium">{order.code || "-"}</Table.Td>
                  <Table.Td>
                    <TruncatedText
                      text={order.customer?.name || translate("Deleted Customer", "عميل محذوف")}
                      maxWidthClassName="max-w-[140px]"
                    />
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">{order.project?.projectNumber || "-"}</Table.Td>
                  <Table.Td className="whitespace-nowrap text-right tabular-nums">
                    {formatCurrency(order.totalAmount, language)}
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">
                    <Badge color={statusColors[order.orderStatus] || "gray"} variant="light">
                      {order.orderStatus}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">{formatDate(order.createdAt, language)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </DataTable>
        </DataTableContainer>
      )}
    </SectionCard>
  );
}
