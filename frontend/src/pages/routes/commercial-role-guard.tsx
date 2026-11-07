import { Link, Outlet } from "react-router-dom";
import { useSystemAccess } from "@/context/SystemAccessContext";
import { useLanguage } from "@/context/LanguageContext";
import { CommercialRole } from "@/types/commercial";
import paths from "@/utils/constants/paths";
import { Button } from "@mantine/core";
import Img from "@/components/ui/img";
import img from "@/assets/unauthorized.png";

// Reservia Commercial - gates a route on the user's Commercial role
// (md/commercial_director/sales/technical/member), mirroring pages/routes/crm-role-guard.tsx
// exactly - the frontend convenience mirror of
// backend/server/middleware/commercialAccess.js#requireCommercialRole. The backend re-checks the
// same role on every request from the user's own stored systemMemberships, never from anything
// the client sends.
export default function CommercialRoleGuard({ allowedRoles }: { allowedRoles: CommercialRole[] }) {
  const { systems } = useSystemAccess();
  const role = systems?.COMMERCIAL?.role as CommercialRole | null | undefined;

  if (role && allowedRoles.includes(role)) return <Outlet />;

  return <CommercialUnauthorized />;
}

function CommercialUnauthorized() {
  const { translate, translations } = useLanguage();
  return (
    <div className="flex-center h-full flex-1 flex-col gap-3 pb-20">
      <Img src={img} alt="Unauthorized Access" className="h-28" />
      <h1 className="text-center text-xl sm:text-3xl">{translate("Unauthorized Access", "دخول غير مصرح")}</h1>
      <p className="text-center">
        {translate("You don't have permission to access this page.", "ليس لديك إذن للوصول إلى هذه الصفحة.")}
      </p>
      <Link to={`/${paths.commercial}`}>
        <Button variant="light">{translations.back}</Button>
      </Link>
    </div>
  );
}
