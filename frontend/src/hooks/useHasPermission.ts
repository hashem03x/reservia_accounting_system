import { useUser } from "@/context/UserContext";
import { LocalizedLabel } from "@/types/global";
import { Action, Resource, User } from "@/types/user";
import { isAdmin, isCustomer } from "@/utils/constants/roles";

export default function useHasPermission(
  resource: Resource | LocalizedLabel<Resource>,
  action: Action | LocalizedLabel<Action>,
): boolean {
  const { user } = useUser();
  return hasPermission(user, resource, action);
}

/** The same rule as useHasPermission, for checking many resources at once (e.g. the admin sidebar). */
export function hasPermission(
  user: Pick<User, "role" | "permissions"> | null | undefined,
  resource: Resource | LocalizedLabel<Resource>,
  action: Action | LocalizedLabel<Action>,
): boolean {
  if (!user) return false;

  if (isAdmin(user.role)) return true;

  if (isCustomer(user.role)) return false;

  // Extract value from LocalizedLabel if applicable
  const resourceValue = isLocalizedLabel(resource) ? resource.value : resource;
  const actionValue = isLocalizedLabel(action) ? action.value : action;

  const requiredPermission = user.permissions.find((permission) => permission.resource === resourceValue);
  if (!requiredPermission) return false;

  if (requiredPermission.actions.includes(actionValue)) return true;

  return false;
}

// Type guard to check if a value is a LocalizedLabel
function isLocalizedLabel<T extends string>(value: T | LocalizedLabel<T>): value is LocalizedLabel<T> {
  return typeof value === "object" && value !== null && "label" in value;
}
