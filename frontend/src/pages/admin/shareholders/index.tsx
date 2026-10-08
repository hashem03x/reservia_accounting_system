import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { DEFAULT_ITEMS_PER_PAGE } from "@/utils/constants";
import { Badge, Button, Table } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import PaginationHandler from "@/components/ui/pagination-handler";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import TruncatedText from "@/components/ui/truncated-text";
import { PaginatedData } from "@/types/global";
import { Shareholder } from "@/types/shareholder";
import ShareholderModal from "./_components/shareholder-modal";

const ITEMS_PER_PAGE = import.meta.env.VITE_ITEMS_PER_PAGE || DEFAULT_ITEMS_PER_PAGE;

export default function Shareholders() {
  const { language, translate, translations } = useLanguage();
  const navigate = useNavigate();
  const canCreate = useHasPermission(resources.shareholders, actions.create);

  useDocumentTitle(`${translations.pages.shareholders} | ${translations.adminPanel}`);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activePage, setActivePage] = useState(parseInt(searchParams.get("page") || "1"));
  const params = { page: activePage.toString() };

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<PaginatedData<Shareholder>>({ initialData: null, initialLoading: true });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };
    handleRequest(
      language,
      setLoading,
      setError,
      async () => {
        setData(await privateRequest({ url: "shareholders", params: { limit: ITEMS_PER_PAGE, sort: "shareholderNumber", ...params }, signal: controller.signal, language }));
      },
      canceled,
    );
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    setSearchParams(params, { replace: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    return load();
  }, [activePage]);

  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.shareholders,
        sideElements: canCreate && (
          <Button color="cyan" variant="light" onClick={openModal}>
            {translate("Add Shareholder", "إضافة مساهم")}
          </Button>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading shareholders...", "جاري تحميل المساهمين...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading shareholders", "خطأ في تحميل المساهمين")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        data &&
        (data.data.length === 0 ? (
          <EmptySection useDefaultImg message={translate("No shareholders yet", "لا يوجد مساهمون بعد")} />
        ) : (
          <>
            <DataTableContainer>
              <DataTable className="min-w-[860px]">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th className="whitespace-nowrap">{translate("No.", "الرقم")}</Table.Th>
                    <Table.Th>{translate("Shareholder", "المساهم")}</Table.Th>
                    <Table.Th>{translate("Equity Account", "حساب حقوق الملكية")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Ownership", "نسبة الملكية")}</Table.Th>
                    <Table.Th className="whitespace-nowrap text-right">{translate("Share Capital", "رأس المال المساهم به")}</Table.Th>
                    <Table.Th className="whitespace-nowrap">{translate("Status", "الحالة")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.data.map((shareholder) => (
                    <Table.Tr key={shareholder._id} className="cursor-pointer" onClick={() => navigate(shareholder._id)}>
                      <Table.Td className="whitespace-nowrap tabular-nums">{shareholder.shareholderNumber}</Table.Td>
                      <Table.Td className="font-medium">
                        <TruncatedText text={shareholder.name} maxWidthClassName="max-w-[220px]" />
                      </Table.Td>
                      <Table.Td className="whitespace-nowrap">{shareholder.equityAccount ? `${shareholder.equityAccount.code} - ${shareholder.equityAccount.name}` : "-"}</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right tabular-nums">{shareholder.ownershipPercentage}%</Table.Td>
                      <Table.Td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatAmount(shareholder.shareCapital, translations.currency)}</Table.Td>
                      <Table.Td className="whitespace-nowrap">
                        <Badge color={shareholder.status === "active" ? "green" : "gray"} variant="light">
                          {shareholder.status === "active" ? translate("Active", "نشط") : translate("Inactive", "غير نشط")}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>
            <PaginationHandler<Shareholder> paginatedData={data} activePage={activePage} setActivePage={setActivePage} />
          </>
        ))
      )}

      <ShareholderModal opened={modalOpened} close={closeModal} onSaved={(shareholder) => navigate(shareholder._id)} />
    </AdminLayoutBox>
  );
}
