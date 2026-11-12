import { useEffect, useState } from "react";
import { Alert, Button, NumberInput, Select, Table, Textarea } from "@mantine/core";
import errorMessage from "@/utils/helpers/error-message";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import SectionCard from "@/components/ui/section-card";
import { DealEngineSettings } from "@/types/commercial";
import PctInput, { toPct } from "../_shared/PctInput";

// The eight Rates matrix regions (backend utils/commercial/regions.js EGYPT_REGIONS).
const REGIONS = [
  "Cairo - 10th of Ramadan",
  "Sharqia - Ismailia",
  "Banha - Tanta - Menoufia",
  "Damanhour - Kafr El Sheikh - Mansoura",
  "Fayoum - Beni Suef",
  "Minya - Sohag - Assiut",
  "Qena - Luxor - Aswan",
  "Kharga - Dakhla - Farafra Oases",
];

type Num = number | "";

/**
 * Deal Engine Changes Required (12 Nov 2026) - the engine rules that are configuration, not code:
 * C1 MC4 rule and price, C2 accessories rate (the two MD decisions, defaulting to today's
 * behaviour), C3 DC/AC target, C4 yield per region, the NPV discount rate, C7 inverter replacement
 * year and C9 the two-phase tariff path. Saved through the same versioned, audited configuration;
 * new revisions use it and record the settings they were calculated with.
 */
