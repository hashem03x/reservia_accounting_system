import { IconType } from "react-icons";
import { Tooltip } from "@mantine/core";

export default function AdminButton({
  Icon,
  label,
  onClick,
  collapsed = false,
  dataTour,
  highlighted = false,
}: {
  Icon: IconType;
  label: string;
  onClick: () => void;
  collapsed?: boolean;
  dataTour?: string;
  highlighted?: boolean;
}) {
  const button = (
    <button
      className={`flex w-full items-center gap-5 py-3 transition-colors ${highlighted ? "font-medium text-primary-700 hover:bg-primary-50" : "text-gray-600 hover:bg-gray-100"} ${collapsed ? "justify-center px-2" : "px-5"}`}
      onClick={onClick}
      data-tour={dataTour}
      aria-label={label}
    >
      <Icon size={23.75} />
      {!collapsed && <div style={{ fontWeight: 500, fontSize: "14px" }}>{label}</div>}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip label={label} position="right" withArrow>
      {button}
    </Tooltip>
  );
}
