import { useEffect, useState } from "react";
import { Alert, Badge, Button, NumberInput, Table, TextInput } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import errorMessage from "@/utils/helpers/error-message";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import SectionCard from "@/components/ui/section-card";
import { DataTableContainer, dataTableHeadClassName } from "@/components/ui/data-table";

// Deal Engine - the installation / transport Rates Matrix (per region and size band), the data the
// Engineering "Calculate & Create Revision" needs for every Egyptian project. Before this card the
// matrix could only be created by a server script, so a database where the script never ran answered
// "No Rates Matrix configured for country Egypt" with no way to fix it in the app. Read by every
// Deal Engine user; saved by Pricing Config managers as a NEW dated version (earlier versions and
// every revision keep their numbers). Backend: services/commercial/ratesMatrix.js.

type Num = number | "";
type Row = { region: string; install: Num[]; transport: Num[] };
type Version = {
  _id: string;
  effectiveDate: string;
  createdAt: string;
  source: "seed" | "reference" | "manual";
  note: string;
  regions: { region: string; install: number[]; transport: number[] }[];
  mountingStructureRatesEgpPerKwp: Record<string, number | null>;
  earthingRateEgpPerKwp: number | null;
  accessoriesRateEgpPerKwp: number | null;
  dcCableRouteMPerKwp: number | null;
  acCableDeratingFactor: number | null;
};
type View = {
  country: string;
  bands: string[];
  requiredRegions: string[];
  mountingTypes: string[];
  active: Version | null;
  scheduled: Version[];
  history: { _id: string; effectiveDate: string; createdAt: string; createdBy: string | null; source: string; note: string; active: boolean }[];
  referenceAvailable: boolean;
  canManage: boolean;
};

