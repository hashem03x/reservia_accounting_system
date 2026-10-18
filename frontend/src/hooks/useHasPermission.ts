import { useUser } from "@/context/UserContext";
import { LocalizedLabel } from "@/types/global";
import { Action, GeneralAction, Resource, User } from "@/types/user";
import { isAdmin, isCustomer } from "@/utils/constants/roles";

export default function useHasPermission(
  resource: Resource | LocalizedLabel<Resource>,
  action: GeneralAction | LocalizedLabel<Action>,
): boolean {
  const { user } = useUser();
  return hasPermission(user, resource, action);
}

/** The same rule as useHasPermission, for checking many resources at once (e.g. the admin sidebar). */
export function hasPermission(
  user: Pick<User, "role" | "permissions"> | null | undefined,
  resource: Resource | LocalizedLabel<Resource>,
  action: GeneralAction | LocalizedLabel<Action>,
): boolean {
  if (!user) return false;

  if (isAdmin(user.role)) return true;

  if (isCustomer(user.role)) return false;

  // Extract value from LocalizedLabel if applicable
  const resourceValue = isLocalizedLabel(resource) ? resource.value : resource;
  const actionValue = isLocalizedLabel(action) ? action.value : action;

  const requiredPermission = user.permissions.find((permission) => permission.resource === resourceValue);
  if (!requiredPermission) return false;

  // `actionValue` may be "createGeneral" (see GeneralAction) - not part of the statically-typed
  // Action[] shape, but a perfectly real string the backend's permissions array can contain
  // (adminPermission - appConstant.js). A plain runtime string comparison either way.
  if (requiredPermission.actions.includes(actionValue as Action)) return true;

  return false;
}

// Type guard to check if a value is a LocalizedLabel
function isLocalizedLabel<T extends string>(value: T | LocalizedLabel<T>): value is LocalizedLabel<T> {
  return typeof value === "object" && value !== null && "label" in value;
}
