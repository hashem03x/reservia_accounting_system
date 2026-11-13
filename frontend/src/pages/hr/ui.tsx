import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { Button, Drawer as MDrawer } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import SharedModal from "@/components/ui/modal";
import { mAdd, mLabel, useHr } from "./hr-context";

// Reservia HR Portal - small building blocks with the reference prototype's own class names (pill,
// kpi, panel, tablewrap, drawer, modal...), styled by hr.css.

export const Pill = ({ c = "", children }: { c?: string; children: ReactNode }) => <span className={`pill ${c}`}>{children}</span>;

export function Kpi({ label, value, sub, alert }: { label: string; value: ReactNode; sub?: ReactNode; alert?: boolean }) {
  return (
    <div className={`kpi ${alert ? "alert" : ""}`}>
      <label>{label}</label>
      <b>{value}</b>
      <small>{sub || " "}</small>
    </div>
  );
}

export function MonthBar() {
  const { month, setMonth } = useHr();
  return (
    <div className="mnav">
      <button className="btn sm" aria-label="Previous month" onClick={() => setMonth(mAdd(month, -1))}>
        &lsaquo;
      </button>
      <b data-testid="hr-month">{mLabel(month)}</b>
      <button className="btn sm" aria-label="Next month" onClick={() => setMonth(mAdd(month, 1))}>
        &rsaquo;
      </button>
    </div>
  );
}

export function Top({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="top">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {text}
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

export function Panel({ title, small, children }: { title?: ReactNode; small?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      {title && (
        <h2>
          {title} {small !== undefined && <small>{small}</small>}
        </h2>
      )}
      {children}
    </div>
  );
}

/**
 * Side drawer for records (prototype wrapDrawer) - Mantine's Drawer, like every other dashboard, with
 * the shared modal's header treatment. Content sits in an .hr-app block because Mantine renders
 * overlays outside the page (portal), and the HR layout rules are scoped to .hr-app.
 */
export function Drawer({ title, sub, onClose, children }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  const { translate } = useLanguage();
  return (
    <MDrawer opened onClose={onClose} position={translate("right", "left") as "right" | "left"} size="lg" withCloseButton={false} padding={0}>
      <div className="hr-app hr-dialog flex flex-col gap-4 p-5">
        <DialogHeader title={title} sub={sub} onClose={onClose} />
        {children}
      </div>
    </MDrawer>
  );
}

/** Centred dialog (prototype wrapModal) - the shared ERP modal (components/ui/modal). */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <SharedModal opened onClose={onClose} size="lg">
      <div className="hr-app hr-dialog flex flex-col gap-4">
        <DialogHeader title={title} onClose={onClose} />
        {children}
      </div>
    </SharedModal>
  );
}

function DialogHeader({ title, sub, onClose }: { title: string; sub?: ReactNode; onClose: () => void }) {
  const { translate } = useLanguage();
  return (
    <div className="flex items-start gap-3 border-b border-line pb-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <Button variant="default" size="xs" onClick={onClose}>
        {translate("Close", "إغلاق")}
      </Button>
    </div>
  );
}

/* ---------- form fields: a single object of values, edited in place ---------- */
/** One form's values: a heterogeneous bag of strings, numbers, booleans and lists, validated by the API. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FormVals = Record<string, any>;
export function useFormVals(init: FormVals) {
  const [v, setV] = useState<FormVals>(init);
  const set = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }));
  return { v, set, setV };
}

export function Inp({ label, k, f, type = "text", full, ...rest }: { label: string; k: string; f: ReturnType<typeof useFormVals>; type?: string; full?: boolean; placeholder?: string; min?: number; max?: number; step?: string; disabled?: boolean }) {
  return (
    <label className={full ? "full" : undefined}>
      {label}
      <input
        type={type}
        value={f.v[k] ?? ""}
        onChange={(e) => f.set(k, type === "number" ? (e.target.value === "" ? "" : +e.target.value) : e.target.value)}
        data-testid={`f-${k}`}
        {...rest}
      />
    </label>
  );
}

export function Sel({ label, k, f, opts, full, disabled }: { label: string; k: string; f: ReturnType<typeof useFormVals>; opts: (string | [string, string])[]; full?: boolean; disabled?: boolean }) {
  return (
    <label className={full ? "full" : undefined}>
      {label}
      <select value={f.v[k] ?? ""} onChange={(e) => f.set(k, e.target.value)} disabled={disabled} data-testid={`f-${k}`}>
        {opts.map((o) => {
          const [val, txt] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={val} value={val}>
              {txt}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function Chk({ label, k, f, full }: { label: string; k: string; f: ReturnType<typeof useFormVals>; full?: boolean }) {
  return (
    <label className={`chk ${full ? "full" : ""}`}>
      <input type="checkbox" checked={!!f.v[k]} onChange={(e) => f.set(k, e.target.checked)} data-testid={`f-${k}`} /> {label}
    </label>
  );
}

export function Txt({ label, k, f, placeholder }: { label: string; k: string; f: ReturnType<typeof useFormVals>; placeholder?: string }) {
  return (
    <label className="full">
      {label}
      <textarea value={f.v[k] ?? ""} placeholder={placeholder} onChange={(e) => f.set(k, e.target.value)} data-testid={`f-${k}`} />
    </label>
  );
}

/** A delete button that asks for a second click (prototype "Click again to delete"). */
export function ArmedButton({ label = "Delete", armed = "Click again to delete", onConfirm, className = "btn danger" }: { label?: string; armed?: string; onConfirm: () => void; className?: string }) {
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 3000);
    return () => clearTimeout(t);
  }, [arm]);
  return (
    <button className={className} onClick={() => (arm ? onConfirm() : setArm(true))}>
      {arm ? armed : label}
    </button>
  );
}

export const SL: Record<string, [string, string]> = { ok: ["Valid", "good"], soon: ["Due soon", "warn"], exp: ["Expired", "bad"], miss: ["Missing", "bad0"], na: ["n/a", ""] };
export const SL_ICON: Record<string, string> = { ok: "✓", soon: "!", exp: "×", miss: "–", na: "n/a" };
export const statusPill = (s: string) => <Pill c={s === "Approved" ? "good" : s === "Rejected" ? "bad" : "warn"}>{s}</Pill>;
export const monthOf = (d?: string) => String(d || "").slice(0, 7);
export { mLabel };

/* ---------- which drawer or modal is open (prototype `modal`) ---------- */
export type ModalSpec = { type: string; id?: string; empId?: string; k?: string; ft?: string; course?: string } | null;
export const ModalCtx = createContext<{ modal: ModalSpec; open: (m: ModalSpec) => void; close: () => void; go: (view: string, extra?: Record<string, string>) => void }>({ modal: null, open: () => {}, close: () => {}, go: () => {} });
export const useModal = () => useContext(ModalCtx);
