import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@mantine/core";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";

export default function DeleteModal({
  opened,
  onClose,
  title,
  subTitle,
  action,
  loading,
  error,
  disabled = false,
  children = null,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  subTitle: string;
  action: () => void;
  loading: boolean;
  error: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const { translations } = useLanguage();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    action();
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p>{subTitle}</p>

        {children}

        <div className="flex gap-2">
          <Button variant="light" color="dark" onClick={onClose} fullWidth>
            {translations.cancel}
          </Button>
          <Button type="submit" color="red" loading={loading} fullWidth disabled={disabled}>
            {translations.confirm}
          </Button>
        </div>

        {error && <ErrorAlert error={error} />}
      </form>
    </Modal>
  );
}
