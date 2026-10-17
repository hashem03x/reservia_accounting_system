import { useState } from "react";
import { Button } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifyError } from "@/utils/helpers/notifiers";
import { solidIcons } from "@/components/icons";

// "Download Sample CSV" (docs section "Download Sample CSV behavior") - reuses the exact same
// client-side file-download mechanism every report-export button already uses
// (apiRequest's `download`/`filename` handling), pointed at a module's own `GET .../sample`
// endpoint (built server-side with utils/exportToCsv.js, which already BOM-prefixes the file and
// sets the correct Content-Type/Content-Disposition).
export default function DownloadSampleButton({ url, filename }: { url: string; filename: string }) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await privateRequest({ url, download: true, filename, language });
    } catch {
      notifyError({ language, message: translate("Could not download the sample CSV.", "تعذر تحميل نموذج CSV.") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="light" color="gray" leftSection={<solidIcons.Download />} onClick={handleClick} loading={loading}>
      {translate("Download Sample CSV", "تحميل نموذج CSV")}
    </Button>
  );
}
