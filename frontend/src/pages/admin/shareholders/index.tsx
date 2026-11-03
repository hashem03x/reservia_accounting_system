import { useEffect } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import handleRequest from "@/utils/helpers/handle-request";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Button } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { solidIcons } from "@/components/icons";
import { Shareholder } from "@/types/shareholder";
import { CompanyCapital } from "@/types/company-capital";
import CapitalSummaryCards from "./_components/capital-summary-cards";
import IssuedCapitalModal from "./_components/issued-capital-modal";
import CapitalStructureSetupModal from "./_components/capital-structure-setup-modal";
import ShareholderModal from "./_components/shareholder-modal";
import ShareholderCard from "./_components/shareholder-card";

type DashboardData = { capital: CompanyCapital; shareholders: Shareholder[] };

export default function Shareholders() {
  const { language, translate, translations } = useLanguage();
  const canCreate = useHasPermission(resources.shareholders, actions.create);
  const canUpdate = useHasPermission(resources.shareholders, actions.update);

  useDocumentTitle(`${translations.pages.shareholders} | ${translations.adminPanel}`);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<DashboardData | null>({ initialData: null, initialLoading: true });

  function load() {
    const controller = new AbortController();
    const canceled = { current: false };
    handleRequest(
      language,
      setLoading,
      setError,
      async () => {
        const [capitalRes, shareholdersRes] = await Promise.all([
          privateRequest({ url: "shareholders/company-capital", signal: controller.signal, language }),
          privateRequest({ url: "shareholders", params: { limit: "500", sort: "shareholderNumber" }, signal: controller.signal, language }),
        ]);
        if (!canceled.current) setData({ capital: capitalRes.data, shareholders: shareholdersRes.data });
      },
      canceled,
    );
    return () => {
      controller.abort();
      canceled.current = true;
    };
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [setupOpened, { open: openSetup, close: closeSetup }] = useDisclosure();
  const [issuedCapitalOpened, { open: openIssuedCapital, close: closeIssuedCapital }] = useDisclosure();
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translate("Equity", "حقوق الملكية"),
        subTitle: translate("Company capital, shareholders and capital payments.", "رأس مال الشركة والمساهمون ومدفوعات رأس المال."),
        sideElements: (
          <div className="flex flex-wrap gap-2">
            {canCreate && !data?.capital && (
              <Button color="cyan" onClick={openSetup} leftSection={<solidIcons.Hashtag size={12} />}>
                {translate("Capital Structure Setup", "إعداد هيكل رأس المال")}
              </Button>
            )}
            {canCreate && (
              <Button color="cyan" variant="light" onClick={openAdd}>
                {translate("Add Shareholder", "إضافة مساهم")}
              </Button>
            )}
          </div>
        ),
      }}
    >
      {loading ? (
        <LoadingSection message={translate("Loading equity data...", "جاري تحميل بيانات حقوق الملكية...")} />
      ) : error ? (
        <ErrorSection errorTitle={translate("Error loading equity data", "خطأ في تحميل بيانات حقوق الملكية")} errorMessage={error} button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }} />
      ) : (
        data && (
          <div className="flex flex-col gap-6">
            <CapitalSummaryCards capital={data.capital} loading={false} canEdit={canUpdate} onEditIssuedCapital={openIssuedCapital} />

            <div className="flex flex-col gap-3">
              <h3>{translate("Shareholders", "المساهمون")}</h3>
              {data.shareholders.length === 0 ? (
                <EmptySection useDefaultImg message={translate("No shareholders yet", "لا يوجد مساهمون بعد")}>
                  {canCreate && (
                    <Button onClick={data.capital ? openAdd : openSetup} color="cyan">
                      {data.capital ? translate("Add Shareholder", "إضافة مساهم") : translate("Set up Capital Structure", "إعداد هيكل رأس المال")}
                    </Button>
                  )}
                </EmptySection>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.shareholders.map((s) => (
                    <ShareholderCard key={s._id} shareholder={s} onChanged={load} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      )}

      <CapitalStructureSetupModal opened={setupOpened} close={closeSetup} onSaved={load} existingShareholders={data?.shareholders ?? []} />
      <IssuedCapitalModal opened={issuedCapitalOpened} close={closeIssuedCapital} capital={data?.capital ?? null} onSaved={load} />
      <ShareholderModal opened={addOpened} close={closeAdd} onSaved={load} />
    </AdminLayoutBox>
  );
}
