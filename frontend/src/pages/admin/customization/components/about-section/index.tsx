import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import useDataHandler from "@/hooks/useDataHandler";
import useHasPermission from "@/hooks/useHasPermission";
import AboutForm from "./about-form";
import BackupSection from "./backup-section";
import handleRequest from "@/utils/helpers/handle-request";
import { isAdmin } from "@/utils/constants/roles";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Button } from "@mantine/core";
import ErrorAlert from "@/components/ui/error-alert";
import { solidIcons } from "@/components/icons";

export default function AboutSection() {
  const { translate, language } = useLanguage();
  const { user } = useUser();
  const canReadDatabaseExport = useHasPermission(resources.databaseExport, actions.read);
  const showAutomatedBackup = Boolean(user && isAdmin(user.role));

  const {
    privateRequest,
    loading: exportLoading,
    setLoading: setExportLoading,
    error: exportError,
    setError: setExportError,
  } = useDataHandler<null>({ initialData: null });

  function handleExportDatabase() {
    handleRequest(language, setExportLoading, setExportError, async () => {
      await privateRequest({
        url: "database-export",
        method: "GET",
        download: true,
        language,
      });
    });
  }

  const showManualExport = canReadDatabaseExport;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h3>{translate("General", "عام")}</h3>
        <p className="flex flex-wrap gap-1">
          <span>
            {translate(
              "The logo is shown across the admin app, and the barcode settings control what prints on variant/PO barcode stickers.",
              "يظهر الشعار في جميع أنحاء لوحة التحكم، وتتحكم إعدادات الباركود في ما يتم طباعته على ملصقات الباركود للمتغيرات وأوامر الشراء.",
            )}
          </span>
        </p>
      </header>

      <AboutForm />

      {showManualExport && (
        <>
          <hr />

          {/* Export Database */}
          <div className="flex flex-col gap-3">
            <header className="flex flex-col gap-2">
              <h3>{translate("Export Database", "تصدير قاعدة البيانات")}</h3>
            </header>
            <p className="flex flex-wrap gap-1">
              <span>
                {translate(
                  "Export the database to a file. The file will be saved as a ZIP archive containing all database data.",
                  "تصدير قاعدة البيانات إلى ملف، حيث سيتم حفظه كأرشيف بصيغة ZIP يحتوي على جميع بيانات قاعدة البيانات.",
                )}
              </span>
            </p>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-3">
                <Button
                  variant="light"
                  color="green"
                  radius="md"
                  leftSection={exportLoading ? undefined : <solidIcons.Download className="h-4 w-4" />}
                  disabled={exportLoading}
                  onClick={handleExportDatabase}
                >
                  {exportLoading
                    ? translate("Preparing export...", "جاري تجهيز البيانات...")
                    : translate("Download ZIP backup", "تنزيل النسخة الاحتياطية")}
                </Button>
              </div>

              {exportLoading && (
                <p className="text-sm leading-relaxed text-gray-600">
                  {translate(
                    "Your data is being prepared for download. It may take a few minutes.",
                    "يتم الآن تجهيز بياناتك للتنزيل. قد يستغرق الأمر بعض الوقت.",
                  )}
                </p>
              )}

              {exportError ? <ErrorAlert error={exportError} /> : null}
            </div>
          </div>
        </>
      )}

      {showAutomatedBackup && <BackupSection />}
    </div>
  );
}
