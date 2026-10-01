import { NavLink, useLocation } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { solidIcons } from "@/components/icons";
import { HoverCard, Tooltip } from "@mantine/core";
import type { Link } from "../index";

export default function AdminNavLink({
  link: { to, label, Icon, nestedLinks },
  onClick,
  collapsed = false,
}: {
  link: Link;
  onClick?: () => void;
  collapsed?: boolean;
}) {
  const { translate } = useLanguage();

  const { pathname } = useLocation();

  const isActive = pathname.includes(to);

  const linkContent = (
    <NavLink
      to={to}
      onClick={onClick}
      className={`flex items-center border-l-[3px] py-[10px] text-base transition-colors duration-100 ${collapsed ? "justify-center px-2" : "gap-5 px-5"} ${isActive ? "border-primary-600 bg-primary-50 font-medium text-primary-800" : "border-transparent text-gray-600 hover:bg-gray-50"}`}
    >
      {Icon && <Icon size={23} />}
      {!collapsed && <div>{label}</div>}
    </NavLink>
  );

  // Collapsed + has nested links: a hover flyout keeps every sub-route reachable without
  // permanently widening the rail (NavLink navigation still works via a plain click).
  if (collapsed && nestedLinks) {
    return (
      <HoverCard position="right-start" withArrow shadow="md" openDelay={100} closeDelay={100}>
        <HoverCard.Target>{linkContent}</HoverCard.Target>
        <HoverCard.Dropdown p="xs">
          <div className="flex flex-col gap-0.5">
            <div className="px-2 pb-1 text-xs font-semibold text-gray-500">{label}</div>
            {nestedLinks.map((nestedLink) => (
              <NavLink
                key={nestedLink.to}
                to={nestedLink.to}
                onClick={onClick}
                className={({ isActive: isActiveNestLink }) =>
                  `rounded px-2 py-[6px] text-sm whitespace-nowrap transition-colors duration-100 ${isActiveNestLink ? "bg-primary-50 font-medium text-primary-700" : "text-gray-600 hover:bg-gray-100"}`
                }
              >
                {nestedLink.label}
              </NavLink>
            ))}
          </div>
        </HoverCard.Dropdown>
      </HoverCard>
    );
  }

  return (
    <div>
      {collapsed ? (
        <Tooltip label={label} position="right" withArrow>
          {linkContent}
        </Tooltip>
      ) : (
        linkContent
      )}

      {/* Nested links (expanded mode only) */}
      {!collapsed && isActive && nestedLinks && (
        <div className="my-[2px] flex flex-col">
          {nestedLinks.map((nestedLink) => (
            <NavLink
              key={nestedLink.to}
              to={nestedLink.to}
              onClick={onClick}
              className={({ isActive: isActiveNestLink }) =>
                `flex items-center gap-4 py-[6px] text-sm transition-colors duration-100 ${translate("pl-[28px]", "pl-[28px] sm:pr-[28px]")} ${isActiveNestLink ? "bg-primary-50 font-medium text-primary-700" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`
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
