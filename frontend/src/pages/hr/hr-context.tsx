import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { useLanguage } from "@/context/LanguageContext";

// Reservia HR Portal - one month snapshot from GET /hr/state (the backend computes every figure with
// the payroll engine; the screens only display and send changes), plus the helpers every view uses.

export type HrRole = "md" | "hr" | "manager" | "finance";
export type DayRec = {
  date: string; dow: number; emp: boolean; rest: boolean; hol: boolean; s: string; in: string; out: string; n: string;
  worked: number; ot: number; otN: number; sp: number; spT: string; late: number; inGrace: boolean; unrec: boolean; present: number;
};
export type Counts = { present: number; absent: number; uleave: number; leave: number; sick: number; unrec: number; emp: number; late: number; otD: number; otN: number; otF: number; otS: number; otH: number };
export type Employee = {
  _id: string; code: string; name: string; role: string; dept: string; status: string; type: string; hire: string; end: string; city: string; mgr: string;
  mgrId: string | null; user: string | null; phone?: string; email?: string; emg?: string; emgp?: string; file?: string; nat?: string; sin?: string; edu?: string;
  cno?: string; offerDate?: string; cstart?: string; cend?: string; probEnd?: string; paym?: string; insured: boolean;
  docs?: Record<string, { st: string; date?: string; exp?: string; loc?: string }>; exit?: { last?: string; reason?: string; steps?: Record<string, boolean> } | null; example?: boolean;
  basic?: number; transport?: number; incentive?: number; commission?: number; other?: number; insBase?: number;
};
export type PayRow = {
  id: string; name: string; code: string; dept: string; role: string; email: string; t: Counts; gross: number; fixed: number; basic: number; transport: number; incentive: number; other: number;
  comm: number; commBase: number; tgt: number | null; absDed: number; unpaidDays: number; lateDed: number; hr: number; otD: number; otN: number; otF: number; otS: number; otR: number; otH: number;
  otPay: number; site: number; reimb: number; nVisits: number; nExp: number; addTx: number; addNo: number; ded: number; insBase: number; insEmp: number; insEr: number; tax: number; net: number; earn: number; cost: number; otHours: number;
};
export type Visit = { _id: string; employee: string; date: string; city: string; site: string; purpose: string; status: string; days: number; nights: number; transport?: number; accom?: number; meals?: number; mealsProvided?: boolean; ref?: string; notes?: string; report?: string; zone: string; gc: boolean; pay?: { allow: number; pd: number; reimb: number; total: number }; example?: boolean };
export type Expense = { _id: string; employee: string; date: string; type: string; amount: number; payMonth: string; ref?: string; desc?: string; receipt: boolean; receiptOverride?: boolean; status: string; by?: string; note?: string; example?: boolean };
export type Form = { _id: string; ft: "leave" | "ot" | "visit"; employee: string; status: string; ltype?: string; from?: string; to?: string; days?: number; cover?: string; phone?: string; odate?: string; kind?: string; hours?: number; site?: string; city?: string; purpose?: string; nights?: number; back?: string; transport?: string; stay?: string; meals?: string; ref?: string; reason?: string; exception?: boolean; by?: string; decided?: string; dnote?: string; created?: string; example?: boolean };
export type Cfg = Record<string, unknown> & {
  stdHours: number; breakH: number; shiftStart: string; grace: number; graceTimes: number; lateDeduct: boolean; annualDays: number; workWeek: number[];
  otDay: number; otNight: number; otFri: number; otSat: number; otHol: number; nightFrom: number; nightTo: number; otBase: string; siteGC: number; siteOut: number; perDiem: number;
  insEmp: number; insEr: number; insMin: number; insMax: number; exemption: number; brackets: [number | null, number][]; siteTaxable: boolean; sickPaid: boolean; insBaseMode: string; commPro: boolean; reimbTaxable: boolean;
  hrName: string; mdName: string; erpName: string; erpUrl: string; erpCo: string; erpAuto: boolean; gl: Record<string, string>; holidays: string; cities: { n: string; z: string }[]; req: { n: string; m: number; d: string }[];
};
export type HrState = {
  month: string; today: string; role: HrRole; me: string | null; cfg: Cfg; cfgVersion: { effectiveMonth: string; at: string; byName: string } | null;
  lists: { DEPTS: string[]; EMP_STATUS: string[]; EMP_TYPE: string[]; PAY_METHODS: string[]; DOCS: { k: string; n: string; s: string; exp?: number }[]; STAGES: string[]; PURPOSES: string[]; VISIT_STATUS: string[]; ASSET_TYPES: string[]; EXPENSE_TYPES: string[]; CERT_KINDS: string[]; LEAVE_TYPES: string[]; OT_KINDS: string[] };
  employees: Employee[]; inMonth: string[];
  time: Record<string, { t: Counts; otHours: number; otD: number; otN: number; otR: number; otH: number; days: DayRec[]; approval: { at: string; byName: string } | null }>;
  visits: Visit[]; expenses: Expense[]; forms: Form[]; targets: { empId: string; pct: number }[]; adjustments: { _id: string; empId: string; label: string; type: string; amount: number; taxable: boolean }[];
  trainings: Training[]; assets: Asset[]; performance: Review[]; candidates: Candidate[];
  leave: { empId: string; ent: number; used: number; cas: number; sick: number; unp: number; pend: number; left: number }[];
  docStatus: Record<string, { score: number; docs: Record<string, string> }>; trnStatus: Record<string, Record<string, { s: string; exp: string }>>;
  payroll: { status: "draft" | "review" | "approved" | "closed"; log: { s: string; byName: string; at: string; note: string }[]; erp: { at: string; ok: boolean; status?: number; reference?: string; error?: string; byName?: string } | null; version: number; frozen: boolean; rows: PayRow[]; issues: { level: string; view: string; text: string }[] };
  history: { month: string; net: number; cost: number; ot: number; site: number; n: number; closed: boolean }[];
  canSeePay: boolean;
};

