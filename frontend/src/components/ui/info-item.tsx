export default function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs md:text-sm">
      <span className="text-gray-600">{label}:</span>
      <span className="font-bold text-gray-800">{value}</span>
    </div>
  );
}
