import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, CloseButton } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import { TourStep } from "./tour-steps";

const CARD_WIDTH = 360;
const GAP = 12;
const WAIT_MS = 3000; // how long a step waits for its target to render (e.g. after navigating)

type Rect = { top: number; left: number; width: number; height: number };

/** The visible element marked data-tour="<target>", or null (missing, hidden or zero-sized). */
function findTarget(target?: string): HTMLElement | null {
  if (!target) return null;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`));
  return (
    candidates.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    }) || null
  );
}

/**
 * One tour step: a spotlight around its target and a card next to it (or a centered card when the
 * target is not on screen). The page stays usable underneath - nothing but the card catches clicks.
 * Keyboard: Esc closes, arrow keys / Enter move (mirrored in Arabic).
 */
export default function TourOverlay({
  step,
  index,
  total,
  onBack,
  onNext,
  onClose,
}: {
  step: TourStep;
  index: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { language, translate } = useLanguage();
  const isArabic = language === "ar-EG";
  const [rect, setRect] = useState<Rect | null>(null);
  const [searching, setSearching] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(200);

  // Find the target (waiting for the page to render it), bring it into view, and follow it.
  useEffect(() => {
    let element: HTMLElement | null = null;
    let frame = 0;
    const started = Date.now();
    setRect(null);
    setSearching(!!step.target);
    const measure = () => {
      if (!element || !element.isConnected) return setRect(null);
      const r = element.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const poll = window.setInterval(() => {
      element = findTarget(step.target);
      if (element || Date.now() - started > WAIT_MS || !step.target) {
        window.clearInterval(poll);
        setSearching(false);
        if (element) {
          element.scrollIntoView({ block: "center", behavior: "smooth" });
          measure();
        }
      }
    }, 100);
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.clearInterval(poll);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [step.id]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  });

  // Keyboard control; focus the card for screen readers and keyboard users.
  useEffect(() => {
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (
        e.key === (isArabic ? "ArrowLeft" : "ArrowRight") ||
        (e.key === "Enter" && document.activeElement === cardRef.current)
      )
        onNext();
      else if (e.key === (isArabic ? "ArrowRight" : "ArrowLeft") && index > 0) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step.id, isArabic, index]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - 2 * GAP);
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.top + rect.height + GAP;
    const above = rect.top - GAP - cardHeight;
    const beside = isArabic ? rect.left - GAP - width : rect.left + rect.width + GAP;
    const fitsBeside = rect.height > vh * 0.5 && beside >= GAP && beside + width <= vw - GAP;
    if (fitsBeside) cardStyle = { top: Math.min(Math.max(rect.top, GAP), vh - cardHeight - GAP), left: beside };
    else {
      const top = below + cardHeight <= vh - GAP ? below : above >= GAP ? above : Math.max(GAP, vh - cardHeight - GAP);
      const left = Math.min(Math.max(isArabic ? rect.left + rect.width - width : rect.left, GAP), vw - width - GAP);
      cardStyle = { top, left };
    }
  } else cardStyle = { top: Math.max(GAP, (vh - cardHeight) / 2), left: (vw - width) / 2 };

  const t = (text: { en: string; ar: string }) => (isArabic ? text.ar : text.en);
  const last = index + 1 === total;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[1000]" dir={isArabic ? "rtl" : "ltr"}>
      {rect ? (
        <div
          className="absolute rounded-lg ring-2 ring-primary-400 transition-all duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="pointer-events-auto absolute rounded-xl border border-gray-200 bg-white p-4 text-gray-800 shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        style={{ ...cardStyle, width }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 id="tour-title" className="text-base font-semibold">
            {t(step.title)}
          </h3>
          <CloseButton size="sm" onClick={onClose} aria-label={translate("Close the tour", "إغلاق الجولة")} />
        </div>
        <p id="tour-body" className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300" aria-live="polite">
          {t(step.body)}
        </p>
        {searching && (
          <p className="mt-2 text-xs text-gray-400">{translate("Loading this page...", "جاري تحميل الصفحة...")}</p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {translate(`Step ${index + 1} of ${total}`, `الخطوة ${index + 1} من ${total}`)}
          </span>
          <div className="flex gap-1.5">
            {!last && (
              <Button size="xs" variant="subtle" color="gray" onClick={onClose}>
                {translate("Skip", "تخطي")}
              </Button>
            )}
            {index > 0 && (
              <Button size="xs" variant="default" onClick={onBack}>
                {translate("Back", "السابق")}
              </Button>
            )}
            <Button size="xs" onClick={onNext}>
              {last ? translate("Finish", "إنهاء") : translate("Next", "التالي")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
