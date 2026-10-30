// Shared lead-display helpers for every Reservia CRM page that renders a lead (pipeline board,
// pipeline list view, leads list, the New Lead modal) - one place so channel/segment vocabulary,
// "is this lead overdue", and the stage-transition extra-field rules can never drift between
// pages. Mirrors backend/server/utils/crm/constants.js (labels) and
// backend/server/utils/crm/stageRules.js (extra-field/terminal rules) exactly - the backend is
// still the only place these rules are ENFORCED; everything here is UI convenience/preview only.
//
// Pure (no React, no requests, no `@/` alias imports) and loosely/duck-typed on purpose, matching
// account-parent-groups.ts's own convention - this is what lets it run directly under
// `node --test` (see package.json#test:unit), which resolves plain relative imports only.

export const CHANNEL_LABELS: Record<string, { en: string; ar: string }> = {
  phone: { en: "Phone", ar: "هاتف" },
  walk_in: { en: "Walk-in", ar: "زيارة مباشرة" },
  dealer: { en: "Dealer / partner", ar: "موزع / شريك" },
  referral: { en: "Referral", ar: "ترشيح" },
  event: { en: "Event", ar: "فعالية" },
  outreach: { en: "Outreach", ar: "تواصل مباشر" },
  email: { en: "Email", ar: "بريد إلكتروني" },
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  web_form: { en: "Website form", ar: "نموذج الموقع" },
  landing_page: { en: "Landing page", ar: "صفحة هبوط" },
};

export const SEGMENT_LABELS: Record<string, { en: string; ar: string }> = {
  villa: { en: "Villa", ar: "فيلا" },
  compound: { en: "Compound", ar: "كمبوند" },
  farm: { en: "Farm", ar: "مزرعة" },
  oil_gas: { en: "Oil & gas", ar: "نفط وغاز" },
  factory: { en: "Factory", ar: "مصنع" },
  services: { en: "Services", ar: "خدمات" },
  other: { en: "Other", ar: "أخرى" },
  unknown: { en: "Unknown", ar: "غير محدد" },
};

type Translate = (en: string, ar: string) => string;

export const channelLabel = (translate: Translate) => (channel: string) => {
  const entry = CHANNEL_LABELS[channel];
  return entry ? translate(entry.en, entry.ar) : channel;
};

export const segmentLabel = (translate: Translate) => (segment: string) => {
  const entry = SEGMENT_LABELS[segment];
  return entry ? translate(entry.en, entry.ar) : segment;
};

type LeadLike = { firstReplyAt: string | null; replyDueAt: string };

// A lead is overdue the moment its first-human-reply SLA clock (replyDueAt) has passed without a
// first reply ever being logged - never inferred from createdAt/stageChangedAt, matching the
// backend's own rule (services/crm/leadService.js) exactly.
export const isLeadOverdue = (lead: LeadLike) => !lead.firstReplyAt && new Date(lead.replyDueAt).getTime() < Date.now();

// Up to two initials from a display name, for the compact owner avatar. "-" (never blank) when
// there is no name to take initials from, so the avatar circle is never visually empty.
export function ownerInitials(name: string | undefined | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "-";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A short "time since" label ("2d ago", "just now") - deliberately coarse, not a full i18n library. */
export function timeAgo(date: string | Date, language: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const ar = language.startsWith("ar");
  if (diff < MINUTE) return ar ? "الآن" : "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return ar ? `منذ ${m} د` : `${m}m ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return ar ? `منذ ${h} س` : `${h}h ago`;
  }
  const d = Math.floor(diff / DAY);
  if (d < 30) return ar ? `منذ ${d} يوم` : `${d}d ago`;
  const months = Math.floor(d / 30);
  return ar ? `منذ ${months} شهر` : `${months}mo ago`;
}

// Mirrors backend/server/utils/crm/stageRules.js's MD_APPROVAL_THRESHOLD_EGP - display only (e.g.
// a hint in the Won confirmation step); the backend is still the one place this is enforced.
export const MD_APPROVAL_THRESHOLD_EGP = 1_000_000;

/**
 * Which extra fields a stage change needs before it can be submitted - the EXACT same conditions
 * leads/[id]/index.tsx#StageChangeCard already uses, extracted here so the pipeline board's
 * quick-stage-change flow (menu or drag-and-drop) asks for the same information instead of a
 * second, driftable copy of this logic.
 */
export function stageExtraFieldRequirements(to: string) {
  return {
    needsLostReason: to === "lost",
    needsValue: to === "won",
    needsFollowUp: !["new", "contacted", "won", "lost", ""].includes(to),
  };
}

// A lead sitting in 'won' is done - backend/server/utils/crm/stageRules.js refuses to move it
// anywhere else ("A won deal cannot change stage. Open a new lead for new work."). Used to make a
// Won card simply not draggable, rather than letting a drag start and fail on drop.
export const isTerminalStage = (stage: string) => stage === "won";

/**
 * A fast, NECESSARILY INCOMPLETE client-side check for "could this possibly be a valid drop
 * target" - used only to dim obviously-impossible columns while dragging (same stage, or
 * anywhere other than Contacted when leaving Lost). It deliberately does NOT attempt to replicate
 * the one-stage-back-at-a-time rule, the EGP 1M MD-approval gate, or the technical role's
 * restricted destinations - those depend on fields (role, existing value, MD approval state) this
 * preview does not have the full picture of, and a stale/wrong "looks valid" hint would be worse
 * than none. The backend (services/crm/leadService.js#changeStage) is the real, final check on
 * every drop; a rejected drop reverts the card and shows the backend's own error message.
 */
export function isObviouslyInvalidDropTarget(from: string, to: string): boolean {
  if (from === to) return true;
  if (isTerminalStage(from)) return true;
  if (from === "lost" && to !== "contacted") return true;
  return false;
}
