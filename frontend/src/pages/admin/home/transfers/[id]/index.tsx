import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { Transfer as TransferType } from "@/types/transfer";
import { getTransferTypeLabel } from "@/utils/constants/transfer-types";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import paths from "@/utils/constants/paths";
import { Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";

const infoClassNames = "flex flex-wrap justify-between";

export default function Transfer() {
  const { language, translate, translations } = useLanguage();

  const { id } = useParams<{ id: string }>();

  const {
    privateRequest,
    loading,
    setLoading,
    error,
    setError,
    data: transfer,
    setData: setTransfer,
  } = useDataHandler<TransferType | null>({ initialData: null, initialLoading: true });

  useDocumentTitle(`${translate("Transfer Details", "تفاصيل التحويلة")} | ${translations.pages.transfers}`);

  const { getWarehouseNameById } = useWarehouseHelpers();

  function handleLoadTransfer() {
    const controller = new AbortController();
    const canceled = { current: false };

    const executeFetch = async () => {
      // Backend Issue: There is no endpoint to get a single transfer by ID.
      const response = await privateRequest({ url: `transfer?_id=${id}`, signal: controller.signal, language });
      if (response.data.length === 0) setError(translate("Transfer not found", "التحويلة غير موجودة"));
      else setTransfer(response.data[0]);
    };

    handleRequest(language, setLoading, setError, executeFetch, canceled);

    // Return a function to cancel this request
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    const cancelRequest = handleLoadTransfer(); // This will send the request and return the function to cancel it.
    return cancelRequest; // This will be called when the component unmounts.
  }, []);

  return (
    <AdminLayoutBox header={{ title: translate("Transfer Data", "تفاصيل التحويلة"), backLink: true }}>
      {loading ? (
        <LoadingSection message={translate("Loading transfer data", "جاري تحميل تفاصيل التحويلة")} />
      ) : error ? (
        <ErrorSection
          errorTitle={translate("An error occurred while loading transfer data", "حدث خطأ أثناء تحميل تفاصيل التحويلة")}
          errorMessage={error}
          button={{ text: translate("Retry", "إعادة المحاولة"), onClick: handleLoadTransfer }}
        />
      ) : (
        transfer && (
          <section className="flex w-full flex-col gap-6 rounded-xl bg-gray-100 p-4 sm:p-6">
            {/* Transfer Header */}
            <div className="border-b pb-2">
              <p>
                {translate("ID", "الرقم المرجعي")}: {transfer._id}
              </p>
            </div>

            {/* Transfer Summary */}
            <div className="flex flex-col gap-2">
              <div className={infoClassNames}>
                <p className="font-medium">{translate("Product Title", "عنوان المنتج")}</p>
                <Link to={`/${paths.admin}/${paths.home}/${paths.products}/${transfer.product._id}`}>
                  <p className="text-blue-500">{translate(transfer.product.title.en, transfer.product.title.ar)}</p>
                </Link>
              </div>
              <div className={infoClassNames}>
                <p className="font-medium">{translate("Transfer Type", "نوع التحويلة")}</p>
                <p>{getTransferTypeLabel(transfer.type, language)}</p>
              </div>
              <div className={infoClassNames}>
                <p className="font-medium">{translate("Source Warehouse", "المخزن المصدر")}</p>
                <p>{getWarehouseNameById(transfer.sourceWarehouse)}</p>
              </div>
              <div className={infoClassNames}>
                <p className="font-medium">{translate("Target Warehouse", "المخزن المستهدف")}</p>
                <p>{getWarehouseNameById(transfer.targetWarehouse)}</p>
              </div>
              <div className={infoClassNames}>
                <p className="font-medium">{translate("Date & Time", "التاريخ والوقت")}</p>
                <p>{formatDateAndTime(transfer.createdAt, language)}</p>
              </div>
            </div>

            {/* Transferred Products Table */}
            <div className="rounded-md bg-white p-3 sm:p-4">
              <h3>{translate("Transferred Products", "المنتجات المحولة")}</h3>

              {transfer.type === "product" && (
                <p className="text-sm">
                  {translate("All available stock of this product is transferred", "تم تحويل جميع كمية هذا المنتج")}
                </p>
              )}

              {transfer.details.length > 0 && (
                <div className="overflow-x-auto">
                  <Table className="mt-2 text-nowrap text-gray-600" verticalSpacing="xs" highlightOnHover>
                    <Table.Thead>
                      <Table.Tr className="border-t text-gray-800">
                        <Table.Th py={8}>{translate("Title", "العنوان")}</Table.Th>
                        <Table.Th py={8}>{translate("Quantity", "الكمية")}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {transfer.details.map((detail) => (
                        <Table.Tr key={detail._id}>
                          <Table.Td className="font-bold text-gray-800">
                            {translate(detail.product.title.en, detail.product.title.ar)}
                          </Table.Td>
                          <Table.Td className="font-bold text-gray-800">{detail.quantity}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </div>
              )}
            </div>
          </section>
        )
      )}
    </AdminLayoutBox>
  );
}