export type Training = { _id: string; employee: string; kind?: string; course: string; provider?: string; date: string; hours?: number; exp?: string; cost?: number; cert?: boolean; example?: boolean };
export type Asset = { _id: string; employee: string; type: string; desc?: string; serial?: string; issued?: string; returned?: string; cond?: string; value?: number; note?: string; example?: boolean };
export type Review = { _id: string; employee: string; cycle?: string; date?: string; by?: string; goals: { t: string; w: number; s: number }[]; rating?: number; note?: string; example?: boolean };
export type Candidate = { _id: string; name: string; role?: string; dept?: string; stage: string; src?: string; phone?: string; email?: string; offer?: number; start?: string; notes?: string; employee?: string; example?: boolean };
/** API responses carry `data` of the endpoint's own shape (see backend/server/controller/hr). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiResult = { data: any; message?: string };

type Ctx = {
  state: HrState | null;
  loading: boolean;
  error: string;
  month: string;
  setMonth: (m: string) => void;
  reload: () => Promise<void>;
  call: (method: string, url: string, data?: unknown) => Promise<ApiResult>;
  download: (url: string, filename?: string) => Promise<void>;
  openPdf: (url: string) => Promise<void>;
  toast: (t: string) => void;
  toastText: string;
  wantHistory: (on: boolean) => void;
};

const HrContext = createContext<Ctx | null>(null);
export const useHr = () => {
  const c = useContext(HrContext);
  if (!c) throw new Error("useHr outside HrProvider");
  return c;
};

const currentMonth = () => new Date().toISOString().slice(0, 7);
const readMonth = () => {
  try {
    return localStorage.getItem("rhr_month") || currentMonth();
  } catch {
    return currentMonth();
  }
};

export function HrProvider({ children }: { children: ReactNode }) {
  const privateRequest = usePrivateRequest();
  const { language } = useLanguage();
  const [state, setState] = useState<HrState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonthRaw] = useState(readMonth);
  const [toastText, setToastText] = useState("");
  const [history, setHistory] = useState(false);
  const timer = useRef<number>();
  const seq = useRef(0);

  const toast = useCallback((t: string) => {
    setToastText(t);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastText(""), 2800);
  }, []);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await privateRequest({ url: "hr/state", params: { month, ...(history ? { history: 1 } : {}) }, language });
      if (mine === seq.current) {
        setState(res.data as HrState);
        setError("");
      }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message || "Could not load the HR Portal.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, history, language]);

  useEffect(() => {
    reload();
  }, [reload]);

  const setMonth = (m: string) => {
    setMonthRaw(m);
    try {
      localStorage.setItem("rhr_month", m);
    } catch {
      /* per-viewer convenience only */
    }
  };

  /** Sends a change, then reloads the month. Errors are shown as a toast and re-thrown. */
  const call = async (method: string, url: string, data?: unknown) => {
    try {
      const res = await privateRequest({ url: `hr/${url}`, method, data: data === undefined ? null : data, language });
      await reload();
      return res as ApiResult;
    } catch (e) {
      toast((e as Error).message || "Could not save.");
      throw e;
    }
  };

  const download = async (url: string, filename?: string) => {
    try {
      await privateRequest({ url: `hr/${url}`, language, download: true, filename });
    } catch (e) {
      toast((e as Error).message || "Download failed.");
    }
  };

  /** Opens a PDF in a new tab (opened first so a popup blocker allows it), else downloads it. */
  const openPdf = async (url: string) => {
    const tab = window.open("", "_blank");
    try {
      const res = (await privateRequest({ url: `hr/${url}`, language, responseType: "blob" })) as { blob: Blob; filename: string };
      const objectUrl = URL.createObjectURL(res.blob);
      if (tab) tab.location.href = objectUrl;
      else {
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = res.filename;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      tab?.close();
      toast((e as Error).message || "Could not open the PDF.");
    }
  };

  return (
    <HrContext.Provider value={{ state, loading, error, month, setMonth, reload, call, download, openPdf, toast, toastText, wantHistory: setHistory }}>
      {children}
    </HrContext.Provider>
  );
}

