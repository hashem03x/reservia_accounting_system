import { IconType } from "react-icons";
import { Tooltip } from "@mantine/core";

export default function AdminButton({
  Icon,
  label,
  onClick,
  collapsed = false,
}: {
  Icon: IconType;
  label: string;
  onClick: () => void;
  collapsed?: boolean;
}) {
  const button = (
    <button
      className={`flex items-center gap-5 py-3 text-gray-600 transition-colors hover:bg-gray-100 ${collapsed ? "justify-center px-2" : "px-5"}`}
      onClick={onClick}
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
