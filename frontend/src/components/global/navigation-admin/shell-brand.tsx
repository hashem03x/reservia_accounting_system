import { useLanguage } from "@/context/LanguageContext";
import Img from "@/components/ui/img";
import logo from "@/assets/logo_no_bg.png";

/**
 * The brand block every dashboard shows in its sidebar, phone header and phone drawer: the Reservia
 * logo, the company name and the name of the system (ERP "Admin panel", CRM, Deal Engine, HR...).
 */
export default function ShellBrand({ subtitle, className = "" }: { subtitle: string; className?: string }) {
  const { translations, translate } = useLanguage();
  return (
    <>
      <Img src={logo} alt={translations.appName} className="h-9 w-9 shrink-0 rounded-md bg-white" />
      <span className={`min-w-0 flex-1 leading-tight ${className}`}>
        <span className="block truncate text-[14px] font-bold text-brand">{translate("Reservia", "ريزيرفيا")}</span>
        <span className="block truncate text-[11.5px] text-ink-muted" data-testid="shell-subtitle">
          {subtitle}
        </span>
      </span>
    </>
  );
}