/* ---------- formatting (the prototype's helpers) ---------- */
export const fmt = (n: number | null | undefined) => Math.round(n || 0).toLocaleString("en-US");
export const r1 = (n: number | null | undefined) => Math.round((n || 0) * 10) / 10;
export const r2 = (n: number | null | undefined) => Math.round((n || 0) * 100) / 100;
export const MN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const pad = (n: number) => (n < 10 ? "0" : "") + n;
export const mLabel = (m: string) => `${MN[+m.split("-")[1] - 1]} ${m.split("-")[0]}`;
export function mAdd(m: string, k: number) {
  const p = m.split("-");
  const d = new Date(+p[0], +p[1] - 1 + k, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const daysIn = (m: string) => new Date(+m.split("-")[0], +m.split("-")[1], 0).getDate();
export function dAdd(s: string, k: number) {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + k);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const diffDays = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 864e5);
export const ATT = [
  { k: "P", n: "Present", c: "good" }, { k: "V", n: "Site visit", c: "info" }, { k: "A", n: "Absent (unpaid)", c: "bad" }, { k: "L", n: "Annual leave", c: "warn" },
  { k: "S", n: "Sick leave", c: "warn" }, { k: "U", n: "Unpaid leave", c: "bad" }, { k: "W", n: "Worked on rest day", c: "info" }, { k: "H", n: "Worked on public holiday", c: "info" },
];
export const ATTN: Record<string, (typeof ATT)[number]> = Object.fromEntries(ATT.map((a) => [a.k, a]));
export const grossOf = (e: Partial<Employee>) => (+(e.basic || 0)) + (+(e.transport || 0)) + (+(e.incentive || 0)) + (+(e.other || 0));
export const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + (+f(r) || 0), 0);
export const canEdit = (role?: HrRole) => role === "md" || role === "hr";
