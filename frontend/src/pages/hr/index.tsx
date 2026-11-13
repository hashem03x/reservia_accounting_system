import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import paths from "@/utils/constants/paths";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import AppShell, { NavSection } from "@/components/global/app-shell";
import { outlineIcons } from "@/components/icons";
import { systemRoleLabel } from "@/utils/constants/system-roles";
import "./hr.css";
import { HrProvider, HrRole, useHr } from "./hr-context";
import { ModalCtx, ModalSpec } from "./ui";
import { AssetModal, Assets, CandModal, DocModal, Docs, EmployeeDrawer, Hire, Home, Org, People, usePendingCount } from "./views-people";
import { Attendance, ExpenseModal, Expenses, Leave, Timesheets, VisitModal, Visits } from "./views-time";
import { Erp, PayDrawer, Payroll, Reports } from "./views-pay";
import { Approvals, FormModal, Forms, PerfModal, Performance, Policy, Settings, Training, TrainingModal } from "./views-admin";

// Reservia HR Portal (HR Portal Developer Spec, 11 Nov 2026). The shared app shell (the ERP's sidebar,
// phone header and drawer) with the prototype's grouped sections; the screens keep the prototype's
// layouts, drawn with the platform design system (hr.css). The HR membership's role decides what is
// shown; the API enforces the same rules.

type View = { k: string; en: string; ar: string; g: string; roles: HrRole[]; Icon: (typeof outlineIcons)[keyof typeof outlineIcons] };
const ALL: HrRole[] = ["md", "hr", "manager", "finance"];
const ED: HrRole[] = ["md", "hr"];
const TIME: HrRole[] = ["md", "hr", "manager"];
const PAY: HrRole[] = ["md", "hr", "finance"];
const GROUPS: Record<string, [string, string]> = {
  home: ["Home", "الرئيسية"],
  people: ["People", "الأفراد"],
  time: ["Time and travel", "الوقت والسفر"],
  talent: ["Talent", "المواهب"],
  pay: ["Pay", "الأجور"],
  admin: ["Admin", "الإدارة"],
};
const VIEWS: View[] = [
  { k: "home", en: "Overview", ar: "نظرة عامة", g: "home", roles: ALL, Icon: outlineIcons.Home },
  { k: "appr", en: "Approvals", ar: "الموافقات", g: "home", roles: ALL, Icon: outlineIcons.ShieldCheck },
  { k: "people", en: "People", ar: "الموظفون", g: "people", roles: ALL, Icon: outlineIcons.Users },
  { k: "org", en: "Org chart", ar: "الهيكل التنظيمي", g: "people", roles: ALL, Icon: outlineIcons.Compass },
  { k: "docs", en: "Documents", ar: "المستندات", g: "people", roles: ED, Icon: outlineIcons.Document },
  { k: "hire", en: "Hiring", ar: "التوظيف", g: "people", roles: ED, Icon: outlineIcons.UserCircle },
  { k: "assets", en: "Assets", ar: "العهد", g: "people", roles: ED, Icon: outlineIcons.Computer },
  { k: "att", en: "Attendance", ar: "الحضور", g: "time", roles: TIME, Icon: outlineIcons.Clock },
  { k: "ts", en: "Timesheets", ar: "سجلات الدوام", g: "time", roles: TIME, Icon: outlineIcons.Document },
  { k: "leave", en: "Leave balances", ar: "أرصدة الإجازات", g: "time", roles: TIME, Icon: outlineIcons.Clock },
  { k: "visit", en: "Site visits", ar: "الزيارات الميدانية", g: "time", roles: TIME, Icon: outlineIcons.Compass },
  { k: "exp", en: "Expenses", ar: "المصروفات", g: "time", roles: TIME, Icon: outlineIcons.Transaction },
  { k: "train", en: "Training", ar: "التدريب", g: "talent", roles: ED, Icon: outlineIcons.ShieldCheck },
  { k: "perf", en: "Performance", ar: "الأداء", g: "talent", roles: ED, Icon: outlineIcons.ChartBar },
  { k: "pay", en: "Payroll", ar: "الرواتب", g: "pay", roles: PAY, Icon: outlineIcons.DollarSign },
  { k: "erp", en: "ERP link", ar: "الربط مع ERP", g: "pay", roles: PAY, Icon: outlineIcons.Globe },
  { k: "reports", en: "Reports", ar: "التقارير", g: "pay", roles: PAY, Icon: outlineIcons.ChartBar },
  { k: "forms", en: "Forms", ar: "النماذج", g: "admin", roles: TIME, Icon: outlineIcons.Edit },
  { k: "policy", en: "Policy", ar: "السياسة", g: "admin", roles: ALL, Icon: outlineIcons.Document },
  { k: "set", en: "Settings", ar: "الإعدادات", g: "admin", roles: ED, Icon: outlineIcons.Admin },
];

export default function HrPortal() {
  return (
    <HrProvider>
      <HrShell />
    </HrProvider>
  );
}

