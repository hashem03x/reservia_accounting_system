import { Transfer } from "@/types/transfer";
import { PaginatedData } from "@/types/global";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { getTransferTypeLabel, transferTypesArray } from "@/utils/constants/transfer-types";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Button, Select, Table } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import TransferModal from "./_components/transfer-modal";
import { useWarehouses } from "@/context/WarehousesContext";
import { DatePickerInput } from "@mantine/dates";

const TRANSFERS_PER_PAGE = import.meta.env.VITE_TRANSFERS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

const noFilterLabel = { en: "All", ar: "الكل" };

export default function Transfers() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.transfers} | ${translations.adminPanel}`);

  const navigate = useNavigate();
  const { getWarehouseNameById } = useWarehouseHelpers();
  const { data: warehouses } = useWarehouses();

  // URL search params for filters
  const [searchParams, setSearchParams] = useSearchParams();

  // State management for filters
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const [typeFilter, setTypeFilter] = useState(searchParams.get("type") || "");
  const [sourceWarehouseFilter, setSourceWarehouseFilter] = useState(searchParams.get("sourceWarehouse") || "");
  const [targetWarehouseFilter, setTargetWarehouseFilter] = useState(searchParams.get("targetWarehouse") || "");
  const [dateFromFilter, setDateFromFilter] = useState<Date | null>(
    searchParams.get("createdAt[gte]") ? new Date(searchParams.get("createdAt[gte]")!) : null,
  );
  const [dateToFilter, setDateToFilter] = useState<Date | null>(
    searchParams.get("createdAt[lte]") ? new Date(searchParams.get("createdAt[lte]")!) : null,
  );

  const params = {
    page: activePage.toString(),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(sourceWarehouseFilter ? { sourceWarehouse: sourceWarehouseFilter } : {}),
    ...(targetWarehouseFilter ? { targetWarehouse: targetWarehouseFilter } : {}),
    ...(dateFromFilter ? { "createdAt[gte]": dateFromFilter.toISOString() } : {}),
    ...(dateToFilter ? { "createdAt[lte]": dateToFilter.toISOString() } : {}),
  };

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: paginatedTransfers,
    setData: setPaginatedTransfers,
  } = useDataHandler<PaginatedData<Transfer>>({ initialData: null, initialLoading: true });

  function handleLoadTransfers() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "transfer",
        params: { limit: TRANSFERS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedTransfers(response);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    // Sync URL search params with filters
    setSearchParams(params, { replace: true });

    window.scrollTo({ top: 0, behavior: "instant" });

    const cancelRequest = handleLoadTransfers(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage, typeFilter, sourceWarehouseFilter, targetWarehouseFilter, dateFromFilter, dateToFilter]);

  const canICreateTransfers = useHasPermission(resources.transfers, actions.create);

  // ========== Handle Modals ==========

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  return (
    <AdminLayoutBox
      header={{
        backLink: `/${paths.admin}/${paths.home}`,
        title: translations.pages.transfers,
        sideElements: canICreateTransfers && (
          <Button onClick={openModal} variant="light" color="teal" leftSection={<solidIcons.Plus />}>
            {translate("New Transfer", "تحويلة جديدة")}
          </Button>
        ),
      }}
    >
      {/* Filters */}
      <div className="flex flex-col flex-wrap gap-2 rounded-lg bg-gray-50 p-3 shadow-sm lg:flex-row lg:items-center">
        {/* Transfer Type */}
        <Select
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as string)}
          label={translate("Transfer Type", "نوع التحويلة")}
          data={[
            { value: "", label: translate(noFilterLabel.en, noFilterLabel.ar) },
            ...transferTypesArray.map((type) => ({
              value: type.value,
              label: translate(type.label.en, type.label.ar),
            })),
          ]}
          allowDeselect={false}
          rightSection={typeFilter ? <solidIcons.Check color="green" size={12} /> : null}
          radius="md"
          flex={1}
        />

        {/* Source Warehouse */}
        <Select
          value={sourceWarehouseFilter}
          onChange={(value) => setSourceWarehouseFilter(value as string)}
          label={translate("From Warehouse", "من المخزن")}
          data={[
            { value: "", label: translate(noFilterLabel.en, noFilterLabel.ar) },
            ...warehouses.map((warehouse) => ({
              value: warehouse._id,
              label: warehouse.name,
            })),
          ]}
          allowDeselect={false}
          rightSection={sourceWarehouseFilter ? <solidIcons.Check color="green" size={12} /> : null}
          radius="md"
          flex={1}
        />

        {/* Target Warehouse */}
        <Select
          value={targetWarehouseFilter}
          onChange={(value) => setTargetWarehouseFilter(value as string)}
          label={translate("To Warehouse", "إلى المخزن")}
          data={[
            { value: "", label: translate(noFilterLabel.en, noFilterLabel.ar) },
            ...warehouses.map((warehouse) => ({
              value: warehouse._id,
              label: warehouse.name,
            })),
          ]}
          allowDeselect={false}
          rightSection={targetWarehouseFilter ? <solidIcons.Check color="green" size={12} /> : null}
          radius="md"
          flex={1}
        />

        {/* Date From */}
        <DatePickerInput
          value={dateFromFilter}
          onChange={setDateFromFilter}
          label={translate("From Date", "من تاريخ")}
          placeholder={translate("Pick a date", "اختر تاريخ")}
          maxDate={dateToFilter || undefined}
          clearable
          radius="md"
          flex={1}
        />

        {/* Date To */}
        <DatePickerInput
          value={dateToFilter}
          onChange={setDateToFilter}
          label={translate("To Date", "إلى تاريخ")}
          placeholder={translate("Pick a date", "اختر تاريخ")}
          minDate={dateFromFilter || undefined}
          clearable
          radius="md"
          flex={1}
        />
      </div>

      {loading ? (
        <LoadingSection message={translate("Loading transfers...", "جاري تحميل التحويلات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading transfers", "خطأ في تحميل التحويلات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadTransfers }}
        />
      ) : (
        paginatedTransfers &&
        (paginatedTransfers.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No transfers found", "لا توجد تحويلات")} />
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Transfer ID", "رقم التحويلة")}</Table.Th>
                    <Table.Th>{translate("Product", "المنتج")}</Table.Th>
                    <Table.Th>{translate("Type", "النوع")}</Table.Th>
                    <Table.Th>{translate("From", "من")}</Table.Th>
                    <Table.Th>{translate("To", "إلى")}</Table.Th>
                    <Table.Th>{translate("Date & Time", "التاريخ والوقت")}</Table.Th>
                    <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedTransfers.data.map((transfer) => (
                    <Table.Tr
                      key={transfer._id}
                      className="cursor-pointer text-gray-600"
                      onClick={() => navigate(`${transfer._id}`)}
                    >
                      <Table.Td className="font-semibold text-gray-800">{transfer._id}</Table.Td>
                      <Table.Td>{translate(transfer.product.title.en, transfer.product.title.ar)}</Table.Td>
                      <Table.Td>{getTransferTypeLabel(transfer.type, language)}</Table.Td>
                      <Table.Td className="font-semibold text-gray-800">
                        {getWarehouseNameById(transfer.sourceWarehouse)}
                      </Table.Td>
                      <Table.Td className="font-semibold text-gray-800">
                        {getWarehouseNameById(transfer.targetWarehouse)}
                      </Table.Td>
                      <Table.Td>{formatDateAndTime(transfer.createdAt, language)}</Table.Td>
                      <Table.Td>{transfer.transferredBy?.name || ""}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<Transfer>
              paginatedData={paginatedTransfers}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}

      {/* Modals */}
      <TransferModal opened={modalOpened} close={closeModal} setPaginatedTransfers={setPaginatedTransfers} />
    </AdminLayoutBox>
  );
}
