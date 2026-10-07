import { JournalLine } from "@/types/journal-entry";

// Presentation-only grouping of a Journal Entry's lines: every DEBIT line first, then every CREDIT
// line. The persisted order/data is never changed - each group keeps the lines' original relative
// order. A line is classified by which side actually carries its amount (debit > 0 vs credit > 0,
// per journalLineSchema exactly one side is non-zero), never by the sign of some other value.

export type GroupedJournalLine = { line: JournalLine; originalIndex: number };

export function groupJournalLines(lines: JournalLine[] | null | undefined): { debitLines: GroupedJournalLine[]; creditLines: GroupedJournalLine[] } {
  const debitLines: GroupedJournalLine[] = [];
  const creditLines: GroupedJournalLine[] = [];
  (lines || []).forEach((line, originalIndex) => {
    if (!line) return;
    if ((Number(line.debit) || 0) > 0) debitLines.push({ line, originalIndex });
    else creditLines.push({ line, originalIndex });
  });
  return { debitLines, creditLines };
}
