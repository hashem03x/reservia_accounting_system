import { FixedAsset } from "@/types/fixed-asset";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
// import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import CreateFixedAssetModal from "./_components/create-fixed-asset-modal";
import UpdateFixedAssetModal from "./_components/update-fixed-asset-modal";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function FixedAssets() {
  const { language, translate, translations } = useLanguage();
  // const { getWarehouseNameById } = useWarehouseHelpers();

  useDocumentTitle(`${translations.pages.fixedAssets} | ${translations.adminPanel}`);

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));

  const params = {
    page: activePage.toString(),
  };

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
        params: { limit: ITEMS_PER_PAGE, ...params },
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
  }, [activePage]);

  // Handle Modals
  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure();
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | null>(null);
  const [updateModalOpened, { open: openUpdateModal, close: closeUpdateModal }] = useDisclosure();

  function handleOpenUpdateModal(asset: FixedAsset) {
    setSelectedAsset(asset);
    openUpdateModal();
  }

  function handleCloseUpdateModal() {
    closeUpdateModal();
    setTimeout(() => setSelectedAsset(null), 250);
  }

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.fixedAssets,
        sideElements: (
          <Button color="cyan" variant="light" onClick={openCreateModal}>
            {translate("Create Fixed Asset", "إنشاء أصل ثابت")}
          </Button>
        ),
      }}
    >
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
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                  <Table.Th>{translate("Book Value", "القيمة الدفترية")}</Table.Th>
                  <Table.Th>{translate("Fair Value", "القيمة العادلة")}</Table.Th>
                  <Table.Th>{translate("Loss Value", "قيمة الخسارة")}</Table.Th>
                  <Table.Th>{translate("Asset Account", "حساب الأصل")}</Table.Th>
                  <Table.Th>{translate("Status", "الحالة")}</Table.Th>
                  <Table.Th>{translate("Warehouse", "المستودع")}</Table.Th>
                  <Table.Th>{translate("Created At", "تاريخ الإنشاء")}</Table.Th>
                  <Table.Th>{translate("Updated At", "تاريخ التحديث")}</Table.Th>
                  <Table.Th>{translate("Actions", "الإجراءات")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {paginatedAssets.data.map((asset) => (
                  <Table.Tr key={asset._id}>
                    <Table.Td>{asset.name}</Table.Td>
                    <Table.Td>{asset.bookValue}</Table.Td>
                    <Table.Td>{asset.fairValue}</Table.Td>
                    {/* <Table.Td>{asset.bookValue - asset.fairValue}</Table.Td> use tofixed(2) */}
                    <Table.Td>{(asset.bookValue - asset.fairValue) > 0 ? (asset.bookValue - asset.fairValue).toFixed(2) : 0} </Table.Td>
                    <Table.Td>{asset.assetAccountId ? `${asset.assetAccountId.code} - ${asset.assetAccountId.name}` : "-"}</Table.Td>
                    <Table.Td>{asset.status || "-"}</Table.Td>
                    <Table.Td>{asset.warehouseId.name}</Table.Td>
                    <Table.Td>{formatDateAndTime(asset.createdAt, language)}</Table.Td>
                    <Table.Td>{formatDateAndTime(asset.updatedAt, language)}</Table.Td>
                    <Table.Td>
                      <Button variant="light" size="xs" onClick={() => handleOpenUpdateModal(asset)}>
                        {translate("Update", "تحديث")}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <PaginationHandler
              paginatedData={paginatedAssets}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}

      <CreateFixedAssetModal opened={createModalOpened} close={closeCreateModal} setPaginatedAssets={setPaginatedAssets} />
      {selectedAsset && (
        <UpdateFixedAssetModal
          opened={updateModalOpened}
          close={handleCloseUpdateModal}
          asset={selectedAsset}
          setPaginatedAssets={setPaginatedAssets}
        />
      )}
    </AdminLayoutBox>
  );
}