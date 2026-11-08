import { Link, Outlet } from "react-router-dom";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { useLanguage } from "@/context/LanguageContext";
import { WebsiteRole } from "@/types/website";
import paths from "@/utils/constants/paths";
import { Button } from "@mantine/core";
import Img from "@/components/ui/img";
import img from "@/assets/unauthorized.png";

// Website Management - gates a route on the user's WEBSITE role (admin/editor/viewer), mirroring
// crm-role-guard.tsx's shape exactly but keyed off WEBSITE's own role vocabulary
// (SystemAccessContext/"GET /me/systems") rather than the ERP's resource:action matrix - there is
// no such matrix for Website Management (see backend/server/middleware/websiteAccess.js's
// `requireWebsiteCapability`, which this component's intent mirrors). This is a UI convenience
// only; the backend re-checks the same role on every request from the user's own stored
// systemMemberships, never from anything the client sends.
export default function WebsiteRoleGuard({ allowedRoles }: { allowedRoles: WebsiteRole[] }) {
  const { systems } = useSystemAccess();
  const role = systems?.WEBSITE?.role as WebsiteRole | null | undefined;

  if (role && allowedRoles.includes(role)) return <Outlet />;

  return <WebsiteUnauthorized />;
}

function WebsiteUnauthorized() {
  const { translate, translations } = useLanguage();
  return (
    <div className="flex-center h-full flex-1 flex-col gap-3 pb-20">
      <Img src={img} alt="Unauthorized Access" className="h-28" />
      <h1 className="text-center text-xl sm:text-3xl">{translate("Unauthorized Access", "دخول غير مصرح")}</h1>
      <p className="text-center">
        {translate("You don't have permission to access this page.", "ليس لديك إذن للوصول إلى هذه الصفحة.")}
      </p>
      <Link to={`/${paths.website}`}>
        <Button variant="light">{translations.back}</Button>
      </Link>
    </div>
  );
}
