import { Link } from "react-router-dom";
import { Badge } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { outlineIcons } from "@/components/icons";
import { SystemAccessEntry } from "@/types/systems";

type Props = {
  icon: keyof typeof outlineIcons;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  entryRoute: string | null;
  access: SystemAccessEntry | undefined;
};

// Central Business Portal - one system card. Three distinct states (docs section "System cards"):
//   1. No access at all - visibly disabled, "Access not granted".
//   2. Access granted but the system isn't implemented yet (HR/CRM/Commercial/Website today) -
//      visibly distinct from both other states, "Coming soon" - never pretends a real app exists.
//   3. Access granted AND implemented (ERP only, today) - fully enabled, navigates on click.
// Never color-only: each state also carries a distinct text label and icon.
export default function SystemCard({ icon, name, description, entryRoute, access }: Props) {
  const { translate, language } = useLanguage();
  const Icon = outlineIcons[icon];

  const hasAccess = !!access?.hasMembership;
  const isLive = !!access?.active && !!entryRoute;

  const statusBadge = isLive ? (
    <Badge color="teal" variant="light" leftSection={<outlineIcons.CheckCircle size={12} />}>
      {translate("Access granted", "الوصول مفعل")}
    </Badge>
  ) : hasAccess ? (
    <Badge color="yellow" variant="light">
      {translate("Coming soon", "قريباً")}
    </Badge>
  ) : (
    <Badge color="gray" variant="light" leftSection={<outlineIcons.Lock size={12} />}>
      {translate("Access not granted", "الوصول غير مصرح به")}
    </Badge>
  );

  const content = (
    <>
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${
          isLive ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300" : "bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500"
        }`}
      >
        <Icon size={24} aria-hidden />
      </div>
      <h3 className={`mt-4 text-lg font-semibold ${isLive ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
        {translate(name.en, name.ar)}
      </h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{translate(description.en, description.ar)}</p>
      <div className="mt-4">{statusBadge}</div>
      {!hasAccess && (
        <p className="mt-2 text-xs text-gray-400">
          {translate("Contact your administrator to request access.", "يرجى التواصل مع المسؤول لطلب الوصول.")}
        </p>
      )}
    </>
  );

  const cardClassName = `flex flex-col rounded-2xl border p-5 text-start shadow-sm transition-all duration-150 ${
    isLive
      ? "border-primary-200 bg-white hover:-translate-y-0.5 hover:shadow-md focus-visible:-translate-y-0.5 focus-visible:shadow-md dark:border-primary-800 dark:bg-[#161b22]"
      : "cursor-not-allowed border-gray-100 bg-gray-50 opacity-80 dark:border-white/10 dark:bg-white/[0.02]"
  } outline-none focus-visible:ring-2 focus-visible:ring-primary-400`;

  if (isLive) {
    return (
      <Link to={entryRoute!} className={cardClassName} dir={language === "ar-EG" ? "rtl" : "ltr"}>
        {content}
      </Link>
    );
  }

  return (
    <div
      role="button"
      aria-disabled="true"
      tabIndex={0}
      className={cardClassName}
      dir={language === "ar-EG" ? "rtl" : "ltr"}
    >
      {content}
    </div>
  );
}
