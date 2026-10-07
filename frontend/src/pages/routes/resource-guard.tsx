import { Link, Outlet } from "react-router-dom";
import { useUser } from "@/context/UserContext";
import { useLanguage } from "@/context/LanguageContext";
import { LocalizedLabel } from "@/types/global";
import { Resource, Action } from "@/types/user";
import { isAdmin, isCustomer } from "@/utils/constants/roles";
import paths from "@/utils/constants/paths";
import { Button } from "@mantine/core";
import Img from "@/components/ui/img";
import img from "@/assets/unauthorized.png";

export default function ResourceGuard({
  resource,
  action,
}: {
  resource: Resource | LocalizedLabel<Resource>;
  action: Action | LocalizedLabel<Action>;
}) {
  const { user } = useUser();

  if (!user) return <UnauthorizedAccess />;

  if (isAdmin(user.role)) return <Outlet />;

  if (isCustomer(user.role)) return <UnauthorizedAccess />;

  // Extract plain values from LocalizedLabel, if necessary
  const resourceValue = isLocalizedLabel(resource) ? resource.value : resource;
  const actionValue = isLocalizedLabel(action) ? action.value : action;

  const requiredPermission = user.permissions.find((permission) => permission.resource === resourceValue);
  if (!requiredPermission) return <UnauthorizedAccess />;

  if (requiredPermission.actions.includes(actionValue)) return <Outlet />;

  return <UnauthorizedAccess />;
}

// =============================================================

// Type guard to check if a value is a LocalizedLabel
function isLocalizedLabel<T extends string>(value: T | LocalizedLabel<T>): value is LocalizedLabel<T> {
  return typeof value === "object" && value !== null && "label" in value;
}

// =============================================================

function UnauthorizedAccess() {
  const { translate, translations } = useLanguage();

  return (
    <div className="flex-center h-full flex-1 flex-col gap-3 pb-20">
      <Img src={img} alt="Unauthorized Access" className="h-28" />
      <h1 className="text-center text-xl sm:text-3xl">{translate("Unauthorized Access", "دخول غير مصرح")}</h1>
      <p className="text-center">
        {translate("You don't have permission to access this page.", "ليس لديك إذن للوصول إلى هذه الصفحة.")}
      </p>
      <Link to={`/${paths.admin}/${paths.home}`}>
        <Button variant="light">{translations.back}</Button>
      </Link>
    </div>
  );
}
