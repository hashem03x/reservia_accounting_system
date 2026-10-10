import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import paths from "@/utils/constants/paths";
import { Badge, Button, Table, Tabs } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import InfoItem from "@/components/ui/info-item";
import JournalEntryLink from "@/components/global/journal-entry-link";
import { FixedAsset } from "@/types/fixed-asset";
import { ChartOfAccountRef } from "@/types/orders";
import UpdateFixedAssetModal from "../_components/update-fixed-asset-modal";
import FixedAssetPaymentsTab from "../_components/fixed-asset-payments";
import { fixedAssetStatusColors, useFixedAssetStatusLabel } from "../_components/status";

const accountText = (account?: ChartOfAccountRef | null) => (account ? `${account.code} - ${account.name}` : "-");

export default function FixedAssetDetail() {
  const { id } = useParams();
  const { language, translate, translations } = useLanguage();
  const statusLabel = useFixedAssetStatusLabel();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: asset,
    setData: setAsset,
  } = useDataHandler<FixedAsset | null>({
    initialData: null,
    initialLoading: true,
  });

  useDocumentTitle(`${asset?.name || translations.pages.fixedAssets} | ${translations.adminPanel}`);

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: `fixed-assets/${id}`, language });
      setAsset(res.data);
    });
  }

  useEffect(() => {
    load();
  }, [id]);

  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure();

  if (loading) return <LoadingSection message={translate("Loading fixed asset...", "جاري تحميل الأصل الثابت...")} />;
  if (error)
    return (
      <ErrorSection
        errorTitle={translate("Error loading fixed asset", "خطأ في تحميل الأصل الثابت")}
        errorMessage={error}
        button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
      />
    );
  if (!asset) return null;

  const isIntangible = asset.assetClass === "intangible";
  const money = (value: unknown) => formatAmount(value, translations.currency);
  const depreciations = [...(asset.depreciations || [])].sort((a, b) => a.period.localeCompare(b.period));

  return (
    <AdminLayoutBox
      header={{
        title: asset.name,
        subTitle: translations.pages.fixedAssets,
        backLink: `/${paths.admin}/${paths.fixedAssets}`,
        sideElements: (
          <Button variant="light" onClick={openEdit}>
            {translate("Edit", "تعديل")}
          </Button>
        ),
      }}
    >
      <Tabs defaultValue="details" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="details">{translate("Details", "التفاصيل")}</Tabs.Tab>
          <Tabs.Tab value="payments">{translate("Payments", "المدفوعات")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="details">
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-2">
            <InfoItem label={translate("Asset No.", "رقم الأصل")} value={asset.assetCode || "-"} />
            <InfoItem
              label={translate("Status", "الحالة")}
              value={
                <Badge color={fixedAssetStatusColors[asset.status || "active"]} variant="light">
                  {statusLabel(asset.status || "active")}
                </Badge>
              }
            />
            <InfoItem
              label={translate("Type", "النوع")}
              value={
                asset.assetClass
                  ? isIntangible
                    ? translate("Intangible (amortized)", "غير ملموس (يستهلك)")
                    : translate("Tangible (depreciated)", "ملموس (يُهلك)")
                  : "-"
              }
            />
            <InfoItem
              label={translate("Vendor", "البائع")}
              value={
                asset.vendor
                  ? `${asset.vendor.name}${asset.vendor.vendorNumber != null ? ` (${asset.vendor.vendorNumber})` : ""}`
                  : "-"
              }
            />
            <InfoItem
              label={translate("Asset Date", "تاريخ الأصل")}
              value={asset.acquisitionDate ? formatDate(asset.acquisitionDate, language) : "-"}
            />
            <InfoItem label={translate("Asset Account", "حساب الأصل")} value={accountText(asset.assetAccountId)} />
            <InfoItem
              label={
                isIntangible
                  ? translate("Accumulated Amortization", "مجمع الاستهلاك")
                  : translate("Accumulated Depreciation Account", "حساب مجمع الإهلاك")
              }
              value={accountText(asset.accumulatedAccountId)}
            />
            <InfoItem
              label={translate("Depreciation & Amortization Account", "حساب الإهلاك والاستهلاك")}
              value={accountText(asset.depreciationAccountId)}
            />
            <InfoItem
              label={translate("Acquisition Entry", "قيد الاقتناء")}
              value={<JournalEntryLink entry={asset.acquisitionJournalEntry} />}
            />
            <InfoItem label={translate("Cost", "التكلفة")} value={money(asset.price)} />
            <InfoItem
              label={translate("VAT", "ضريبة القيمة المضافة")}
              value={`${money(asset.vatAmount ?? 0)} (${asset.vatPercentage ?? 0}%)`}
            />
            <InfoItem
              label={translate("Total (owed to vendor)", "الإجمالي (المستحق للبائع)")}
              value={money(asset.totalAmount)}
            />
            <InfoItem
              label={translate("Useful Life (months)", "العمر الإنتاجي بالشهور")}
              value={asset.usefulLifeMonths ?? "-"}
            />
            <InfoItem label={translate("Monthly Depreciation", "الإهلاك الشهري")} value={money(asset.monthlyDepreciation)} />
            <InfoItem label={translate("Accumulated", "المجمع")} value={money(asset.accumulatedDepreciation ?? 0)} />
            <InfoItem label={translate("Book Value", "القيمة الدفترية")} value={money(asset.bookValue)} />
            {asset.warehouseId && <InfoItem label={translate("Warehouse", "الفرع")} value={asset.warehouseId.name} />}
          </div>

          {asset.notes && <p className="mt-4 text-gray-600">{asset.notes}</p>}

          <div className="mt-6 flex flex-col gap-3">
            <h4>
              {isIntangible
                ? translate("Amortization History", "سجل الاستهلاك")
                : translate("Depreciation History", "سجل الإهلاك")}
            </h4>
            {depreciations.length === 0 ? (
              <p className="text-sm text-gray-400">
                {translate("No depreciation has been posted for this asset yet.", "لم يتم ترحيل أي إهلاك لهذا الأصل بعد.")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table striped withColumnBorders>
                  <Table.Thead className="bg-gray-100">
                    <Table.Tr>
                      <Table.Th>{translate("Month", "الشهر")}</Table.Th>
                      <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                      <Table.Th className="text-right">{translate("Amount", "المبلغ")}</Table.Th>
                      <Table.Th>{translate("Journal Entry", "القيد")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {depreciations.map((d) => (
                      <Table.Tr key={d.period}>
                        <Table.Td className="tabular-nums">{d.period}</Table.Td>
                        <Table.Td>{formatDate(d.date, language)}</Table.Td>
                        <Table.Td className="text-right tabular-nums">{money(d.amount)}</Table.Td>
                        <Table.Td>
                          <JournalEntryLink entry={d.journalEntry} />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="payments">
          <FixedAssetPaymentsTab asset={asset} />
        </Tabs.Panel>
      </Tabs>

      <UpdateFixedAssetModal opened={editOpened} close={closeEdit} asset={asset} onUpdated={() => load()} />
    </AdminLayoutBox>
  );
}
