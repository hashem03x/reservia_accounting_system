import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Badge, Button, Progress, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import InfoItem from "@/components/ui/info-item";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { ChartOfAccountRef } from "@/types/orders";
import { Shareholder } from "@/types/shareholder";
import ShareholderModal from "../_components/shareholder-modal";
import AddContributionModal from "../_components/add-contribution-modal";

const accountText = (account?: ChartOfAccountRef | string | null) => (account && typeof account !== "string" ? `${account.code} - ${account.name}` : "-");

export default function ShareholderDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const canCreate = useHasPermission(resources.shareholders, actions.create);
  const canUpdate = useHasPermission(resources.shareholders, actions.update);

  const { privateRequest, loading, setLoading, error, setError, data: shareholder, setData } = useDataHandler<Shareholder | null>({ initialData: null, initialLoading: true });

  useDocumentTitle(`${shareholder?.name || translations.pages.shareholders} | ${translations.adminPanel}`);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `shareholders/${id}`, language });
      setData(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [id]);

  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();
  const [contributionOpened, { open: openContribution, close: closeContribution }] = useDisclosure();

  if (loading) return <LoadingSection message={translate("Loading shareholder...", "جاري تحميل المساهم...")} />;
  if (error) return <ErrorSection errorTitle={translate("Error loading shareholder", "خطأ في تحميل المساهم")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />;
  if (!shareholder) return null;

  const money = (value: unknown) => formatAmount(value, translations.currency);
  const contributions = [...shareholder.contributions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const hasAllocation = typeof shareholder.allocatedCapital === "number" && shareholder.allocatedCapital > 0;
  const paidPct = hasAllocation ? Math.min(100, Math.round(((shareholder.shareCapital || 0) / shareholder.allocatedCapital!) * 1000) / 10) : 0;

  return (
    <AdminLayoutBox
      header={{
        title: shareholder.name,
        subTitle: `${translate("Shareholder No.", "رقم المساهم")} ${shareholder.shareholderNumber}`,
        backLink: `/${paths.admin}/${paths.shareholders}`,
        sideElements: (
          <div className="flex flex-wrap gap-2">
            {canUpdate && (
              <Button variant="light" onClick={openEdit}>
                {translate("Edit", "تعديل")}
              </Button>
            )}
            {canCreate && shareholder.status === "active" && (
              <Button variant="light" color="teal" onClick={openContribution}>
                {translate("Add Contribution", "إضافة مساهمة")}
              </Button>
            )}
          </div>
        ),
      }}
    >
      <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
        <InfoItem
          label={translate("Status", "الحالة")}
          value={
            <Badge color={shareholder.status === "active" ? "green" : "gray"} variant="light">
              {shareholder.status === "active" ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
            </Badge>
          }
        />
        <InfoItem label={translate("Shareholder No. (Sub Account)", "رقم المساهم (الحساب الفرعي)")} value={shareholder.shareholderNumber} />
        <InfoItem label={translate("Full Name (Arabic)", "الاسم بالكامل (عربي)")} value={shareholder.nameAr || "-"} />
        <InfoItem label={translate("Address", "العنوان")} value={shareholder.address || "-"} />
        <InfoItem label={translate("Ownership", "نسبة الملكية")} value={`${shareholder.ownershipPercentage}%`} />
        <InfoItem label={translate("Equity Account", "حساب حقوق الملكية")} value={accountText(shareholder.equityAccount)} />
        <InfoItem label={translate("Allocated Capital", "رأس المال المخصص")} value={hasAllocation ? money(shareholder.allocatedCapital) : translate("Set Issued Capital first", "حدد رأس المال المصدر أولاً")} />
        <InfoItem label={translate("Paid-in Capital", "رأس المال المسدد")} value={money(shareholder.shareCapital)} />
        <InfoItem label={translate("Remaining Unpaid", "المتبقي غير المسدد")} value={hasAllocation ? money(shareholder.remainingUnpaid) : "-"} />
        <InfoItem label={translate("Phone", "الهاتف")} value={shareholder.phone || "-"} />
        <InfoItem label={translate("Email", "البريد الإلكتروني")} value={shareholder.email || "-"} />
        <InfoItem label={translate("National ID", "الرقم القومي")} value={shareholder.nationalId || "-"} />
      </div>

      {hasAllocation && (
        <div className="mt-4 flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{translate("Payment progress", "تقدم السداد")}</span>
            <span className="tabular-nums">{paidPct}%</span>
          </div>
          <Progress value={paidPct} color="teal" size="sm" radius="xl" />
        </div>
      )}

      {shareholder.notes && <p className="mt-4 text-gray-600">{shareholder.notes}</p>}

      <div className="mt-6 flex flex-col gap-3">
        <h4>{translate("Capital Contributions", "مساهمات رأس المال")}</h4>
        {contributions.length === 0 ? (
          <p className="text-sm text-gray-400">{translate("No contributions recorded yet.", "لم يتم تسجيل أي مساهمات بعد.")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table striped withColumnBorders>
              <Table.Thead className="bg-gray-100">
                <Table.Tr>
                  <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                  <Table.Th>{translate("Received Into", "تم الاستلام في")}</Table.Th>
                  <Table.Th>{translate("Equity Account", "حساب حقوق الملكية")}</Table.Th>
                  <Table.Th>{translate("Reference", "المرجع")}</Table.Th>
                  <Table.Th className="text-right">{translate("Amount", "المبلغ")}</Table.Th>
                  <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {contributions.map((c) => (
                  <Table.Tr key={c._id}>
                    <Table.Td>{formatDate(c.date, language)}</Table.Td>
                    <Table.Td>{accountText(c.paymentAccount)}</Table.Td>
                    <Table.Td>{accountText(c.equityAccount)}</Table.Td>
                    <Table.Td>{c.reference || "-"}</Table.Td>
                    <Table.Td className="text-right tabular-nums">{money(c.amount)}</Table.Td>
                    <Table.Td>
                      <JournalEntryLink entry={c.journalEntry} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}
      </div>

      <ShareholderModal opened={editOpened} close={closeEdit} shareholder={shareholder} onSaved={load} />
      <AddContributionModal opened={contributionOpened} close={closeContribution} shareholder={shareholder} onSaved={load} />
    </AdminLayoutBox>
  );
}
