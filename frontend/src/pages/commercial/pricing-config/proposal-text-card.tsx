import { useState } from "react";
import { Button, NumberInput, Textarea, TextInput } from "@mantine/core";
import errorMessage from "@/utils/helpers/error-message";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import SectionCard from "@/components/ui/section-card";

export type ProposalSettings = {
  validityDays: number;
  senderMailbox: string;
  inclusions: string;
  exclusions: string;
  priceNote: string;
  paymentTerms: { standard: string; small: string; smallDealMaxNetEgp: number | null };
  deliveryWarranty: string[];
  terms: string[];
};

const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * Deal Engine C13 / Spec Part 2 section 3.2 - the proposal's text blocks are configuration, not code:
 * validity, sending mailbox, inclusions and exclusions, payment terms (standard and small deals),
 * delivery and warranty, terms and conditions. Saved through the same versioned, audited
 * configuration; issued proposals keep the text they were issued with. Legal review before first
 * external use (A6) - the terms here are the sample's wording until then.
 */
export default function ProposalTextCard({ proposal, canManage, onSaved }: { proposal: ProposalSettings; canManage: boolean; onSaved: () => void }) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [validityDays, setValidityDays] = useState<number | "">(proposal.validityDays);
  const [mailbox, setMailbox] = useState(proposal.senderMailbox);
  const [inclusions, setInclusions] = useState(proposal.inclusions);
  const [exclusions, setExclusions] = useState(proposal.exclusions);
  const [priceNote, setPriceNote] = useState(proposal.priceNote);
  const [standard, setStandard] = useState(proposal.paymentTerms.standard);
  const [small, setSmall] = useState(proposal.paymentTerms.small);
  const [smallMax, setSmallMax] = useState<number | "">(proposal.paymentTerms.smallDealMaxNetEgp ?? "");
  const [delivery, setDelivery] = useState(proposal.deliveryWarranty.join("\n"));
  const [terms, setTerms] = useState(proposal.terms.join("\n"));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dis = !canManage;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await privateRequest({
        url: "commercial/pricing-config",
        method: "PUT",
        language,
        data: {
          note: note || "Proposal text blocks",
          proposal: {
            validityDays,
            senderMailbox: mailbox,
            inclusions,
            exclusions,
            priceNote,
            paymentTerms: { standard, small, smallDealMaxNetEgp: smallMax === "" ? null : smallMax },
            deliveryWarranty: lines(delivery),
            terms: lines(terms),
          },
        },
      });
      setNote("");
      setMessage({ ok: true, text: translate("Saved. The next proposal uses this text.", "تم الحفظ. العرض التالي يستخدم هذا النص.") });
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard title={translate("Proposal text", "نصوص العرض")}>
      <div className="flex flex-col gap-3" data-testid="proposal-text-settings">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberInput label={translate("Validity (days)", "مدة الصلاحية (أيام)")} value={validityDays} onChange={(v) => setValidityDays(v === "" ? "" : Number(v))} min={1} max={120} disabled={dis} />
          <TextInput label={translate("Sending mailbox (footer)", "البريد المرسل (التذييل)")} value={mailbox} onChange={(e) => setMailbox(e.target.value)} disabled={dis} />
        </div>
        <Textarea label={translate("Inclusions", "المشمول")} value={inclusions} onChange={(e) => setInclusions(e.target.value)} autosize minRows={2} disabled={dis} />
        <Textarea label={translate("Exclusions", "غير المشمول")} value={exclusions} onChange={(e) => setExclusions(e.target.value)} autosize minRows={2} disabled={dis} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Textarea label={translate("Payment terms - standard", "شروط الدفع - العادية")} value={standard} onChange={(e) => setStandard(e.target.value)} autosize minRows={2} disabled={dis} />
          <Textarea label={translate("Payment terms - small deals", "شروط الدفع - الصفقات الصغيرة")} value={small} onChange={(e) => setSmall(e.target.value)} autosize minRows={2} disabled={dis} />
        </div>
        <NumberInput
          label={translate("Small deal: net price up to (EGP)", "الصفقة الصغيرة: السعر الصافي حتى (جنيه)")}
          description={translate("Blank = every proposal uses the standard terms (the threshold is not set yet).", "فارغ = كل العروض تستخدم الشروط العادية (لم يُحدد الحد بعد).")}
          value={smallMax}
          onChange={(v) => setSmallMax(v === "" ? "" : Number(v))}
          min={0}
          thousandSeparator=","
          disabled={dis}
        />
        <Textarea label={translate("Price note", "ملاحظة السعر")} value={priceNote} onChange={(e) => setPriceNote(e.target.value)} autosize minRows={1} disabled={dis} />
        <Textarea label={translate("Delivery and warranty (one point per line)", "التسليم والضمان (نقطة في كل سطر)")} value={delivery} onChange={(e) => setDelivery(e.target.value)} autosize minRows={3} disabled={dis} />
        <Textarea
          label={translate("Terms and conditions (one clause per line)", "الشروط والأحكام (بند في كل سطر)")}
          description={translate("Legal review before first external use.", "مراجعة قانونية قبل أول استخدام خارجي.")}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          autosize
          minRows={4}
          disabled={dis}
        />
        {canManage && (
          <>
            <Textarea label={translate("Reason for the change (kept in the audit log)", "سبب التغيير (يُحفظ في السجل)")} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
            <Button color="teal" loading={saving} onClick={save} className="self-start" data-testid="proposal-text-save">
              {translate("Save proposal text", "حفظ نصوص العرض")}
            </Button>
          </>
        )}
        {message && <p className={`text-sm ${message.ok ? "text-teal-700" : "text-red-600"}`}>{message.text}</p>}
      </div>
    </SectionCard>
  );
}
