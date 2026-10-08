import { useRef } from "react";
import { useLanguage } from "@/context/LanguageContext";
import useDataHandler from "@/hooks/useDataHandler";
import handleRequest from "@/utils/helpers/handle-request";
import { notifications } from "@mantine/notifications";
import { Button } from "@mantine/core";
import { solidIcons } from "@/components/icons";

export default function ImportButton({ url, callback }: { url: string; callback: () => void }) {
  const { language, translate } = useLanguage();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { privateRequest, loading, setLoading, error, setError } = useDataHandler({ initialData: null });

  if (error) {
    notifications.show({
      title: translate("Failed to import data", "فشل في استيراد البيانات"),
      message: error,
      color: "red",
      autoClose: 7500,
      withBorder: true,
    });

    setError("");
  }

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  async function importCsvData(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith(".csv")) {
      notifications.show({
        title: translate("Invalid File Type", "نوع ملف غير صالح"),
        message: translate("Please upload a CSV file", "يرجى تحميل ملف CSV"),
        color: "red",
        autoClose: 7500,
        withBorder: true,
      });
      return;
    }

    // Create FormData and append file
    const formData = new FormData();
    formData.append("file", file);

    handleRequest(language, setLoading, setError, async () => {
      const response = await privateRequest({
        url,
        method: "POST",
        data: formData,
        language,
      });

      // The backend returns HTTP 207 (still "ok" to fetch, so this never throws) for a partial
      // import - some products/variants were skipped with a per-row reason in response.data.errors.
      // Previously this response was never inspected at all, so a partial failure looked identical
      // to a full success to whoever ran the import - they'd only find out rows were dropped by
      // spotting missing products later.
      const skippedCount = response?.data?.errors?.length ?? 0;
      if (response?.status === "partial_success" || skippedCount > 0) {
        notifications.show({
          title: translate("Imported with some errors", "تم الاستيراد مع بعض الأخطاء"),
          message: translate(
            `Imported ${response?.results ?? 0} product(s). ${skippedCount} product(s) were skipped - see console for details.`,
            `تم استيراد ${response?.results ?? 0} منتج. تم تخطي ${skippedCount} منتج - راجع وحدة التحكم للتفاصيل.`,
          ),
          color: "yellow",
          autoClose: 10000,
          withBorder: true,
        });
        console.warn("CSV import partial failures", response?.data?.errors);
      } else {
        notifications.show({
          title: translate("Success", "نجاح"),
          message: translate("Data imported successfully", "تم استيراد البيانات بنجاح"),
          color: "green",
        });
      }

      callback();
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <>
      <input type="file" ref={fileInputRef} onChange={importCsvData} style={{ display: "none" }} />
      {/* accept=".csv" */}
      <Button
        variant="light"
        color="grape"
        leftSection={loading ? <solidIcons.Spinner className="animate-spin" /> : <solidIcons.ArrowUp />}
        onClick={handleImportClick}
        disabled={loading}
      >
        {translate("Import", "استيراد")}
      </Button>
    </>
  );
}
