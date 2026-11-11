import { useEffect } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { Bar } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, type ChartOptions } from "chart.js";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatAmount } from "@/utils/helpers/format-amount";
import KpiCard from "@/components/ui/kpi-card";
import SectionCard from "@/components/ui/section-card";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { Skeleton, Table } from "@mantine/core";
import { DataTable, DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";
import { CommercialDashboard } from "@/types/commercial";
import paths from "@/utils/constants/paths";
import { Link } from "react-router-dom";
import dayjs from "dayjs";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

// Reservia Commercial dashboard - every figure below is read straight off GET /commercial/dashboard
// (controller/commercial/dashboardController.js), which computes it from persisted
// CommercialProject/CommercialRevision documents at request time - nothing here is a static
// sample, matching the same "no fabricated statistics" rule CRM's own dashboard follows.
export default function CommercialDashboardPage() {
  const { translate, language } = useLanguage();
  const colorScheme = useComputedColorScheme("light");
  const isDark = colorScheme === "dark";

  useDocumentTitle(`${translate("Dashboard", "لوحة التحكم")} | Reservia Commercial`);

  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<CommercialDashboard | null>({ initialData: null, initialLoading: true });

  useEffect(() => {
    const canceled = { current: false };
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "commercial/dashboard", language });
      if (!canceled.current) setData(res.data as CommercialDashboard);
    }, canceled);
    return () => {
      canceled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <ErrorSection
        errorTitle={translate("Error loading the dashboard", "خطأ في تحميل لوحة التحكم")}
        errorMessage={error}
        button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: () => window.location.reload() }}
      />
    );
  }

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const tickColor = isDark ? "#8D9BA6" : "#66727F";
  const byCategory = data?.projectsByCategory || [];

  const chartData = {
    labels: byCategory.map((c) => c.category),
    datasets: [{ label: translate("Projects", "المشاريع"), data: byCategory.map((c) => c.count), backgroundColor: "#123B5D" }],
  };
  const chartOptions: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor } },
      y: { beginAtZero: true, ticks: { stepSize: 1, color: tickColor }, grid: { color: gridColor } },
    },
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="kpi-grid grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label={translate("Total Projects", "إجمالي المشاريع")} value={data?.totalProjects ?? 0} loading={loading} />
        <KpiCard label={translate("Draft Projects", "مشاريع مبدئية")} value={data?.draftProjects ?? 0} loading={loading} />
        <KpiCard label={translate("Pending Engineering Approval", "في انتظار الموافقة الفنية")} value={data?.pendingEngineeringApproval ?? 0} loading={loading} />
        <KpiCard label={translate("Pending Commercial Approval", "في انتظار الموافقة التجارية")} value={data?.pendingCommercialApproval ?? 0} loading={loading} />
        <KpiCard label={translate("Approved Projects", "مشاريع معتمدة")} value={data?.approvedProjects ?? 0} loading={loading} />
        <KpiCard label={translate("Total Estimated Project Value", "القيمة التقديرية الإجمالية")} value={formatAmount(data?.totalEstimatedProjectValue, "EGP")} loading={loading} />
        <KpiCard label={translate("Total Estimated Material Cost", "إجمالي تكلفة المواد")} value={formatAmount(data?.totalEstimatedMaterialCost, "EGP")} loading={loading} />
        <KpiCard label={translate("Expected Gross Profit", "إجمالي الربح المتوقع")} value={formatAmount(data?.expectedGrossProfit, "EGP")} loading={loading} />
        <KpiCard
          label={translate("Average Margin", "متوسط الهامش")}
          value={data?.averageMarginPct != null ? `${(data.averageMarginPct * 100).toFixed(1)}%` : "-"}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title={translate("Projects by Category", "المشاريع حسب الفئة")}>
          {loading ? (
            <Skeleton height={220} />
          ) : !byCategory.length ? (
            <EmptySection useDefaultImg message={translate("No projects yet", "لا توجد مشاريع بعد")} />
          ) : (
            <div style={{ height: 220 }}>
              <Bar data={chartData} options={chartOptions} />
            </div>
          )}
        </SectionCard>

        <SectionCard title={translate("Recently Created Projects", "المشاريع المنشأة حديثاً")} viewAllTo={`/${paths.commercial}/${paths.commercialProjects}`} viewAllLabel={translate("View all", "عرض الكل")}>
          {loading ? (
            <Skeleton height={220} />
          ) : !data?.recentProjects.length ? (
            <EmptySection useDefaultImg message={translate("No projects yet", "لا توجد مشاريع بعد")} />
          ) : (
            <DataTableContainer>
              <DataTable>
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th>{translate("Code", "الرمز")}</Table.Th>
                    <Table.Th>{translate("Name", "الاسم")}</Table.Th>
                    <Table.Th>{translate("Category", "الفئة")}</Table.Th>
                    <Table.Th>{translate("Created", "تاريخ الإنشاء")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.recentProjects.map((p) => (
                    <Table.Tr key={p._id}>
                      <Table.Td>
                        <Link to={`/${paths.commercial}/${paths.commercialProjects}/${p._id}`} className="font-medium text-primary-600 hover:underline">
                          {p.projectCode}
                        </Link>
                      </Table.Td>
                      <Table.Td>{p.name}</Table.Td>
                      <Table.Td>{p.category}</Table.Td>
                      <Table.Td>{dayjs(p.createdAt).format("DD MMM YYYY")}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </DataTable>
            </DataTableContainer>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
