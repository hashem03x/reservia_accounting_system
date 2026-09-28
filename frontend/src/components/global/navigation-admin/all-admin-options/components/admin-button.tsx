import { IconType } from "react-icons";

export default function AdminButton({ Icon, label, onClick }: { Icon: IconType; label: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-5 px-5 py-3 text-gray-600 transition-colors hover:bg-gray-100"
      onClick={onClick}
    >
      <Icon size={23.75} />
      <div style={{ fontWeight: 500, fontSize: "14px" }}>{label}</div>
    </button>
  );
}
