import { Link } from "react-router-dom";
import paths from "@/utils/constants/paths";
import { JournalEntryRef } from "@/types/fixed-asset";

// Link to an automatic journal entry stored on a document (asset acquisition, depreciation month,
// expense, payment, contribution). Shows its entry number when the API populated it.
export default function JournalEntryLink({ entry }: { entry?: string | JournalEntryRef | null }) {
  if (!entry) return <>-</>;
  const id = typeof entry === "string" ? entry : entry._id;
  const label = typeof entry === "string" ? id.slice(-6) : `#${entry.entryNumber}`;
  return (
    <Link to={`/${paths.admin}/${paths.journalEntries}/${id}`} className="text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
      {label}
    </Link>
  );
}
