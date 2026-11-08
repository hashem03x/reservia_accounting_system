import { useLanguage } from "@/context/LanguageContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import { WebsiteRole } from "@/types/website";

// Website Management - Overview (Milestone 1: a real, permission-gated page that proves the
// module exists and is reachable; the real stats/widgets from the task's own Phase 2 spec
// - published/draft page counts, last update, recent publishing activity, tracking integrations,
// missing SEO, broken images - are built once Pages/Sections/Media/Integrations (the data they
// summarize) exist in later milestones. This page is deliberately NOT a fake dashboard with
// invented numbers in the meantime.
export default function WebsiteOverview() {
  const { translate } = useLanguage();
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;

  useDocumentTitle(translate("Website Management", "إدارة الموقع الإلكتروني"));

  return (
    <AdminLayoutBox
      header={{
        title: translate("Website Management", "إدارة الموقع الإلكتروني"),
        subTitle: translate(
          "Manage the Reservia website's pages, content, media, navigation, SEO and tracking integrations.",
          "إدارة صفحات موقع رزيرفيا ومحتواه والوسائط والتنقل وتحسين محركات البحث وتكاملات التتبع.",
        ),
      }}
    >
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-700">
          {translate(
            `You are signed in to Website Management with the "${role}" role.`,
            `أنت مسجل الدخول إلى إدارة الموقع الإلكتروني بدور "${role}".`,
          )}
        </p>
        <p className="mt-2 text-sm text-gray-500">
          {translate(
            "Page and section management, the Media Library, Navigation, SEO, Tracking and Custom Code screens are being built in upcoming milestones.",
            "سيتم إضافة إدارة الصفحات والأقسام ومكتبة الوسائط والتنقل وتحسين محركات البحث والتتبع والكود المخصص في مراحل قادمة.",
          )}
        </p>
      </div>
    </AdminLayoutBox>
  );
}
