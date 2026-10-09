import { useEffect, useState } from "react";
import { Button, NumberInput, Textarea, TextInput } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import Modal from "@/components/ui/modal";
import ErrorAlert from "@/components/ui/error-alert";
import { DisclosureNote } from "@/types/accounting-report";

// Add / edit a manually maintained disclosure note (text only - never an accounting record).
export default function DisclosureNoteModal({ opened, close, note, onSaved }: { opened: boolean; close: () => void; note: DisclosureNote | null; onSaved: () => void }) {
  const { language, translate } = useLanguage();
  const [title, setTitle] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [body, setBody] = useState("");
  const [bodyAr, setBodyAr] = useState("");
  const [sortOrder, setSortOrder] = useState<string | number>(0);
  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  useEffect(() => {
    if (!opened) return;
    setTitle(note?.title || "");
    setTitleAr(note?.titleAr || "");
    setBody(note?.body || "");
    setBodyAr(note?.bodyAr || "");
    setSortOrder(note?.sortOrder ?? 0);
    setError("");
  }, [opened, note]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleRequest(language, setLoading, setError, async () => {
      await privateRequest({
        language,
        method: note ? "PATCH" : "POST",
        url: note ? `accounting-reports/notes/${note._id}` : "accounting-reports/notes",
        data: { title, titleAr, body, bodyAr, sortOrder: Number(sortOrder) || 0 },
      });
      onSaved();
      close();
    });
  }

  return (
    <Modal opened={opened} onClose={close} title={note ? translate("Edit Note", "تعديل الإيضاح") : translate("Add Note", "إضافة إيضاح")} size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <ErrorAlert error={error} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextInput label={translate("Title (English)", "العنوان (إنجليزي)")} value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextInput label={translate("Title (Arabic)", "العنوان (عربي)")} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} dir="rtl" />
        </div>
        <Textarea label={translate("Note (English)", "الإيضاح (إنجليزي)")} value={body} onChange={(e) => setBody(e.target.value)} autosize minRows={3} required />
        <Textarea label={translate("Note (Arabic)", "الإيضاح (عربي)")} value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} autosize minRows={3} dir="rtl" />
        <NumberInput label={translate("Order", "الترتيب")} value={sortOrder} onChange={setSortOrder} allowDecimal={false} w={140} />
        <Button type="submit" loading={loading} disabled={!title.trim() || !body.trim()}>
          {translate("Save", "حفظ")}
        </Button>
      </form>
    </Modal>
  );
}
