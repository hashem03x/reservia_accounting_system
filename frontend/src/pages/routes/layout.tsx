import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";

export default function Layout() {
  const { translations } = useLanguage();

  const { pathname } = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scroll({ top: 0, behavior: "instant" });
  }, [pathname]);

  return (
    <div dir={translations.dir} style={{ height: "101vh" }}>
      <Outlet />
    </div>
  );
}
