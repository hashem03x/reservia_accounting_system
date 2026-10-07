import { useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "@mantine/core";

// Reusable truncation-with-tooltip cell content for dense tables (Accounts, and any future table
// with long free-text columns like account/parent names). Only shows a tooltip when the text is
// ACTUALLY clipped (measured via ResizeObserver, re-checked on every resize/breakpoint change) -
// never shows a redundant tooltip repeating text that's already fully visible.
export default function TruncatedText({ text, className = "", maxWidthClassName = "max-w-[220px]" }: { text: React.ReactNode; className?: string; maxWidthClassName?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const content = (
    <span ref={ref} className={`block truncate ${maxWidthClassName} ${className}`}>
      {text}
    </span>
  );

  if (!isTruncated || typeof text !== "string") return content;

  return (
    <Tooltip label={text} multiline maw={320} withinPortal openDelay={200} position="top-start">
      {content}
    </Tooltip>
  );
}
