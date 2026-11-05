import { useEffect, useState } from "react";
import { Tabs, Select, NumberInput, TextInput, Button, Table } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import { toMonthOnly } from "@/utils/helpers/format-date";
import { formatAmount } from "@/utils/helpers/format-amount";
import { CRM_FORM_SEGMENTS, CRM_TARGET_SEGMENTS, CrmAdSpendRow, CrmTarget, CrmTargetSegment } from "@/types/crm";
import { segmentLabel } from "@/pages/crm/_shared/lead-display";
import Modal from "@/components/ui/modal";

// MD-only Targets Management + Advertising Spend Management (Change Request 1, Feature 5: two
// screens, kept as tabs of one modal - this IS the dedicated entry point Dashboard links to, not a
// generic dialog, and "don't redesign the entire CRM" argues against splitting it into two whole
// new pages for what is a small, infrequent data-entry task). Real, MD-entered numbers only
// (acceptance report section 4: "no hardcoded dashboard figures") - this is the ONLY place these
// numbers come from; the Dashboard/Performance report endpoints only ever read them back.
export default function TargetsModal({ opened, close, onSaved }: { opened: boolean; close: () => void; onSaved: () => void }) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const segLabel = segmentLabel(translate);

  const segmentOptions = CRM_TARGET_SEGMENTS.map(s => ({ value: s, label: s === "all" ? translate("All segments", "كل القطاعات") : segLabel(s) }));
  const spendSegmentOptions = CRM_FORM_SEGMENTS.map(s => ({ value: s, label: segLabel(s) }));

  const [month, setMonth] = useState<Date | null>(new Date());
  const [segment, setSegment] = useState<CrmTargetSegment | "">("");
  const [enquiries, setEnquiries] = useState<number | "">("");
  const [qualified, setQualified] = useState<number | "">("");
  const [surveys, setSurveys] = useState<number | "">("");
  const [proposals, setProposals] = useState<number | "">("");
  const [signed, setSigned] = useState<number | "">("");
  const [valueEgp, setValueEgp] = useState<number | "">("");
  const [savingTarget, setSavingTarget] = useState(false);
  const [existingTargets, setExistingTargets] = useState<CrmTarget[]>([]);

  const [spendChannel, setSpendChannel] = useState("");
  const [spendSegment, setSpendSegment] = useState<string>("");
  const [spendMonth, setSpendMonth] = useState<Date | null>(new Date());
  const [spendAmount, setSpendAmount] = useState<number | "">("");
  const [savingSpend, setSavingSpend] = useState(false);
  const [existingSpend, setExistingSpend] = useState<CrmAdSpendRow[]>([]);

  async function loadTargets(forMonth: Date | null) {
    if (!forMonth) return;
    const [year, m] = toMonthOnly(forMonth).split("-").map(Number);
    try {
      const res = await privateRequest({ url: "crm/targets", params: { year, month: m }, language });
      setExistingTargets(res.data as CrmTarget[]);
    } catch {
      // view-only list - a failed refresh never blocks data entry
    }
  }

  async function loadSpend(forMonth: Date | null) {
    if (!forMonth) return;
    const [year, m] = toMonthOnly(forMonth).split("-").map(Number);
    try {
      const res = await privateRequest({ url: "crm/ad-spend", params: { year, month: m }, language });
      setExistingSpend(res.data as CrmAdSpendRow[]);
    } catch {
      // view-only list - a failed refresh never blocks data entry
    }
  }

  useEffect(() => {
    if (opened) loadTargets(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, month]);

  useEffect(() => {
    if (opened) loadSpend(spendMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, spendMonth]);

  async function saveTarget() {
    if (!month || !segment) {
      notifyError({ language, message: translate("Pick a month and a segment.", "اختر شهراً وقطاعاً.") });
      return;
    }
    const [year, m] = toMonthOnly(month).split("-").map(Number);
    setSavingTarget(true);
    try {
      await privateRequest({
        url: "crm/targets",
        method: "PUT",
        data: {
          segment,
          year,
          month: m,
          targetEnquiries: enquiries === "" ? null : enquiries,
          targetQualified: qualified === "" ? null : qualified,
          targetSurveys: surveys === "" ? null : surveys,
          targetProposals: proposals === "" ? null : proposals,
          targetSigned: signed === "" ? null : signed,
          targetValueEgp: valueEgp === "" ? null : valueEgp,
        },
        language,
      });
      notifySuccess({ language, message: translate("Target saved.", "تم حفظ الهدف.") });
      loadTargets(month);
      onSaved();
    } catch (err) {
      notifyError({ language, message: (err as { message?: string })?.message || translate("Could not save the target.", "تعذر حفظ الهدف.") });
    } finally {
      setSavingTarget(false);
    }
  }

  async function saveSpend() {
    if (!spendMonth || !spendChannel.trim() || spendAmount === "") {
      notifyError({ language, message: translate("Enter a channel name, month and amount.", "أدخل اسم القناة والشهر والمبلغ.") });
      return;
    }
    const [year, m] = toMonthOnly(spendMonth).split("-").map(Number);
    setSavingSpend(true);
    try {
      await privateRequest({
        url: "crm/ad-spend",
        method: "PUT",
        data: { channel: spendChannel.trim(), segment: spendSegment || null, year, month: m, amountEgp: spendAmount },
        language,
      });
      notifySuccess({ language, message: translate("Spend saved.", "تم حفظ الإنفاق.") });
      setSpendChannel("");
      setSpendSegment("");
      setSpendAmount("");
      loadSpend(spendMonth);
      onSaved();
    } catch (err) {
      notifyError({ language, message: (err as { message?: string })?.message || translate("Could not save the spend.", "تعذر حفظ الإنفاق.") });
    } finally {
      setSavingSpend(false);
    }
  }

  const spendTotal = existingSpend.reduce((sum, s) => sum + s.amountEgp, 0);

  return (
    <Modal opened={opened} onClose={close} title={translate("Targets & Advertising Spend", "الأهداف والإنفاق الإعلاني")} size="lg">
      <Tabs defaultValue="targets">
        <Tabs.List>
          <Tabs.Tab value="targets">{translate("Targets", "الأهداف")}</Tabs.Tab>
          <Tabs.Tab value="spend">{translate("Advertising Spend", "الإنفاق الإعلاني")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="targets" pt="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <MonthPickerInput label={translate("Month", "الشهر")} value={month} onChange={setMonth} />
              <Select
                label={translate("Segment", "القطاع")}
                data={segmentOptions}
                value={segment || null}
                onChange={v => setSegment((v as CrmTargetSegment) || "")}
                placeholder={translate("All segments, or one specific segment", "كل القطاعات، أو قطاع محدد")}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label={translate("Enquiries", "الاستفسارات")} value={enquiries} onChange={v => setEnquiries(v as number | "")} min={0} />
              <NumberInput label={translate("Qualified", "مؤهل")} value={qualified} onChange={v => setQualified(v as number | "")} min={0} />
              <NumberInput label={translate("Surveys", "المعاينات")} value={surveys} onChange={v => setSurveys(v as number | "")} min={0} />
              <NumberInput label={translate("Proposals", "العروض")} value={proposals} onChange={v => setProposals(v as number | "")} min={0} />
              <NumberInput label={translate("Signed", "موقّع")} value={signed} onChange={v => setSigned(v as number | "")} min={0} />
              <NumberInput label={translate("Value target (EGP)", "هدف القيمة (جنيه)")} value={valueEgp} onChange={v => setValueEgp(v as number | "")} min={0} />
            </div>
            <Button onClick={saveTarget} loading={savingTarget} color="teal" className="self-end">
              {translate("Save Target", "حفظ الهدف")}
            </Button>

            {existingTargets.length > 0 && (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {translate("Targets already set for this month", "الأهداف المحددة لهذا الشهر")}
                </h4>
                <Table verticalSpacing={2} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{translate("Segment", "القطاع")}</Table.Th>
                      <Table.Th className="text-right">{translate("Enq.", "استف.")}</Table.Th>
                      <Table.Th className="text-right">{translate("Qual.", "مؤهل")}</Table.Th>
                      <Table.Th className="text-right">{translate("Surv.", "معاينة")}</Table.Th>
                      <Table.Th className="text-right">{translate("Prop.", "عرض")}</Table.Th>
                      <Table.Th className="text-right">{translate("Signed", "موقّع")}</Table.Th>
                      <Table.Th className="text-right">{translate("Value", "القيمة")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {existingTargets.map(t => (
                      <Table.Tr key={t._id}>
                        <Table.Td>{t.segment === "all" ? translate("All segments", "كل القطاعات") : segLabel(t.segment)}</Table.Td>
                        <Table.Td className="text-right">{t.targetEnquiries ?? "-"}</Table.Td>
                        <Table.Td className="text-right">{t.targetQualified ?? "-"}</Table.Td>
                        <Table.Td className="text-right">{t.targetSurveys ?? "-"}</Table.Td>
                        <Table.Td className="text-right">{t.targetProposals ?? "-"}</Table.Td>
                        <Table.Td className="text-right">{t.targetSigned ?? "-"}</Table.Td>
                        <Table.Td className="text-right">{t.targetValueEgp != null ? formatAmount(t.targetValueEgp, "EGP") : "-"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="spend" pt="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <TextInput
                label={translate("Channel / budget line", "القناة / بند الموازنة")}
                placeholder={translate('e.g. "Farms", "Villas", "SEO"', 'مثال: "مزارع"، "فيلات"، "SEO"')}
                value={spendChannel}
                onChange={e => setSpendChannel(e.target.value)}
              />
              <Select
                label={translate("Segment (optional)", "القطاع (اختياري)")}
                data={spendSegmentOptions}
                value={spendSegment || null}
                onChange={v => setSpendSegment(v || "")}
                placeholder={translate("Leave blank for SEO/agency fees etc.", "اتركه فارغاً لـ SEO/أتعاب الوكالة إلخ.")}
                clearable
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MonthPickerInput label={translate("Month", "الشهر")} value={spendMonth} onChange={setSpendMonth} />
              <NumberInput label={translate("Amount (EGP)", "المبلغ (جنيه)")} value={spendAmount} onChange={v => setSpendAmount(v as number | "")} min={0} />
            </div>
            <Button onClick={saveSpend} loading={savingSpend} color="teal" className="self-end">
              {translate("Save Spend", "حفظ الإنفاق")}
            </Button>

            {existingSpend.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {translate("Spend already entered for this month", "الإنفاق المُدخل لهذا الشهر")}
                  </h4>
                  <span className="text-xs font-semibold text-gray-600">
                    {translate("Total", "الإجمالي")}: {formatAmount(spendTotal, "EGP")}
                  </span>
                </div>
                <Table verticalSpacing={2} fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{translate("Channel", "القناة")}</Table.Th>
                      <Table.Th>{translate("Segment", "القطاع")}</Table.Th>
                      <Table.Th className="text-right">{translate("Amount", "المبلغ")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {existingSpend.map(s => (
                      <Table.Tr key={s._id}>
                        <Table.Td>{s.channel}</Table.Td>
                        <Table.Td className="text-gray-500">{s.segment ? segLabel(s.segment) : "-"}</Table.Td>
                        <Table.Td className="text-right">{formatAmount(s.amountEgp, "EGP")}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            )}
          </div>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