export default function EngineSettingsCard({ engine, canManage, onSaved }: { engine: DealEngineSettings; canManage: boolean; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [mc4Rule, setMc4Rule] = useState(engine.mc4.rule);
  const [mc4Price, setMc4Price] = useState<Num>(engine.mc4.unitPriceEgp);
  const [accessories, setAccessories] = useState<Num>(engine.accessoriesRateEgpPerKwp ?? "");
  const [yieldDefault, setYieldDefault] = useState<Num>(engine.yield.defaultKwhPerKwp);
  const [byRegion, setByRegion] = useState<Record<string, Num>>(() => Object.fromEntries(REGIONS.map((r) => [r, engine.yield.byRegion?.[r] ?? ""])));
  const [discountRate, setDiscountRate] = useState(toPct(engine.discountRate));
  const [replacementYear, setReplacementYear] = useState<Num>(engine.inverterReplacementYear);
  const [tpFirst, setTpFirst] = useState(toPct(engine.twoPhaseEscalation.first));
  const [tpYears, setTpYears] = useState<Num>(engine.twoPhaseEscalation.years);
  const [tpThen, setTpThen] = useState(toPct(engine.twoPhaseEscalation.then));
  const [dcMin, setDcMin] = useState<Num>(engine.dcAcRatio.min);
  const [dcMax, setDcMax] = useState<Num>(engine.dcAcRatio.max);
  const [flagBelow, setFlagBelow] = useState<Num>(engine.dcAcRatio.flagBelow);
  const [flagAbove, setFlagAbove] = useState<Num>(engine.dcAcRatio.flagAbove);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setMessage(null), [engine]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await privateRequest({
        url: "commercial/pricing-config",
        method: "PUT",
        language,
        data: {
          note: note || "Deal Engine settings",
          engine: {
            mc4: { rule: mc4Rule, unitPriceEgp: mc4Price === "" ? 0 : mc4Price },
            accessoriesRateEgpPerKwp: accessories === "" ? null : accessories,
            yield: { defaultKwhPerKwp: yieldDefault, byRegion: Object.fromEntries(Object.entries(byRegion).map(([r, v]) => [r, v === "" ? null : v])) },
            discountRate: discountRate / 100,
            inverterReplacementYear: replacementYear,
            twoPhaseEscalation: { first: tpFirst / 100, years: tpYears, then: tpThen / 100 },
            dcAcRatio: { min: dcMin, max: dcMax, flagBelow, flagAbove },
          },
        },
      });
      setNote("");
      setMessage({ ok: true, text: translate("Saved. New revisions use these settings.", "تم الحفظ. النسخ الجديدة تستخدم هذه الإعدادات.") });
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  const dis = !canManage;
  return (
    <SectionCard title={translate("Deal Engine settings", "إعدادات محرك الصفقات")}>
      <div className="flex flex-col gap-4" data-testid="engine-settings">
        <Alert color="yellow" variant="light" p="xs">
          {translate(
            "MC4 connectors and the accessories rate are pending the MD's decision (C1, C2) - they keep today's values until changed here.",
            "موصلات MC4 ومعدل الملحقات بانتظار قرار المدير العام (C1, C2) - تبقى على القيم الحالية حتى تُغيّر هنا.",
          )}
        </Alert>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label={translate("MC4 connector rule (C1)", "قاعدة موصلات MC4")}
            data={[
              { value: "strings", label: translate("strings x 2 + 4 pieces (R74 master)", "السلاسل × 2 + 4 قطع") },
              { value: "modulePairs", label: translate("ceil(modules / 2) pairs (Rev03)", "نصف عدد الألواح (أزواج)") },
            ]}
            value={mc4Rule}
            onChange={(v) => setMc4Rule((v as "strings" | "modulePairs") || "strings")}
            allowDeselect={false}
            disabled={dis}
          />
          <NumberInput label={translate("MC4 unit price (EGP)", "سعر وحدة MC4")} value={mc4Price} onChange={(v) => setMc4Price(v === "" ? "" : Number(v))} min={0} disabled={dis} />
          <NumberInput
            label={translate("Accessories (EGP per design kWp, C2)", "الملحقات (جنيه لكل كيلوواط)")}
            description={translate("Blank = Rates matrix value (85).", "فارغ = قيمة مصفوفة الأسعار (85).")}
            value={accessories}
            onChange={(v) => setAccessories(v === "" ? "" : Number(v))}
            min={0}
            disabled={dis}
          />
          <NumberInput label={translate("DC/AC target - min (C3)", "نسبة DC/AC - الأدنى")} value={dcMin} onChange={(v) => setDcMin(v === "" ? "" : Number(v))} step={0.05} decimalScale={2} disabled={dis} />
          <NumberInput label={translate("DC/AC target - max", "نسبة DC/AC - الأعلى")} value={dcMax} onChange={(v) => setDcMax(v === "" ? "" : Number(v))} step={0.05} decimalScale={2} disabled={dis} />
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label={translate("Flag below", "تنبيه أقل من")} value={flagBelow} onChange={(v) => setFlagBelow(v === "" ? "" : Number(v))} step={0.05} decimalScale={2} disabled={dis} />
            <NumberInput label={translate("Flag above", "تنبيه أعلى من")} value={flagAbove} onChange={(v) => setFlagAbove(v === "" ? "" : Number(v))} step={0.05} decimalScale={2} disabled={dis} />
          </div>
          <PctInput label={translate("NPV discount rate", "معدل الخصم")} value={discountRate} onChange={setDiscountRate} disabled={dis} />
          <NumberInput label={translate("Inverter replacement year (C7)", "سنة استبدال العاكس")} value={replacementYear} onChange={(v) => setReplacementYear(v === "" ? "" : Number(v))} min={1} max={25} disabled={dis} />
          <div className="grid grid-cols-3 gap-2">
            <PctInput label={translate("Phase 1 (C9)", "المرحلة 1")} value={tpFirst} onChange={setTpFirst} disabled={dis} />
            <NumberInput label={translate("years", "سنوات")} value={tpYears} onChange={(v) => setTpYears(v === "" ? "" : Number(v))} min={1} max={24} disabled={dis} />
            <PctInput label={translate("then", "ثم")} value={tpThen} onChange={setTpThen} disabled={dis} />
          </div>
        </div>

        <div>
          <h4 className="mb-1 text-sm font-semibold">{translate("Specific yield by region (C4), kWh/kWp/yr", "الإنتاجية النوعية حسب المنطقة")}</h4>
          <p className="mb-2 text-xs text-gray-500">
            {translate(
              "A region without its own value uses the default. A revision can still override it with a site value and its source.",
              "المنطقة بدون قيمة خاصة تستخدم القيمة الافتراضية. ويمكن لكل نسخة استخدام قيمة خاصة بالموقع مع ذكر مصدرها.",
            )}
          </p>
          <div className="overflow-x-auto">
            <Table verticalSpacing={4} fz="sm" miw={420}>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Td className="font-medium">{translate("Default (any region)", "الافتراضي (أي منطقة)")}</Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" value={yieldDefault} onChange={(v) => setYieldDefault(v === "" ? "" : Number(v))} min={800} max={2600} disabled={dis} />
                  </Table.Td>
                </Table.Tr>
                {REGIONS.map((r) => (
                  <Table.Tr key={r}>
                    <Table.Td>{r}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        placeholder={String(yieldDefault || "")}
                        value={byRegion[r]}
                        onChange={(v) => setByRegion((p) => ({ ...p, [r]: v === "" ? "" : Number(v) }))}
                        min={800}
                        max={2600}
                        disabled={dis}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </div>

        {canManage && (
          <>
            <Textarea label={translate("Reason for the change (kept in the audit log)", "سبب التغيير (يُحفظ في السجل)")} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            <Button color="teal" loading={saving} onClick={save} className="self-start" data-testid="engine-settings-save">
              {translate("Save Deal Engine settings", "حفظ إعدادات محرك الصفقات")}
            </Button>
          </>
        )}
        {message && <p className={`text-sm ${message.ok ? "text-teal-700" : "text-red-600"}`}>{message.text}</p>}
      </div>
    </SectionCard>
  );
}
