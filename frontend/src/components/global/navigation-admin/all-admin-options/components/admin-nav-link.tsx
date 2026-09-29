import { NavLink, useLocation } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";
import type { Link } from "../index";

export default function AdminNavLink({
  link: { to, label, Icon, nestedLinks },
  onClick,
}: {
  link: Link;
  onClick?: () => void;
}) {
  const { translate } = useLanguage();

  const { pathname } = useLocation();

  const isActive = pathname.includes(to);

  return (
    <div>
      <NavLink
        to={to}
        onClick={onClick}
        className={`flex items-center gap-5 border-l-[3px] px-5 py-[10px] text-base transition-colors duration-100 ${isActive ? "border-teal-600 bg-teal-50 font-medium text-teal-800" : "border-transparent text-gray-600 hover:bg-gray-50"}`}
      >
        {Icon && <Icon size={23} />}
        <div>{label}</div>
      </NavLink>

      {/* Nested links */}
      {isActive && nestedLinks && (
        <div className="my-[2px] flex flex-col">
          {nestedLinks.map((nestedLink) => (
            <NavLink
              key={nestedLink.to}
              to={nestedLink.to}
              onClick={onClick}
              className={({ isActive: isActiveNestLink }) =>
                `flex items-center gap-4 py-[6px] text-sm transition-colors duration-100 ${translate("pl-[28px]", "pl-[28px] sm:pr-[28px]")} ${isActiveNestLink ? "bg-teal-50 font-medium text-teal-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`
              }
            >
              <solidIcons.Circle size={4} />
              <div>{nestedLink.label}</div>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