function HrShell() {
  const { state, error, loading } = useHr();
  const { translate } = useLanguage();
  const navigate = useNavigate();
  const params = useParams();
  const [search] = useSearchParams();
  const [modal, setModal] = useState<ModalSpec>(null);
  const role = state?.role;
  const visible = useMemo(() => VIEWS.filter((v) => !role || v.roles.includes(role)), [role]);
  const view = visible.some((v) => v.k === params.view) ? (params.view as string) : "home";
  const current = VIEWS.find((v) => v.k === view);
  useDocumentTitle(`HR - ${current?.en || "Overview"}`);
  const pend = usePendingCount();

  const go = useCallback(
    (v: string, extra?: Record<string, string>) => {
      setModal(extra?.new ? { type: "emp" } : null);
      const q = extra && !extra.new ? `?${new URLSearchParams(extra).toString()}` : "";
      navigate(`/${paths.hr}/${v}${q}`);
    },
    [navigate]
  );
  const ctx = useMemo(() => ({ modal, open: setModal, close: () => setModal(null), go }), [modal, go]);

  const people = state?.employees.filter((e) => e.status !== "Left").length;
  const hiring = state?.candidates.filter((c) => c.stage !== "Hired" && c.stage !== "Rejected").length;
  const sections: NavSection[] = useMemo(
    () =>
      Object.keys(GROUPS)
        .map((g) => ({
          key: `hr-${g}`,
          title: translate(GROUPS[g][0], GROUPS[g][1]),
          items: visible
            .filter((v) => v.g === g)
            .map((v) => ({
              key: `hr-${v.k}`,
              // Overview is the section root, so /hr and /hr/home both select it.
              to: v.k === "home" ? `/${paths.hr}` : `/${paths.hr}/${v.k}`,
              label: translate(v.en, v.ar),
              Icon: v.Icon,
              testId: `hr-nav-${v.k}`,
              badge: v.k === "people" ? people : v.k === "hire" ? hiring : v.k === "appr" ? pend : undefined,
            })),
        }))
        .filter((s) => s.items.length),
    [visible, translate, people, hiring, pend]
  );

  return (
    <ModalCtx.Provider value={ctx}>
      <AppShell sections={sections} subtitle={translate("HR Portal", "بوابة الموارد البشرية")} scope="hr" roleLabel={systemRoleLabel("HR", role, translate)} navTestId="hr-nav">
        <div className="hr-app" data-testid="hr-app">
          <div className="main">
            {error && !state && <div className="banner">{error}</div>}
            {loading && !state && <div className="sub">{translate("Loading...", "جار التحميل...")}</div>}
            {state && <ViewBody view={view} emp={search.get("emp") || undefined} />}
          </div>
          {state && <ModalHost modal={modal} />}
        </div>
      </AppShell>
    </ModalCtx.Provider>
  );
}

function ViewBody({ view, emp }: { view: string; emp?: string }) {
  switch (view) {
    case "appr":
      return <Approvals />;
    case "people":
      return <People />;
    case "org":
      return <Org />;
    case "docs":
      return <Docs />;
    case "hire":
      return <Hire />;
    case "assets":
      return <Assets />;
    case "att":
      return <Attendance />;
    case "ts":
      return <Timesheets key={emp || "ts"} initialEmp={emp} />;
    case "leave":
      return <Leave />;
    case "visit":
      return <Visits />;
    case "exp":
      return <Expenses />;
    case "train":
      return <Training />;
    case "perf":
      return <Performance />;
    case "pay":
      return <Payroll />;
    case "erp":
      return <Erp />;
    case "reports":
      return <Reports />;
    case "forms":
      return <Forms />;
    case "policy":
      return <Policy />;
    case "set":
      return <Settings />;
    default:
      return <Home />;
  }
}

function ModalHost({ modal }: { modal: ModalSpec }) {
  if (!modal) return null;
  const k = `${modal.type}-${modal.id || "new"}-${modal.empId || ""}-${modal.k || ""}-${modal.ft || ""}`;
  switch (modal.type) {
    case "emp":
      return <EmployeeDrawer key={k} id={modal.id} />;
    case "doc":
      return <DocModal key={k} id={modal.id as string} k={modal.k || ""} />;
    case "cand":
      return <CandModal key={k} id={modal.id} />;
    case "ast":
      return <AssetModal key={k} id={modal.id} empId={modal.empId} />;
    case "vis":
      return <VisitModal key={k} id={modal.id} empId={modal.empId} />;
    case "exp":
      return <ExpenseModal key={k} id={modal.id} empId={modal.empId} />;
    case "pay":
      return <PayDrawer key={k} id={modal.id as string} />;
    case "frm":
      return <FormModal key={k} id={modal.id} ft={modal.ft} empId={modal.empId} />;
    case "trn":
      return <TrainingModal key={k} id={modal.id} empId={modal.empId} course={modal.course} />;
    case "perf":
      return <PerfModal key={k} id={modal.id} />;
    default:
      return null;
  }
}
