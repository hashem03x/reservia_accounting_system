import { useState } from "react";
import { Tabs, Select, NumberInput, Button } from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError, notifySuccess } from "@/utils/helpers/notifiers";
import { toMonthOnly } from "@/utils/helpers/format-date";
import { CRM_SOURCES } from "@/types/crm";
import Modal from "@/components/ui/modal";

// MD-only entry for real sales targets and monthly ad spend (acceptance report section 4: "no
// hardcoded dashboard figures... real, MD-entered targets only"). This is the ONLY place these
// numbers come from - the Dashboard/Performance report endpoints only ever read them back.
export default function TargetsModal({
  opened,
  close,
  team,
  onSaved,
}: {
  opened: boolean;
  close: () => void;
  team: { value: string; label: string }[];
  onSaved: () => void;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [month, setMonth] = useState<Date | null>(new Date());
  const [owner, setOwner] = useState<string>("");
  const [enquiries, setEnquiries] = useState<number | "">("");
  const [qualified, setQualified] = useState<number | "">("");
  const [surveys, setSurveys] = useState<number | "">("");
  const [proposals, setProposals] = useState<number | "">("");
  const [signed, setSigned] = useState<number | "">("");
  const [valueEgp, setValueEgp] = useState<number | "">("");
  const [savingTarget, setSavingTarget] = useState(false);

  const [spendSource, setSpendSource] = useState<string>("");
  const [spendMonth, setSpendMonth] = useState<Date | null>(new Date());
  const [spendAmount, setSpendAmount] = useState<number | "">("");
  const [savingSpend, setSavingSpend] = useState(false);

  async function saveTarget() {
    if (!month || !owner) {
      notifyError({ language, message: translate("Pick a month and an owner.", "اختر شهراً ومسؤولاً.") });
      return;
    }
    const [year, m] = toMonthOnly(month).split("-").map(Number);
    setSavingTarget(true);
    try {
      await privateRequest({
        url: "crm/targets",
        method: "PUT",
        data: {
          owner,
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
      onSaved();
    } catch (err) {
      notifyError({ language, message: (err as { message?: string })?.message || translate("Could not save the target.", "تعذر حفظ الهدف.") });
    } finally {
      setSavingTarget(false);
    }
  }

  async function saveSpend() {
    if (!spendMonth || !spendSource || spendAmount === "") {
      notifyError({ language, message: translate("Pick a source, month and amount.", "اختر مصدراً وشهراً ومبلغاً.") });
      return;
    }
    const [year, m] = toMonthOnly(spendMonth).split("-").map(Number);
    setSavingSpend(true);
    try {
      await privateRequest({ url: "crm/ad-spend", method: "PUT", data: { source: spendSource, year, month: m, amountEgp: spendAmount }, language });
      notifySuccess({ language, message: translate("Spend saved.", "تم حفظ الإنفاق.") });
      onSaved();
    } catch (err) {
      notifyError({ language, message: (err as { message?: string })?.message || translate("Could not save the spend.", "تعذر حفظ الإنفاق.") });
    } finally {
      setSavingSpend(false);
    }
  }

  return (
    <Modal opened={opened} onClose={close} title={translate("Targets & Ad Spend", "الأهداف والإنفاق الإعلاني")} size="lg">
      <Tabs defaultValue="targets">
        <Tabs.List>
          <Tabs.Tab value="targets">{translate("Targets", "الأهداف")}</Tabs.Tab>
          <Tabs.Tab value="spend">{translate("Monthly Ad Spend", "الإنفاق الإعلاني الشهري")}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="targets" pt="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <MonthPickerInput label={translate("Month", "الشهر")} value={month} onChange={setMonth} />
              <Select label={translate("Owner", "المسؤول")} data={team} value={owner || null} onChange={v => setOwner(v || "")} searchable />
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
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="spend" pt="md">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <Select label={translate("Source", "المصدر")} data={[...CRM_SOURCES]} value={spendSource || null} onChange={v => setSpendSource(v || "")} />
              <MonthPickerInput label={translate("Month", "الشهر")} value={spendMonth} onChange={setSpendMonth} />
              <NumberInput label={translate("Amount (EGP)", "المبلغ (جنيه)")} value={spendAmount} onChange={v => setSpendAmount(v as number | "")} min={0} />
            </div>
            <Button onClick={saveSpend} loading={savingSpend} color="teal" className="self-end">
              {translate("Save Spend", "حفظ الإنفاق")}
            </Button>
          </div>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
