import { Link, Outlet } from "react-router-dom";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { useLanguage } from "@/context/LanguageContext";
import { SystemId } from "@/types/systems";
import paths from "@/utils/constants/paths";
import { Button } from "@mantine/core";
import Img from "@/components/ui/img";
import LoadingSection from "@/components/ui/sections/loading";
import img from "@/assets/unauthorized.png";

// Central Business Portal - defense in depth for the `/admin` route tree (ERP). The REAL
// authority is the backend (checkUserPermissions/allowedTo now require active ERP membership on
// every request - see utils/systemAccess.js) - this guard only means a revoked membership also
// stops the route tree itself from rendering, not just the Portal card, matching the task's "the
// target system independently verifies the authenticated identity and required authorization".
export default function SystemGuard({ systemId }: { systemId: SystemId }) {
  const { translate } = useLanguage();
  const { systems, loading } = useSystemAccess();

  if (loading) return <LoadingSection className="h-screen" />;

  if (systems?.[systemId]?.active) return <Outlet />;

  return (
    <div className="flex-center h-screen flex-col gap-3 pb-20">
      <Img src={img} alt="Unauthorized Access" className="h-28" />
      <h1 className="text-center text-xl sm:text-3xl">{translate("Access Not Granted", "الوصول غير مصرح به")}</h1>
      <p className="text-center">
        {translate(
          "You don't have access to this system. Contact your administrator.",
          "ليس لديك وصول إلى هذا النظام. يرجى التواصل مع المسؤول.",
        )}
      </p>
      <Link to={`/${paths.portal}`}>
        <Button variant="light">{translate("Back to Portal", "العودة إلى البوابة")}</Button>
      </Link>
    </div>
  );
}
