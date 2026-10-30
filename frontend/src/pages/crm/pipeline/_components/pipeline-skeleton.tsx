import { Skeleton } from "@mantine/core";

// Initial-load skeleton for the Kanban board - mirrors the real column/card shapes (not a single
// generic spinner) so the layout doesn't jump once real data arrives.
export default function PipelineSkeleton() {
  return (
    <div className="flex gap-3 overflow-x-hidden pb-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex w-[280px] shrink-0 flex-col gap-2.5 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
          <Skeleton height={18} width="60%" radius="sm" />
          {Array.from({ length: i % 2 === 0 ? 3 : 2 }).map((__, j) => (
            <Skeleton key={j} height={92} radius="md" />
          ))}
        </div>
      ))}
    </div>
  );
}
