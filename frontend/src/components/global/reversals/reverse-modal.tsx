import { useEffect, useState } from "react";
import { Alert, Button, Textarea } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { AccountingReversal } from "@/types/reversal";

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/**
 * Confirms reversing a payment or a settlement: explains what will happen, requires a reason, and
 * posts to the reversal engine with a request key unique to this dialog (a double click or retry is
 * never reversed twice).
 */
export default function ReverseModal({
  opened,
  close,
  title,
  explanation,
  url,
  body = {},
  onDone,
}: {
  opened: boolean;
  close: () => void;
  title: string;
  explanation: React.ReactNode;
  url: string;
  body?: Record<string, unknown>;
  onDone: (reversal: AccountingReversal) => void;
}) {
  const { translate, language } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!opened) return;
    setReason("");
    setKey(newKey());
    setError("");
  }, [opened]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || loading) return;
    handleRequest(language, setLoading, setError, async () => {
      const res = await privateRequest({
        url,
        method: "POST",
        data: { ...body, reason: reason.trim(), idempotencyKey: key },
        language,
      });
      onDone(res.data);
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={() => !loading && close()} title={title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Alert color="orange" variant="light">
          <span className="text-sm">{explanation}</span>
        </Alert>
        <Textarea
          label={translate("Reason", "السبب")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          autosize
          minRows={2}
          maxLength={1000}
          data-autofocus
        />
        {error && <ErrorAlert error={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={close} disabled={loading}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button type="submit" color="orange" loading={loading} disabled={!reason.trim()}>
            {translate("Reverse", "عكس")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
