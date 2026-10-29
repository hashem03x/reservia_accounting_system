import { Link, Outlet } from "react-router-dom";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { useLanguage } from "@/context/LanguageContext";
import { CrmRole } from "@/types/crm";
import paths from "@/utils/constants/paths";
import { Button } from "@mantine/core";
import Img from "@/components/ui/img";
import img from "@/assets/unauthorized.png";

// Reservia CRM - gates a route on the user's CRM role (md/admin/sales/technical), mirroring
// resource-guard.tsx's shape but keyed off the CRM's own role vocabulary
// (SystemAccessContext/"GET /me/systems") rather than the ERP's resource:action permission
// matrix - there is no such matrix for CRM (see backend/server/middleware/crmAccess.js's
// `requireCrmRole`, which this component is the frontend mirror of). This is a UI convenience
// only; the backend re-checks the same role on every request from the user's own stored
// systemMemberships, never from anything the client sends.
export default function CrmRoleGuard({ allowedRoles }: { allowedRoles: CrmRole[] }) {
  const { systems } = useSystemAccess();
  const role = systems?.CRM?.role as CrmRole | null | undefined;

  if (role && allowedRoles.includes(role)) return <Outlet />;

  return <CrmUnauthorized />;
}

function CrmUnauthorized() {
  const { translate, translations } = useLanguage();
  return (
    <div className="flex-center h-full flex-1 flex-col gap-3 pb-20">
      <Img src={img} alt="Unauthorized Access" className="h-28" />
      <h1 className="text-center text-xl sm:text-3xl">{translate("Unauthorized Access", "دخول غير مصرح")}</h1>
      <p className="text-center">
        {translate("You don't have permission to access this page.", "ليس لديك إذن للوصول إلى هذه الصفحة.")}
      </p>
      <Link to={`/${paths.crm}`}>
        <Button variant="light">{translations.back}</Button>
      </Link>
    </div>
  );
}
