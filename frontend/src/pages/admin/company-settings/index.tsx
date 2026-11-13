import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, NumberInput, Switch, Table } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import ErrorAlert from "@/components/ui/error-alert";
import paths from "@/utils/constants/paths";
import { CompanySettings } from "@/hooks/useCompanySettings";

type SettingsResponse = CompanySettings & {
  history: { at: string; byName: string | null; changes: Record<string, { from: unknown; to: unknown }> }[];
  updatedAt: string | null;
};
type ZeroVatRow = {
  type: "sales" | "purchase";
  _id: string;
  code: string | null;
  date: string | null;
  party: string | null;
  project: string | null;
  amount: number;
  reason: string | null;
};
type ZeroVatReport = {
  rows: ZeroVatRow[];
  summary: { sales: number; purchase: number; withoutReason: number; amount: number };
};

/**
 * ERP company-level controls (ERP Developer Modification Request, 12 Nov 2026): the default VAT rate
 * of new invoices (CHG-06), the PO price variance warning (CHG-07) and the negative project stock rule
 * (CHG-03), with the change history - plus the 0% VAT review list (CHG-06). Administrators only.
 */
export default function CompanySettingsPage() {
  const { language, translate } = useLanguage();
  useDocumentTitle(translate("Company settings", "إعدادات الشركة"));
  const { privateRequest, loading, setLoading, error, setError, data, setData } = useDataHandler<SettingsResponse | null>({
    initialData: null,
    initialLoading: true,
  });
  const save = useDataHandler({ initialData: null });
  const report = useDataHandler<ZeroVatReport | null>({ initialData: null });
  const [form, setForm] = useState<CompanySettings | null>(null);
  const [range, setRange] = useState<[Date | null, Date | null]>([null, null]);

  const LABELS: Record<string, string> = {
    vatDefaultPct: translate("Default VAT rate", "نسبة الضريبة الافتراضية"),
    priceVarianceWarnPct: translate("Price variance warning", "تنبيه فرق السعر"),
    preventNegativeProjectStock: translate("Prevent negative project stock", "منع رصيد مخزون مشروع بالسالب"),
  };

  function load() {
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({ url: "company-settings", language });
      setData(res.data as SettingsResponse);
      setForm({
        vatDefaultPct: res.data.vatDefaultPct,
        priceVarianceWarnPct: res.data.priceVarianceWarnPct,
        preventNegativeProjectStock: res.data.preventNegativeProjectStock,
      });
    });
  }

  function loadReport() {
    const iso = (d: Date | null) =>
      d
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        : undefined;
    handleRequest(language, report.setLoading, report.setError, async () => {
      const res = await report.privateRequest({
        url: "company-settings/zero-vat-invoices",
        params: { ...(range[0] ? { from: iso(range[0]) } : {}), ...(range[1] ? { to: iso(range[1]) } : {}) },
        language,
      });
      report.setData(res.data as ZeroVatReport);
    });
  }

  useEffect(() => {
    load();
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit() {
    if (!form) return;
    handleRequest(language, save.setLoading, save.setError, async () => {
      const res = await save.privateRequest({ url: "company-settings", method: "PATCH", data: form, language });
      setData(res.data as SettingsResponse);
    });
  }

  const dirty = !!(data && form) && (Object.keys(form) as (keyof CompanySettings)[]).some((k) => form[k] !== data[k]);
  const fmt = (v: unknown, key: string) =>
    typeof v === "boolean"
      ? v
        ? translate("On", "تشغيل")
        : translate("Off", "إيقاف")
      : key.endsWith("Pct")
        ? `${v}%`
        : String(v);

  return (
    <AdminLayoutBox
      header={{
        title: translate("Company settings", "إعدادات الشركة"),
        subTitle: translate(
          "Accounting controls that apply to the whole company. Every change is recorded.",
          "ضوابط محاسبية تنطبق على الشركة كلها. يُسجَّل كل تغيير.",
        ),
      }}
    >
      {loading ? (
        <LoadingSection />
      ) : error || !form ? (
        <ErrorSection
          errorTitle={translate("Could not load the settings", "تعذر تحميل الإعدادات")}
          errorMessage={error}
          button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: load }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <section className="grid gap-4 rounded-lg border border-gray-200 p-4 dark:border-line md:grid-cols-3">
            <NumberInput
              label={LABELS.vatDefaultPct}
              description={translate(
                "New sales and purchase invoices start with this rate. 0% then needs a reason.",
                "تبدأ فواتير البيع والشراء الجديدة بهذه النسبة. وتحتاج 0% إلى سبب.",
              )}
              value={form.vatDefaultPct}
              onChange={(v) => setForm({ ...form, vatDefaultPct: Number(v) || 0 })}
              min={0}
              max={100}
              decimalScale={2}
              suffix="%"
              data-testid="settings-vat-default"
            />
            <NumberInput
              label={LABELS.priceVarianceWarnPct}
              description={translate(
                "A PO line warns when its unit price differs from the product's last or average PO price by more than this.",
                "ينبّه بند أمر الشراء عندما يختلف سعر الوحدة عن آخر سعر أو متوسط السعر بأكثر من هذه النسبة.",
              )}
              value={form.priceVarianceWarnPct}
              onChange={(v) => setForm({ ...form, priceVarianceWarnPct: Number(v) || 0 })}
              min={1}
              max={1000}
              suffix="%"
              data-testid="settings-price-variance"
            />
            <div className="flex flex-col gap-1">
              <Switch
                label={LABELS.preventNegativeProjectStock}
                checked={form.preventNegativeProjectStock}
                onChange={(e) => setForm({ ...form, preventNegativeProjectStock: e.currentTarget.checked })}
                data-testid="settings-negative-stock"
              />
              <p className="text-xs text-gray-500">
                {translate(
                  "A sales invoice line above the stock the project holds is refused. Individual products can be allowed to go below zero.",
                  "يُرفض بند فاتورة بيع يزيد على مخزون المشروع. يمكن السماح لمنتجات بعينها بالنزول تحت الصفر.",
                )}
              </p>
            </div>
            <div className="flex gap-2 md:col-span-3">
              <Button color="teal" onClick={submit} loading={save.loading} disabled={!dirty} data-testid="settings-save">
                {translate("Save settings", "حفظ الإعدادات")}
              </Button>
            </div>
            {save.error && (
              <div className="md:col-span-3">
                <ErrorAlert error={save.error} />
              </div>
            )}
          </section>

          {!!data?.history.length && (
            <section>
              <h4 className="mb-2">{translate("Change history", "سجل التغييرات")}</h4>
              <div className="overflow-x-auto">
                <Table striped miw={520} data-testid="settings-history">
                  <Table.Tbody>
                    {data.history.map((h, i) => (
                      <Table.Tr key={i}>
                        <Table.Td className="whitespace-nowrap text-xs">{formatDateAndTime(h.at, language)}</Table.Td>
                        <Table.Td className="text-xs">{h.byName || "-"}</Table.Td>
                        <Table.Td className="text-xs">
                          {Object.entries(h.changes || {})
                            .map(([k, c]) => `${LABELS[k] || k}: ${fmt(c.from, k)} → ${fmt(c.to, k)}`)
                            .join("; ")}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            </section>
          )}

          <section data-testid="zero-vat-report">
            <h4 className="mb-1">{translate("0% VAT invoices - review", "فواتير بضريبة 0% - مراجعة")}</h4>
            <p className="mb-3 text-xs text-gray-500">
              {translate(
                "Every sales and purchase invoice without VAT, with the reason given. Invoices saved before the reason was required show none.",
                "كل فواتير البيع والشراء بدون ضريبة مع السبب المذكور. الفواتير المحفوظة قبل اشتراط السبب تظهر بدون سبب.",
              )}
            </p>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <DatePickerInput
                type="range"
                label={translate("Date range", "الفترة")}
                value={range}
                onChange={setRange}
                clearable
                className="w-[280px]"
                valueFormat="YYYY-MM-DD"
              />
              <Button variant="light" onClick={loadReport} loading={report.loading}>
                {translate("Show", "عرض")}
              </Button>
            </div>
            {report.error && <ErrorAlert error={report.error} />}
            {report.data && (
              <>
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="light">
                    {translate(`Sales: ${report.data.summary.sales}`, `مبيعات: ${report.data.summary.sales}`)}
                  </Badge>
                  <Badge variant="light">
                    {translate(`Purchases: ${report.data.summary.purchase}`, `مشتريات: ${report.data.summary.purchase}`)}
                  </Badge>
                  <Badge variant="light" color={report.data.summary.withoutReason ? "orange" : "teal"}>
                    {translate(
                      `Without a reason: ${report.data.summary.withoutReason}`,
                      `بدون سبب: ${report.data.summary.withoutReason}`,
                    )}
                  </Badge>
                </div>
                {report.data.rows.length ? (
                  <div className="overflow-x-auto">
                    <Table striped miw={760}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{translate("Type", "النوع")}</Table.Th>
                          <Table.Th>{translate("Number", "الرقم")}</Table.Th>
                          <Table.Th>{translate("Date", "التاريخ")}</Table.Th>
                          <Table.Th>{translate("Customer / vendor", "العميل / المورد")}</Table.Th>
                          <Table.Th>{translate("Project", "المشروع")}</Table.Th>
                          <Table.Th className="text-right">{translate("Amount", "المبلغ")}</Table.Th>
                          <Table.Th>{translate("Reason", "السبب")}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {report.data.rows.map((r) => (
                          <Table.Tr key={`${r.type}-${r._id}`}>
                            <Table.Td>
                              {r.type === "sales"
                                ? translate("Sales invoice", "فاتورة بيع")
                                : translate("Purchase invoice", "فاتورة شراء")}
                            </Table.Td>
                            <Table.Td>
                              <Link
                                className="text-blue-600 hover:underline"
                                to={`/${paths.admin}/${paths.home}/${r.type === "sales" ? paths.salesOrders : paths.purchaseOrders}/${r._id}`}
                              >
                                {r.code || "-"}
                              </Link>
                            </Table.Td>
                            <Table.Td className="whitespace-nowrap">{r.date ? r.date.slice(0, 10) : "-"}</Table.Td>
                            <Table.Td>{r.party || "-"}</Table.Td>
                            <Table.Td>{r.project || "-"}</Table.Td>
                            <Table.Td className="text-right tabular-nums">{r.amount.toLocaleString()}</Table.Td>
                            <Table.Td>
                              {r.reason || (
                                <span className="text-orange-600">{translate("No reason recorded", "لا يوجد سبب")}</span>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    {translate("No 0% VAT invoices in this period.", "لا توجد فواتير بضريبة 0% في هذه الفترة.")}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </AdminLayoutBox>
  );
}
