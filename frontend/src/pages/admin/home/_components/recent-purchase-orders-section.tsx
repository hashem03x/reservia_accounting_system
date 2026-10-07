import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Table } from "@mantine/core";
import { PurchaseOrder } from "@/types/orders";
import { PaginatedData } from "@/types/global";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatCurrency } from "@/utils/helpers/format-currency";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import SectionCard from "@/components/ui/section-card";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import EmptySection from "@/components/ui/sections/empty";
import ErrorSection from "@/components/ui/sections/error";
import LoadingSection from "@/components/ui/sections/loading";
<<<<<<< HEAD
import { getOrderTotal } from "@/utils/helpers/order-totals";
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

const paymentStatusColors: Record<string, string> = { unpaid: "red", partial: "yellow", paid: "green", unknown: "gray" };

// Recent Purchase Orders (docs section "Recent Purchase Orders") - newest 5 orders, not the full
<<<<<<< HEAD
// Purchase Orders page. Amount is the order's Total Amount (incl. VAT). Purchase Orders ARE ResourceGuarded on
=======
// Purchase Orders page. Amount is `totalAmount` (pre-tax). Purchase Orders ARE ResourceGuarded on
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
// read (see App.tsx), so this section respects that permission like the rest of the app.
export default function RecentPurchaseOrdersSection() {
  const { language, translate } = useLanguage();
  const navigate = useNavigate();
  const canRead = useHasPermission(resources.purchaseOrders, actions.read);

  const { privateRequest, loading, setLoading, error, setError, data, setData } =
    useDataHandler<PaginatedData<PurchaseOrder> | null>({
      initialData: null,
      initialLoading: true,
    });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "purchaseorder",
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
    if (!canRead) return;
    const cancelRequest = load();
    return cancelRequest;
  }, [canRead]);

  if (!canRead) return null;

  return (
    <SectionCard
      title={translate("Recent Purchase Orders", "آخر طلبات الشراء")}
      viewAllTo={`/${paths.admin}/${paths.home}/${paths.purchaseOrders}`}
      viewAllLabel={translate("View all", "عرض الكل")}
    >
      {loading ? (
        <LoadingSection message={translate("Loading purchase orders...", "جاري تحميل طلبات الشراء...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading purchase orders", "خطأ في تحميل طلبات الشراء")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptySection useDefaultImg message={translate("No purchase orders yet", "لا توجد طلبات شراء")} />
      ) : (
        <DataTableContainer>
          <DataTable className="min-w-[560px]">
            <Table.Thead className={dataTableHeadClassName}>
              <Table.Tr>
                <Table.Th className="whitespace-nowrap">{translate("Document", "المستند")}</Table.Th>
                <Table.Th>{translate("Vendor", "البائع")}</Table.Th>
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
                  onClick={() => navigate(`/${paths.admin}/${paths.home}/${paths.purchaseOrders}/${order._id}`)}
                >
                  <Table.Td className="whitespace-nowrap font-medium">{order.code || "-"}</Table.Td>
                  <Table.Td>
                    <TruncatedText
                      text={order.vendor?.name || translate("Deleted Vendor", "بائع محذوف")}
                      maxWidthClassName="max-w-[140px]"
                    />
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">{order.project?.projectNumber || "-"}</Table.Td>
                  <Table.Td className="whitespace-nowrap text-right tabular-nums">
<<<<<<< HEAD
                    {formatCurrency(getOrderTotal(order), language)}
=======
                    {formatCurrency(order.totalAmount, language)}
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
                  </Table.Td>
                  <Table.Td className="whitespace-nowrap">
                    <Badge color={paymentStatusColors[order.paymentStatus] || "gray"} variant="light">
                      {order.paymentStatus}
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
