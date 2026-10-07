import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { Alert, Button, TextInput } from "@mantine/core";
import useDataHandler from "@/hooks/useDataHandler";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import { formatDate } from "@/utils/helpers/date-formaters";
import { JournalEntry } from "@/types/journal-entry";
import { outlineIcons } from "@/components/icons";

// The admin MUST explicitly choose the reversal date - it is never defaulted to today, the
// original entry's date, or the server clock (see docs/entities/accounting.md's "Reversal"
// section and backend/server/utils/validators/journalEntryValidators.js's
// reverseJournalEntryValidators, which rejects a request missing it before this ever reaches the
// controller).
export default function ReverseJournalEntryModal({
  opened,
  close,
  entry,
  onReversed,
}: {
  opened: boolean;
  close: () => void;
  entry: JournalEntry;
  onReversed: (reversal: JournalEntry) => void;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();

  const [reversalDate, setReversalDate] = useState("");
  const [reference, setReference] = useState("");
  const { loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        language,
        method: "POST",
        url: `journal-entries/${entry._id}/reverse`,
        data: { reversalDate, reference: reference || undefined },
      });

      onReversed(res.data);
      handleClose();
    });
  }

  function handleClose() {
    close();
    setTimeout(() => {
      setReversalDate("");
      setReference("");
      setError("");
    }, 250);
  }

  return (
    <Modal opened={opened} onClose={handleClose} title={translate("Reverse Journal Entry", "عكس القيد اليومي")} size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorAlert error={error} />}

        <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
          <div>
            <p className="text-xs text-gray-500">{translate("Original Entry #", "رقم القيد الأصلي")}</p>
            <p className="font-semibold">{entry.entryNumber}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{translate("Original Date", "التاريخ الأصلي")}</p>
            <p className="font-semibold">{formatDate(entry.date, language)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{translate("Original Total", "الإجمالي الأصلي")}</p>
            <p className="font-semibold">{entry.totalDebit.toLocaleString()}</p>
          </div>
        </div>

        <Alert color="blue" variant="light" icon={<outlineIcons.ExclamationCircle />}>
          {translate(
            "Reversing this entry will create a new Journal Entry on the selected reversal date. The original entry will remain unchanged.",
            "سيؤدي عكس هذا القيد إلى إنشاء قيد يومية جديد بتاريخ العكس المحدد. سيبقى القيد الأصلي دون تغيير.",
          )}
        </Alert>

        <TextInput
          type="date"
          label={translate("Reversal Date", "تاريخ العكس")}
          description={translate("Required - choose the date this reversal should be posted on.", "مطلوب - اختر التاريخ الذي سيتم ترحيل هذا العكس فيه.")}
          value={reversalDate}
          onChange={(e) => setReversalDate(e.target.value)}
          required
        />

        <TextInput
          label={translate("Reference (optional)", "المرجع (اختياري)")}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />

        <Button type="submit" color="red" loading={loading} disabled={!reversalDate} mt="md">
          {translate("Confirm Reversal", "تأكيد العكس")}
        </Button>
      </form>
    </Modal>
  );
}
