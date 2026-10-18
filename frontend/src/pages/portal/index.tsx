import { Link } from "react-router-dom";
import { useMantineColorScheme } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { useUser } from "@/context/UserContext";
import { useSystemAccess } from "@/context/SystemAccessContext";
import useLogout from "@/hooks/useLogout";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import { getRoleLabel } from "@/utils/constants/roles";
import paths from "@/utils/constants/paths";
import systems, { PUBLIC_WEBSITE_URL } from "@/utils/constants/systems";
import { Button, Tooltip } from "@mantine/core";
import { outlineIcons, navIcons } from "@/components/icons";
import Img from "@/components/ui/img";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import SystemCard from "./_components/system-card";
import logo from "@/assets/logo_no_bg.png";

const NEXT_COLOR_SCHEME = { light: "dark", dark: "auto", auto: "light" } as const;
const COLOR_SCHEME_ICON = { light: navIcons.Light, dark: navIcons.Dark, auto: navIcons.System };

// Central Business Portal (docs section "Portal Dashboard UI/UX") - the common entry point after
// login, replacing the old "always open the ERP dashboard" behavior. Renders all five system
// cards unconditionally; each card's enabled/disabled state comes ONLY from SystemAccessContext
// (GET /me/systems, backend-verified) - never inferred from local state.
export default function Portal() {
  const { translate, translations, language } = useLanguage();
  useDocumentTitle(`${translate("Central Business Portal", "البوابة المركزية للأعمال")} | ${translations.appName}`);

  const { user } = useUser();
  const { systems: access, loading, error, reFetch } = useSystemAccess();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const logout = useLogout();

  const themeLabel = translate(
    { light: "Light theme (switch)", dark: "Dark theme (switch)", auto: "System theme (switch)" }[colorScheme],
    { light: "المظهر الفاتح (تبديل)", dark: "المظهر الداكن (تبديل)", auto: "مظهر النظام (تبديل)" }[colorScheme],
  );

  const noAccessAtAll = !loading && access && Object.values(access).every(s => !s.hasMembership);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0d1117]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#161b22] sm:px-6">
        <div className="flex items-center gap-3">
          <Img width="36px" height="36px" src={logo || ""} alt={translations.appName} className="rounded" />
          <div className="leading-tight">
            <h1 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
              {translate("Central Business Portal", "البوابة المركزية للأعمال")}
            </h1>
            <p className="text-xs text-gray-400">Reservia Integrated Energy Solutions</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user?.platformAdmin && (
            <Link to={`/${paths.portal}/${paths.platformAdmin}/${paths.users}`}>
              <Button variant="light" color="grape" size="xs" leftSection={<outlineIcons.ShieldCheck size={16} />}>
                {translate("User Management", "إدارة المستخدمين")}
              </Button>
            </Link>
          )}

          <Tooltip label={themeLabel} withArrow>
            <button
              type="button"
              onClick={() => setColorScheme(NEXT_COLOR_SCHEME[colorScheme])}
              aria-label={themeLabel}
              className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/5"
            >
              {(() => {
                const SchemeIcon = COLOR_SCHEME_ICON[colorScheme];
                return <SchemeIcon size={18} />;
              })()}
            </button>
          </Tooltip>

          <div className="flex items-center gap-2 border-s border-gray-100 ps-2 dark:border-white/10">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[13px] font-semibold text-white">
              {user?.name?.trim().charAt(0).toLocaleUpperCase() || "?"}
            </span>
            <div className="leading-tight">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{user?.name}</p>
              <p className="text-xs text-gray-400">{user ? getRoleLabel(user.role, language) : ""}</p>
            </div>
          </div>

          <Link to={`/${paths.profile}`}>
            <Button variant="subtle" size="xs">
              {translate("My Profile", "ملفي الشخصي")}
            </Button>
          </Link>
          <Button variant="light" color="red" size="xs" onClick={() => logout()}>
            {translate("Logout", "تسجيل الخروج")}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {translate(`Welcome back, ${user?.name || ""}`, `مرحباً بعودتك، ${user?.name || ""}`)}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {translate(
              "This portal is your entry point to Reservia's business systems. Select a system below to get started.",
              "هذه البوابة هي نقطة الدخول إلى أنظمة أعمال Reversia. اختر أحد الأنظمة أدناه للبدء.",
            )}
          </p>
        </div>

        {loading ? (
          <LoadingSection />
        ) : error ? (
          <ErrorSection
            errorTitle={translate("Error loading your access", "خطأ في تحميل صلاحياتك")}
            errorMessage={error}
            button={{ text: translate("Try again", "حاول مرة أخرى"), onClick: reFetch }}
          />
        ) : (
          <>
            {noAccessAtAll && (
              <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 dark:border-yellow-900/40 dark:bg-yellow-900/10 dark:text-yellow-300">
                {translate(
                  "You don't have access to any business system yet. Contact your administrator to request access.",
                  "ليس لديك وصول إلى أي نظام أعمال حتى الآن. يرجى التواصل مع المسؤول لطلب الوصول.",
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {systems.map(system => (
                <SystemCard
                  key={system.id}
                  icon={system.icon}
                  name={system.name}
                  description={system.description}
                  entryRoute={system.entryRoute}
                  access={access?.[system.id]}
                />
              ))}
            </div>

            {PUBLIC_WEBSITE_URL && (
              <p className="mt-6 text-sm text-gray-500">
                {translate("Looking for the public website? ", "تبحث عن الموقع العام؟ ")}
                <a href={PUBLIC_WEBSITE_URL} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                  {translate("Visit the public site ↗", "زيارة الموقع العام ↗")}
                </a>
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
