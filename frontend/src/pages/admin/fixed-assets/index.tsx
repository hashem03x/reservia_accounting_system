import { FixedAsset, FixedAssetStatus } from "@/types/fixed-asset";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { formatAmount } from "@/utils/helpers/format-amount";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Badge, Button, Select, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import CreateFixedAssetModal from "./_components/create-fixed-asset-modal";
import RunDepreciationModal from "./_components/run-depreciation-modal";
import { useFixedAssetStatusLabel, fixedAssetStatusColors } from "./_components/status";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function FixedAssets() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const statusLabel = useFixedAssetStatusLabel();

  useDocumentTitle(`${translations.pages.fixedAssets} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");

  const params: Record<string, string> = { page: activePage.toString() };
  if (statusFilter) params.status = statusFilter;

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedAssets,
    setData: setPaginatedAssets,
  } = useDataHandler<PaginatedData<FixedAsset>>({ initialData: null, initialLoading: true });

  function handleLoadFixedAssets() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "fixed-assets",
        params: { limit: ITEMS_PER_PAGE, sort: "-createdAt", ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedAssets(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    setSearchParams(params, { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    const cancelRequest = handleLoadFixedAssets();
    return cancelRequest;
  }, [activePage, statusFilter]);

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure();
  const [runModalOpened, { open: openRunModal, close: closeRunModal }] = useDisclosure();

  const statuses: FixedAssetStatus[] = ["active", "fully_depreciated", "under_maintenance", "disposed"];

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.fixedAssets,
        sideElements: (
          <div className="flex flex-wrap gap-2">
            <Button color="grape" variant="light" onClick={openRunModal}>
              {translate("Run Depreciation", "تشغيل الإهلاك")}
            </Button>
            <Button color="cyan" variant="light" onClick={openCreateModal}>
              {translate("Create Fixed Asset", "إنشاء أصل ثابت")}
            </Button>
          </div>
        ),
      }}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          placeholder={translate("Filter by status", "تصفية حسب الحالة")}
          value={statusFilter || null}
          onChange={(v) => {
            setActivePage(1);
            setStatusFilter(v || "");
          }}
          data={statuses.map((status) => ({ value: status, label: statusLabel(status) }))}
          clearable
          w={220}
        />
      </div>

      {loading ? (
        <LoadingSection message={translate("Loading fixed assets...", "جاري تحميل الأصول الثابتة...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading fixed assets", "خطأ في تحميل الأصول الثابتة")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadFixedAssets }}
        />
      ) : (
        paginatedAssets &&
        (paginatedAssets.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No fixed assets found", "لا توجد أصول ثابتة")} />
        ) : (
          <>
            <DataTableContainer>
              <DataTable className="min-w-[1100px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("Asset No.", "رقم الأصل")}</Table.Th>
                    <Table.Th>{translate("Asset", "الأصل")}</Table.Th>
                    <Table.Th>{translate("Vendor", "البائع")}</Table.Th>
                    <Table.Th>{translate("Asset Account", "حساب الأصل")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Cost", "التكلفة")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Accumulated", "المجمع")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Book Value", "القيمة الدفترية")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">
                      {translate("Useful Life (months)", "العمر الإنتاجي بالشهور")}
                    </Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedAssets.data.map((asset) => (
                    <Table.Tr key={asset._id} className="cursor-pointer" onClick={() => navigate(asset._id)}>
                      <Table.Td className="whitespace-nowrap tabular-nums">{asset.assetCode || "-"}</Table.Td>
                      <Table.Td className="font-medium">
                        <TruncatedText text={asset.name} maxWidthClassName="max-w-[180px]" />
                      </Table.Td>
                      <Table.Td>
                        <TruncatedText text={asset.vendor?.name || "-"} maxWidthClassName="max-w-[160px]" />
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        {asset.assetAccountId ? `${asset.assetAccountId.code} - ${asset.assetAccountId.name}` : "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        {asset.acquisitionDate ? formatDate(asset.acquisitionDate, language) : "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {formatAmount(asset.price, translations.currency)}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {formatAmount(asset.accumulatedDepreciation ?? 0, translations.currency)}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right font-semibold tabular-nums">
                        {formatAmount(asset.bookValue, translations.currency)}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">
                        {asset.usefulLifeMonths ?? "-"}
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={fixedAssetStatusColors[asset.status || "active"]} variant="light">
                          {statusLabel(asset.status || "active")}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>

            <PaginationHandler<FixedAsset>
              paginatedData={paginatedAssets}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}

      <CreateFixedAssetModal
        opened={createModalOpened}
        close={closeCreateModal}
        onCreated={(asset) => navigate(asset._id)}
      />
      <RunDepreciationModal opened={runModalOpened} close={closeRunModal} onCompleted={handleLoadFixedAssets} />
    </AdminLayoutBox>
  );
}
