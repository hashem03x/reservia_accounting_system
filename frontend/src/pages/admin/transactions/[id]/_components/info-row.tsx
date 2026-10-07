export default function InfoRow({
  label,
  icon,
  value,
  valueClassName,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon && <div>{icon}</div>}
      <span className="text-nowrap text-gray-600">{label}:</span>
      <span className={`text-nowrap font-medium text-gray-800 ${valueClassName}`}>{value}</span>
    </div>
  );
}
