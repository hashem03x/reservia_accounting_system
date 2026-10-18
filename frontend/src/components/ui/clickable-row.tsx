import { MouseEvent, ReactNode } from "react";
import { Table } from "@mantine/core";

// A clickable table row that still lets users select and copy cell text (e.g. a PO code) without
// triggering navigation. Two guards, checked before calling onClick:
//  1. An active text selection (the user just finished dragging to select/copy something) -
//     checked via window.getSelection(), since a selecting drag still ends in a "click".
//  2. The click originated on a nested interactive control (button, link, input, checkbox, label,
//     or anything explicitly opted out via data-no-row-click) - checked via Element.closest() on
//     event.target, so individual rows never need their own stopPropagation wiring.
// A plain click anywhere else on the row still navigates, same as before.
export function ClickableRow({
  onClick,
  children,
  className = "",
  ...rest
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string;
} & Record<string, unknown>) {
  function handleClick(e: MouseEvent<HTMLTableRowElement>) {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;

    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, label, [role="button"], [data-no-row-click]')) return;

    onClick();
  }

  return (
    <Table.Tr onClick={handleClick} className={`cursor-pointer ${className}`} {...rest}>
      {children}
    </Table.Tr>
  );
}
