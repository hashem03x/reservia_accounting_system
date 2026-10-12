import { useEffect, useState } from "react";
import { Alert, Button, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

/**
 * A confirmation for an operation that cannot be undone from the UI (deleting a backup, replacing
 * all data with a restore): the user types the confirmation word before the action is enabled.
 */
export default function ConfirmTextModal({
  opened,
  close,
  title,
  word,
  color = "red",
  actionLabel,
  children,
  loading,
  error,
  onConfirm,
}: {
  opened: boolean;
  close: () => void;
  title: string;
  word: "DELETE" | "RESTORE";
  color?: string;
  actionLabel: string;
  children: React.ReactNode;
  loading: boolean;
  error: string;
  onConfirm: () => void;
}) {
  const { translate } = useLanguage();
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (opened) setTyped("");
  }, [opened]);

  return (
    <Modal opened={opened} onClose={() => !loading && close()} title={title} size="lg">
      <div className="flex flex-col gap-4">
        <Alert color={color} variant="light">
          <div className="flex flex-col gap-2 text-sm">{children}</div>
        </Alert>
        {error && <ErrorAlert error={error} />}
        <TextInput
          label={translate(`Type ${word} to confirm`, `اكتب ${word} للتأكيد`)}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          dir="ltr"
          autoComplete="off"
          data-autofocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={close} disabled={loading}>
            {translate("Cancel", "إلغاء")}
          </Button>
          <Button color={color} loading={loading} disabled={typed !== word} onClick={onConfirm}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
