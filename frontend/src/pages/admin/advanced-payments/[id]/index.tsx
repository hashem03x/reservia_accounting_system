import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import paths from "@/utils/constants/paths";
import { Badge, Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import { AdvancedPayment } from "@/types/advanced-payment";
<<<<<<< HEAD
import OrderJournalEntriesSection from "@/components/global/order-journal-entries-section";
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

const statusColors: Record<string, string> = { available: "green", partially_used: "yellow", fully_used: "gray", cancelled: "red" };

export default function AdvancedPaymentDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canUpdate = useHasPermission(resources.advancedPayments, actions.update);

  const { privateRequest, loading, setLoading, error, setError, data: payment, setData: setPayment } = useDataHandler<AdvancedPayment | null>({
    initialData: null,
    initialLoading: true,
  });

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  useDocumentTitle(payment ? `${translations.pages.advancedPayments} | ${translations.adminPanel}` : translations.pages.advancedPayments);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `advanced-payments/${id}`, language });
      setPayment(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handleCancel() {
    if (!confirm(translate("Cancel this advanced payment?", "إلغاء هذه الدفعة المقدمة؟"))) return;
    handleRequest(language, setActionLoading, setActionError, async () => {
      const res = await privateRequest({ url: `advanced-payments/${id}/cancel`, method: "PATCH", language });
      setPayment(res.data);
    });
  }

  if (loading) return <LoadingSection message={translate("Loading advanced payment...", "جاري تحميل الدفعة المقدمة...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error loading advanced payment", "خطأ في تحميل الدفعة المقدمة")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (!payment) return null;

  const partyName = payment.type === "customer" ? payment.customer?.name : payment.vendor?.name;
<<<<<<< HEAD
  const usageHistory = payment.usageHistory || [];
  const canCancel = canUpdate && payment.status !== "cancelled" && !usageHistory.some((u) => !u.reversed);
=======
  const canCancel = canUpdate && payment.status !== "cancelled" && !payment.usageHistory.some((u) => !u.reversed);
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

  return (
    <AdminLayoutBox
      header={{
        title: translate("Advanced Payment", "دفعة مقدمة"),
        subTitle: partyName,
        backLink: `/${paths.admin}/${paths.advancedPayments}`,
        sideElements: canCancel && (
          <Button variant="light" color="red" loading={actionLoading} onClick={handleCancel}>
            {translate("Cancel", "إلغاء")}
          </Button>
        ),
      }}
    >
      {actionError && <ErrorAlert error={actionError} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label={translate("Type", "النوع")} value={payment.type === "customer" ? translate("Customer", "عميل") : translate("Vendor", "بائع")} />
        <InfoCard label={payment.type === "customer" ? translate("Customer", "العميل") : translate("Vendor", "البائع")} value={partyName || "-"} />
        <InfoCard label={translate("Project", "المشروع")} value={payment.project?.projectNumber || "-"} />
        <InfoCard
          label={translate("Payment Method", "طريقة الدفع")}
          value={payment.paymentAccount ? `${payment.paymentAccount.code} - ${payment.paymentAccount.name}` : "-"}
        />
        <InfoCard label={translate("Status", "الحالة")} value={<Badge color={statusColors[payment.status] || "gray"}>{payment.status}</Badge>} />
<<<<<<< HEAD
        <InfoCard label={translate("Original Amount", "المبلغ الأصلي")} value={`${(payment.amount || 0).toLocaleString()} ${payment.currency || ""}`} />
        <InfoCard label={translate("Remaining Amount", "المبلغ المتبقي")} value={`${(payment.remainingAmount || 0).toLocaleString()} ${payment.currency || ""}`} />
=======
        <InfoCard label={translate("Original Amount", "المبلغ الأصلي")} value={`${payment.amount.toLocaleString()} ${payment.currency || ""}`} />
        <InfoCard label={translate("Remaining Amount", "المبلغ المتبقي")} value={`${payment.remainingAmount.toLocaleString()} ${payment.currency || ""}`} />
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        <InfoCard label={translate("Reference", "المرجع")} value={payment.reference || "-"} />
        <InfoCard label={translate("Date", "التاريخ")} value={formatDate(payment.createdAt, language)} />
      </div>

      {payment.notes && <p className="mt-4 text-gray-600">{payment.notes}</p>}

      <div className="mt-6 flex flex-col gap-3">
<<<<<<< HEAD
        <div className="flex flex-col gap-0.5">
          <h4>{translate("Journal Entries", "القيود اليومية")}</h4>
          <p className="text-xs text-gray-500">
            {translate(
              "Accounting entries posted for this advanced payment - its own receipt/payment entry and every entry that applied it.",
              "القيود المحاسبية المرحلة لهذه الدفعة المقدمة - قيد استلامها/دفعها وكل قيد تم فيه استخدامها.",
            )}
          </p>
        </div>
        <OrderJournalEntriesSection
          orderType="advanced-payment"
          orderId={payment._id}
          emptyMessage={translate(
            "No journal entries are connected to this advanced payment yet.",
            "لا توجد قيود يومية مرتبطة بهذه الدفعة المقدمة بعد.",
          )}
        />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <h4>{translate("Usage History", "سجل الاستخدام")}</h4>
        {usageHistory.length === 0 ? (
=======
        <h4>{translate("Usage History", "سجل الاستخدام")}</h4>
        {payment.usageHistory.length === 0 ? (
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
          <p className="text-sm text-gray-400">{translate("This advanced payment has not been used yet.", "لم يتم استخدام هذه الدفعة المقدمة بعد.")}</p>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{translate("Sales Order", "طلب البيع")}</Table.Th>
                <Table.Th>{translate("Amount Consumed", "المبلغ المستهلك")}</Table.Th>
                <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                <Table.Th>{translate("Status", "الحالة")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
<<<<<<< HEAD
              {usageHistory.map((entry, i) => (
=======
              {payment.usageHistory.map((entry, i) => (
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
                <Table.Tr
                  key={i}
                  className={entry.salesOrder ? "cursor-pointer" : ""}
                  onClick={() => entry.salesOrder && navigate(`/${paths.admin}/${paths.home}/${paths.salesOrders}/${entry.salesOrder!._id}`)}
                >
                  <Table.Td>{entry.salesOrder?.code || "-"}</Table.Td>
<<<<<<< HEAD
                  <Table.Td>{(entry.amountConsumed || 0).toLocaleString()}</Table.Td>
=======
                  <Table.Td>{entry.amountConsumed.toLocaleString()}</Table.Td>
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
                  <Table.Td>{formatDate(entry.date, language)}</Table.Td>
                  <Table.Td>
                    <Badge color={entry.reversed ? "gray" : "green"} variant="light">
                      {entry.reversed ? translate("Reversed", "ملغي") : translate("Active", "نشط")}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </div>
    </AdminLayoutBox>
  );
}

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
