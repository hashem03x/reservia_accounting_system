import { ReactNode } from "react";

export default function Box({
  height,
  className = "",
  children,
}: {
  height: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-lg bg-white p-4 shadow-md md:rounded-xl md:p-6 ${className}`} style={{ height }}>
      {children}
    </div>
  );
}
