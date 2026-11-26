import { useSystemAccess } from "@/context/SystemAccessContext";
import { CommercialRole } from "@/types/commercial";
import { canSeePricing } from "./dealEnginePermissions";

/** The signed-in user's Deal Engine role(s) and whether they may see any price (see PRICING_ROLES). */
export default function usePricingAccess() {
  const { systems } = useSystemAccess();
  const role = (systems?.COMMERCIAL?.role || "") as CommercialRole | "";
  const roles = role ? [role as CommercialRole] : [];
  return { role, roles, canSeePricing: canSeePricing(roles) };
}
