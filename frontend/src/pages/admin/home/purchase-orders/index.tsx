import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import handleRequest from "@/utils/helpers/handle-request";
import { PurchaseOrder } from "@/types/orders";
import { PaginatedData } from "@/types/global";
import paths from "@/utils/constants/paths";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { getPaymentStatusLabel } from "@/utils/constants/payment-statuses";
import { formatDate } from "@/utils/helpers/date-formaters";
import { Button, Table } from "@mantine/core";
import { solidIcons } from "@/components/icons";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import ImportButton from "@/components/global/import-button";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import ScannerModal from "./_components/scanner-modal";

const PURCHASE_ORDERS_PER_PAGE = import.meta.env.VITE_PURCHASE_ORDERS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function PurchaseOrders() {
  const { language, translate, translations } = useLanguage();

  useDocumentTitle(`${translations.pages.purchaseOrders} | ${translations.adminPanel}`);

  const { getWarehouseNameById } = useWarehouseHelpers();

  const navigate = useNavigate();

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
    data: paginatedPurchaseOrders,
    setData: setPaginatedPurchaseOrders,
  } = useDataHandler<PaginatedData<PurchaseOrder>>({ initialData: null, initialLoading: true });

  function handleLoadPurchaseOrders() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      const response = await privateRequest({
        url: "purchaseOrder",
        params: { limit: PURCHASE_ORDERS_PER_PAGE, ...params },
        signal: controller.signal,
        language,
      });
      setPaginatedPurchaseOrders(response);
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

    const cancelRequest = handleLoadPurchaseOrders(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, [activePage]);

  const canICreatePurchaseOrders = useHasPermission(resources.purchaseOrders, actions.create);

  const [scannerOpened, { open: openScanner, close: closeScanner }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.purchaseOrders,
        backLink: true,
        sideElements: (
          <div className="flex items-center gap-2">
            <>
              <Button variant="light" title={translate("Scan Barcode", "مسح الباركود")} onClick={openScanner}>
                <solidIcons.BarcodeScan size={18} />
              </Button>

              <ScannerModal opened={scannerOpened} close={closeScanner} />
            </>

            <ImportButton url="import/purchase-orders" callback={handleLoadPurchaseOrders} />

            {canICreatePurchaseOrders && (
              <Link to={`${paths.new}`}>
                <Button variant="light" color="teal" leftSection={<solidIcons.Plus />}>
                  {translate("New Purchase Order", "طلب مشتريات جديد")}
                </Button>
              </Link>
            )}
          </div>
        ),
      }}
    >
      {/* Content */}
      {loading ? (
        <LoadingSection message={translate("Loading orders...", "جاري تحميل الطلبات...")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("Error loading orders", "خطأ في تحميل الطلبات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: handleLoadPurchaseOrders }}
        />
      ) : (
        paginatedPurchaseOrders &&
        (paginatedPurchaseOrders.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No Orders Found", "لا يوجد طلبات")} />
        ) : (
          <>
            {/* Table */}
            <div className="overflow-x-auto">
              <Table className="text-nowrap" verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{translate("Order ID", "الرقم المرجعي")}</Table.Th>
                    <Table.Th>{translate("Warehouse", "الفرع")}</Table.Th>
                    <Table.Th>{translate("Vendor", "البائع")}</Table.Th>
                    <Table.Th>{translate("Project", "المشروع")}</Table.Th>
                    <Table.Th>{translate("Payment Status", "حالة الدفع")}</Table.Th>
                    <Table.Th>{translate("Total Amount", "المبلغ الإجمالي")}</Table.Th>
                    <Table.Th>{translate("Paid Amount", "المبلغ المدفوع")}</Table.Th>
                    <Table.Th title={translate("Amount Due to Vendor", "المبلغ المستحق للبائع")}>
                      {translate("Remaining Amount", "المبلغ المتبقي")}
                    </Table.Th>
                    <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                    <Table.Th>{translate("By", "بواسطة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {paginatedPurchaseOrders.data.map((purchaseOrder) => (
                    <Table.Tr
                      key={purchaseOrder._id}
                      className="cursor-pointer text-gray-600"
                      onClick={() => navigate(purchaseOrder._id)}
                    >
                      <Table.Td className="font-semibold text-gray-800">{purchaseOrder._id}</Table.Td>
                      <Table.Td>{getWarehouseNameById(purchaseOrder.warehouseId)}</Table.Td>
                      <Table.Td>{purchaseOrder.vendor.name}</Table.Td>
                      <Table.Td>{purchaseOrder.project?.projectNumber || "-"}</Table.Td>
                      <Table.Td>{getPaymentStatusLabel(purchaseOrder.paymentStatus, language)}</Table.Td>
                      <Table.Td className="font-semibold text-gray-800">{purchaseOrder.totalAmount.toFixed(2)}</Table.Td>
                      <Table.Td>{purchaseOrder.paidAmount.toFixed(2)}</Table.Td>
                      <Table.Td>{purchaseOrder.remainingAmount.toFixed(2)}</Table.Td>
                      <Table.Td>{formatDate(purchaseOrder.createdAt, language)}</Table.Td>
                      <Table.Td>{purchaseOrder.createdBy?.name || ""}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            {/* Pagination */}
            <PaginationHandler<PurchaseOrder>
              paginatedData={paginatedPurchaseOrders}
              activePage={activePage}
              setActivePage={setActivePage}
            />
          </>
        ))
      )}
    </AdminLayoutBox>
  );
}
