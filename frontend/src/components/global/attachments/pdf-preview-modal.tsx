import { useEffect, useState } from "react";
import { Button, Loader, Modal } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { solidIcons } from "@/components/icons";
import ErrorAlert from "@/components/ui/error-alert";

/**
 * Shows a stored PDF inside the app. The file is fetched with the user's session (it has no public
 * URL) and shown from memory; "Download" saves it under its real name.
 */
export default function PdfPreviewModal({
  url,
  title,
  onClose,
}: {
  /** API path of the file (without ?inline), or null when closed. */
  url: string | null;
  title: string;
  onClose: () => void;
}) {
  const { language, translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const mobile = useMediaQuery("(max-width: 640px)");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!url) return undefined;
    let revoked = false;
    let created: string | null = null;
    setObjectUrl(null);
    setError("");
    privateRequest({ url, params: { inline: 1 }, responseType: "blob", language })
      .then((res: { blob: Blob; contentType: string }) => {
        if (revoked) return;
        created = URL.createObjectURL(new Blob([res.blob], { type: res.contentType || "application/pdf" }));
        setObjectUrl(created);
      })
      .catch(
        (err: Error) => !revoked && setError(err?.message || translate("The file could not be opened.", "تعذر فتح الملف.")),
      );
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function download() {
    if (!url) return;
    setDownloading(true);
    try {
      await privateRequest({ url, download: true, language });
    } catch (err) {
      setError((err as Error)?.message || translate("The download failed.", "فشل التنزيل."));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal
      opened={!!url}
      onClose={onClose}
      title={
        <span className="block truncate font-semibold" dir="auto">
          {title}
        </span>
      }
      size="80%"
      fullScreen={mobile}
      centered
      radius="lg"
      dir={language.startsWith("ar") ? "rtl" : "ltr"}
    >
      <div className="flex flex-col gap-3">
        {error && <ErrorAlert error={error} />}
        {!error && !objectUrl && (
          <div className="flex h-[60vh] items-center justify-center">
            <Loader />
          </div>
        )}
        {objectUrl && <iframe title={title} src={objectUrl} className="h-[70vh] w-full rounded-md border border-gray-200" />}
        <div className="flex justify-end">
          <Button leftSection={<solidIcons.Download size={14} />} loading={downloading} onClick={download} variant="light">
            {translate("Download", "تحميل")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
