export default function MiniDivider({ className = "" }: { className?: string }) {
  return <div className={`h-[2.5px] w-[25px] rounded bg-gray-200 ${className}`}></div>;
}