const SOURCE: Record<string, [string, string]> = { seed: ["Seed script", "سكربت التهيئة"], reference: ["Reference (On_Grid.xlsx)", "مرجعي (On_Grid.xlsx)"], manual: ["Entered here", "أُدخلت هنا"] };
const day = (d?: string) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default function RatesMatrixCard({ country = "Egypt" }: { country?: string }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [mounting, setMounting] = useState<Record<string, Num>>({});
  const [earthing, setEarthing] = useState<Num>("");
  const [accessories, setAccessories] = useState<Num>("");
  const [dcRoute, setDcRoute] = useState<Num>("");
  const [derating, setDerating] = useState<Num>(0.8);
  const [effective, setEffective] = useState<Date | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function fill(v: View) {
    const a = v.active || v.scheduled[0] || null;
    const byRegion = Object.fromEntries((a?.regions || []).map((r) => [r.region, r]));
    // Every required region gets a row; a region with no stored rates starts blank (never zero).
    setRows(v.requiredRegions.map((region) => ({ region, install: byRegion[region]?.install ?? ["", "", "", "", ""], transport: byRegion[region]?.transport ?? ["", "", "", "", ""] })));
    setMounting(Object.fromEntries(v.mountingTypes.map((k) => [k, a?.mountingStructureRatesEgpPerKwp?.[k] ?? ""])));
    setEarthing(a?.earthingRateEgpPerKwp ?? "");
    setAccessories(a?.accessoriesRateEgpPerKwp ?? "");
    setDcRoute(a?.dcCableRouteMPerKwp ?? "");
    setDerating(a?.acCableDeratingFactor ?? 0.8);
  }

  async function load() {
    try {
      const res = await privateRequest({ url: "commercial/pricing-config/rates-matrix", params: { country }, language });
      setView(res.data as View);
      fill(res.data as View);
      setLoadError("");
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      setNote("");
      setEffective(null);
      await load();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const loadReference = () =>
    run(
      () => privateRequest({ url: "commercial/pricing-config/rates-matrix/reference", method: "POST", data: { country }, language }),
      translate("Reference Rates Matrix loaded. Engineering calculations for Egypt can now run.", "تم تحميل مصفوفة الأسعار المرجعية. يمكن الآن تشغيل حسابات الهندسة لمصر."),
    );

  const save = () =>
    run(
      () =>
        privateRequest({
          url: "commercial/pricing-config/rates-matrix",
          method: "POST",
          language,
          data: {
            country,
            regions: rows,
            mountingStructureRatesEgpPerKwp: mounting,
            earthingRateEgpPerKwp: earthing,
            accessoriesRateEgpPerKwp: accessories,
            dcCableRouteMPerKwp: dcRoute,
            acCableDeratingFactor: derating,
            effectiveDate: effective ? effective.toISOString() : undefined,
            note,
          },
        }),
      translate("Saved as a new version. New calculations use it from its effective date; existing revisions keep their numbers.", "تم الحفظ كنسخة جديدة. الحسابات الجديدة تستخدمها من تاريخ سريانها؛ والنسخ الحالية تحتفظ بأرقامها."),
    );

  if (loadError) return <SectionCard title={translate("Rates Matrix", "مصفوفة الأسعار")}><Alert color="red" variant="light">{loadError}</Alert></SectionCard>;
  if (!view) return null;
  const dis = !view.canManage || busy;
  const setCell = (i: number, k: "install" | "transport", b: number, v: Num) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: r[k].map((x, n) => (n === b ? v : x)) } : r)));

  return (
    <SectionCard title={`${translate("Rates Matrix", "مصفوفة الأسعار")} - ${view.country}`}>
      <div className="flex flex-col gap-4" data-testid="rates-matrix">
        {view.active ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary" data-testid="rates-matrix-status">
            <Badge color="green" variant="light">{translate("Configured", "مُعدّة")}</Badge>
            {translate("In force since", "سارية منذ")} {day(view.active.effectiveDate)} · {translate(...SOURCE[view.active.source])}
            {view.active.note ? ` · ${view.active.note}` : ""}
          </div>
        ) : (
          <Alert color="red" variant="light" data-testid="rates-matrix-missing">
            {translate(
              `No Rates Matrix is configured for ${view.country}. Engineering calculations ("Calculate & Create Revision") for ${view.country} projects stop until it is loaded or entered below.`,
              `لا توجد مصفوفة أسعار لـ ${view.country}. تتوقف حسابات الهندسة لمشاريع ${view.country} حتى يتم تحميلها أو إدخالها أدناه.`,
            )}
          </Alert>
        )}
        {view.scheduled.length > 0 && (
          <Alert color="yellow" variant="light">
            {translate("Scheduled:", "مجدولة:")} {view.scheduled.map((s) => `${day(s.effectiveDate)}${s.note ? ` (${s.note})` : ""}`).join(", ")}
          </Alert>
        )}
        {!view.active && view.referenceAvailable && view.canManage && view.history.length === 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={loadReference} loading={busy} data-testid="rates-matrix-load-reference">
              {translate("Load the reference matrix (On_Grid.xlsx)", "تحميل المصفوفة المرجعية (On_Grid.xlsx)")}
            </Button>
            <span className="text-xs text-ink-muted">
              {translate("The rates table of the client's On_Grid.xlsx workbook - the same values the setup script uses. Review it below afterwards.", "جدول الأسعار من ملف On_Grid.xlsx الخاص بالعميل - نفس قيم سكربت التهيئة. راجعه أدناه بعد التحميل.")}
            </span>
          </div>
        )}
        {!view.canManage && (
          <p className="text-xs text-ink-muted">
            {translate("Read only. The Commercial MD, the Sales and Commercial Director or an ERP admin can change the rates.", "للقراءة فقط. يمكن للمدير العام التجاري أو المدير التجاري أو مسؤول النظام تغيير الأسعار.")}
          </p>
        )}

        {(["install", "transport"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold text-ink">
              {k === "install" ? translate("Installation (EGP per kWp)", "التركيب (جنيه لكل كيلووات)") : translate("Transport (EGP per project)", "النقل (جنيه لكل مشروع)")}
            </h4>
            <DataTableContainer>
              <Table className="min-w-[860px] text-sm" verticalSpacing="xs">
                <Table.Thead className={dataTableHeadClassName}>
                  <Table.Tr>
                    <Table.Th>{translate("Region", "المنطقة")}</Table.Th>
                    {view.bands.map((b) => (
                      <Table.Th key={b}>{b}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((r, i) => (
                    <Table.Tr key={r.region}>
                      <Table.Td className="whitespace-nowrap">{r.region}</Table.Td>
                      {r[k].map((v, b) => (
                        <Table.Td key={b}>
                          <NumberInput size="xs" min={0} hideControls value={v} onChange={(x) => setCell(i, k, b, x === "" ? "" : Number(x))} disabled={dis} aria-label={`${r.region} ${k} ${view.bands[b]}`} data-testid={`rm-${k}-${i}-${b}`} />
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </DataTableContainer>
          </div>
        ))}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {view.mountingTypes.map((t) => (
            <NumberInput key={t} label={`${translate("Mounting structure", "هيكل التثبيت")} - ${t} (EGP/kWp)`} min={0} hideControls value={mounting[t] ?? ""} onChange={(x) => setMounting((m) => ({ ...m, [t]: x === "" ? "" : Number(x) }))} disabled={dis} />
          ))}
          <NumberInput label={translate("Earthing (EGP/kWp)", "التأريض (جنيه/كيلووات)")} min={0} hideControls value={earthing} onChange={(x) => setEarthing(x === "" ? "" : Number(x))} disabled={dis} />
          <NumberInput label={translate("Accessories (EGP/kWp)", "الملحقات (جنيه/كيلووات)")} min={0} hideControls value={accessories} onChange={(x) => setAccessories(x === "" ? "" : Number(x))} disabled={dis} />
          <NumberInput label={translate("DC cable route (m/kWp)", "مسار كابل التيار المستمر (م/كيلووات)")} min={0.1} hideControls value={dcRoute} onChange={(x) => setDcRoute(x === "" ? "" : Number(x))} disabled={dis} />
          <NumberInput label={translate("AC cable derating factor", "معامل تخفيض كابل التيار المتردد")} min={0.1} max={1} step={0.05} decimalScale={2} value={derating} onChange={(x) => setDerating(x === "" ? "" : Number(x))} disabled={dis} />
        </div>

        {view.canManage && (
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
            <DateInput label={translate("Effective from (blank = now)", "يسري من (فارغ = الآن)")} value={effective} onChange={setEffective} clearable valueFormat="YYYY-MM-DD" disabled={busy} />
            <TextInput label={translate("Note", "ملاحظة")} value={note} onChange={(e) => setNote(e.currentTarget.value)} disabled={busy} />
            <Button onClick={save} loading={busy} data-testid="rates-matrix-save">
              {translate("Save as a new version", "حفظ كنسخة جديدة")}
            </Button>
          </div>
        )}
        {message && (
          <Alert color={message.ok ? "green" : "red"} variant="light" data-testid="rates-matrix-message">
            {message.text}
          </Alert>
        )}

        {view.history.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold text-ink">{translate("Versions", "النسخ")}</h4>
            {view.history.map((h) => (
              <div key={h._id} className="flex flex-wrap gap-2 text-xs text-ink-muted">
                <span className="tabular-nums">{day(h.effectiveDate)}</span>
                <span>{translate(...(SOURCE[h.source] || SOURCE.manual))}</span>
                {h.createdBy && <span>· {h.createdBy}</span>}
                {h.note && <span>· {h.note}</span>}
                {h.active && <Badge size="xs" color="green" variant="light">{translate("in force", "سارية")}</Badge>}
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
