import { Navigate, useLocation } from "react-router-dom";

// Pre-launch audit (22 Nov 2026): the ERP moved from /admin to /erp, and Deal Engine from
// /commercial to /dealengine. This keeps any old bookmarked or shared link working by rewriting
// just the leading segment and letting the router re-match under the new prefix - where the
// normal AuthGaurd/RoleGuard/SystemGuard chain takes over exactly as it would for a fresh link
// (nested segments, query string and all). One component, parameterized by which legacy/current
// prefix pair it's redirecting - see the two routes in App.tsx that use it.
export default function LegacyPrefixRedirect({ from, to }: { from: string; to: string }) {
  const location = useLocation();
  const target = location.pathname.replace(new RegExp(`^/${from}`), `/${to}`);
  return <Navigate to={`${target}${location.search}`} replace />;
}
