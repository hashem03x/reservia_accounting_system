import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { canDecideHr, canEdit, DN, fmt, Form, mLabel, r1, sum, useHr, canActOn } from "./hr-context";
import { ArmedButton, Chk, Empty, Inp, Kpi, Modal, MonthBar, Panel, Pill, Sel, SL, slText, SL_ICON, statusPill, Top, Txt, useFormVals, useModal } from "./ui";
import { probationSoon, useEmp, usePendingCount } from "./views-people";

// Reservia HR Portal - Approvals, Forms (HR-F01 to F06), Training, Performance, Policy and Settings:
// the reference prototype's vAppr, vForms/frmModal, vTrain, vPerf, vPolicy and vSet.

type Translate = (en: string, ar: string) => string;

const FT_DATA: Record<string, { c: string; tEn: string; tAr: string; dEn: string; dAr: string }> = {
  leave: { c: "HR-F01", tEn: "Leave request", tAr: "طلب إجازة", dEn: "Annual, casual, sick, unpaid, maternity or paternity leave.", dAr: "إجازة سنوية أو عارضة أو مرضية أو بدون مرتب أو وضع أو أبوة." },
  ot: { c: "HR-F02", tEn: "Overtime and rest-day approval", tAr: "اعتماد العمل الإضافي ويوم الراحة", dEn: "Written approval before overtime, Friday, Saturday or holiday work starts.", dAr: "موافقة كتابية قبل بدء العمل الإضافي أو العمل يوم الجمعة أو السبت أو العطلة الرسمية." },
  visit: { c: "HR-F03", tEn: "Site visit request", tAr: "طلب زيارة ميدانية", dEn: "Manager approval before any site visit or domestic trip.", dAr: "موافقة المدير قبل أي زيارة ميدانية أو رحلة داخلية." },
  hire: { c: "HR-F05", tEn: "New hire checklist", tAr: "قائمة تعيين موظف جديد", dEn: "Documents that must be on file before day 1, pulled from the personnel file.", dAr: "المستندات التي يجب توافرها قبل اليوم الأول، من ملف شؤون الموظف." },
  exit: { c: "HR-F06", tEn: "Exit clearance", tAr: "إخلاء طرف نهاية الخدمة", dEn: "Twelve steps from notice to the closed file.", dAr: "اثنتا عشرة خطوة من الإشعار حتى إغلاق الملف." },
};
function ftMap(translate: Translate): Record<string, { c: string; t: string; d: string }> {
  const out: Record<string, { c: string; t: string; d: string }> = {};
  Object.entries(FT_DATA).forEach(([k, v]) => {
    out[k] = { c: v.c, t: translate(v.tEn, v.tAr), d: translate(v.dEn, v.dAr) };
  });
  return out;
}

const EXIT_STEPS_DATA: [string, string, string, string][] = [
  ["Written notice received (3 months, open-ended contract)", "تم استلام الإشعار الكتابي (3 أشهر، عقد غير محدد المدة)", "Employee or HR", "الموظف أو الموارد البشرية"],
  ["Handover plan: projects, bids, drawings, client contacts, passwords", "خطة التسليم: المشروعات، العروض، المخططات، جهات اتصال العميل، كلمات المرور", "Line manager", "المدير المباشر"],
  ["Handover note and file index signed", "توقيع مذكرة التسليم وفهرس الملف", "Employee and successor", "الموظف والخلف"],
  ["Exit interview form completed", "استكمال نموذج مقابلة ترك الخدمة", "HR", "الموارد البشرية"],
  ["Assets returned: laptop, phone, ID, keys, PPE, vehicle, SIM, site cards", "إعادة العهد: الكمبيوتر المحمول، الهاتف، البطاقة، المفاتيح، معدات الحماية، السيارة، الشريحة، بطاقات الموقع", "Employee and IT", "الموظف وتقنية المعلومات"],
  ["Email, ERP, CRM and shared drive access closed", "إغلاق الوصول إلى البريد ونظام تخطيط الموارد وإدارة علاقات العملاء والمحرك المشترك", "IT", "تقنية المعلومات"],
  ["Clearance signed by line manager, IT, finance and HR", "توقيع إخلاء الطرف من المدير المباشر وتقنية المعلومات والمالية والموارد البشرية", "HR", "الموارد البشرية"],
  ["Final settlement: salary, unused leave at daily wage, overtime, allowances, less advances", "التسوية النهائية: الراتب، الإجازات غير المستخدمة بالأجر اليومي، العمل الإضافي، البدلات، بعد خصم السلف", "Finance", "المالية"],
  ["Exit form sent to the Social Insurance Authority", "إرسال نموذج ترك الخدمة إلى الهيئة القومية للتأمين الاجتماعي", "HR", "الموارد البشرية"],
  ["Experience certificate issued (within 15 days of request)", "إصدار شهادة الخبرة (خلال 15 يومًا من الطلب)", "HR", "الموارد البشرية"],
  ["NDA reminder letter sent", "إرسال خطاب تذكير باتفاقية السرية", "HR", "الموارد البشرية"],
  ["Employee file closed and kept 5 years", "إغلاق ملف الموظف والاحتفاظ به 5 سنوات", "HR", "الموارد البشرية"],
];
function exitSteps(translate: Translate): [string, string][] {
  return EXIT_STEPS_DATA.map((x) => [translate(x[0], x[1]), translate(x[2], x[3])]);
}

export function frmSummary(f: Form, translate: Translate) {
  if (f.ft === "leave") return translate(`${f.ltype}, ${f.from} to ${f.to} (${f.days || 0} working days)`, `${f.ltype}، من ${f.from} إلى ${f.to} (${f.days || 0} يوم عمل)`);
  if (f.ft === "ot") return translate(`${f.kind} on ${f.odate}, ${f.hours || 0} h${f.site ? `, ${f.site}` : ""}${f.exception ? " (after the fact)" : ""}`, `${f.kind} بتاريخ ${f.odate}، ${f.hours || 0} س${f.site ? `، ${f.site}` : ""}${f.exception ? " (بعد حدوثه)" : ""}`);
  if (f.ft === "visit") return translate(`${f.city}, ${f.site}, from ${f.from} (${f.days || 1} d)`, `${f.city}، ${f.site}، من ${f.from} (${f.days || 1} يوم)`);
  return "";
}

/* ===================== Approvals ===================== */
export function Approvals() {
  const { state } = useHr();
  const { translate } = useLanguage();
  const { open, go } = useModal();
  const byId = useEmp();
  usePendingCount();
  if (!state) return null;
  const FT = ftMap(translate);
  const F2 = state.forms.filter((f) => f.status === "Pending").sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
  const X = state.expenses.filter((x) => x.status === "Pending");
  const unap = state.inMonth.filter((id) => !state.time[id]?.approval);
  const st = state.payroll.status;
  return (
    <>
      <Top title={translate("Approvals", "الموافقات")}>
        <MonthBar />
      </Top>
      <div className="kpis">
        <Kpi label={translate("Forms waiting", "نماذج في الانتظار")} value={F2.length} sub={translate("leave, overtime, visits", "إجازات، عمل إضافي، زيارات")} alert={!!F2.length} />
        <Kpi label={translate("Expense claims waiting", "مطالبات مصروفات في الانتظار")} value={X.length} sub={`${fmt(sum(X, (x) => x.amount))} ${translate("EGP", "جنيه")}`} alert={!!X.length} />
        <Kpi label={translate("Timesheets open", "سجلات دوام مفتوحة")} value={unap.length} sub={translate(`of ${state.inMonth.length} for ${mLabel(state.month)}`, `من ${state.inMonth.length} لشهر ${mLabel(state.month)}`)} />
        <Kpi label={translate("Payroll", "الرواتب")} value={st} sub={st === "review" ? translate("waiting for the MD", "في انتظار المدير العام") : st === "approved" ? translate("ready to close", "جاهز للإغلاق") : st === "closed" ? translate("locked", "مقفل") : translate("HR working", "الموارد البشرية تعمل عليه")} />
      </div>
      <Panel title={translate("How approval works", "آلية الموافقة")}>
        <div className="flow">
          <span className="on">{translate("Employee or HR enters", "الموظف أو الموارد البشرية يُدخل الطلب")}</span>
          <span>{translate("Line manager approves forms, claims and timesheets", "المدير المباشر يوافق على النماذج والمطالبات وسجلات الدوام")}</span>
          <span>{translate("HR prepares payroll and submits", "الموارد البشرية تُحضّر الرواتب وترسلها")}</span>
          <span>{translate("MD approves", "المدير العام يوافق")}</span>
          <span>{translate("HR closes, pays and posts to ERP", "الموارد البشرية تُغلق وتدفع وتُرحّل إلى نظام تخطيط الموارد")}</span>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          {translate("Each approval is stamped with your portal name. Forms and claims are decided inside the item; payroll stages are on the Payroll page.", "تُسجَّل كل موافقة باسمك في البوابة. تُحسم النماذج والمطالبات داخل العنصر نفسه؛ أما مراحل الرواتب فتكون في صفحة الرواتب.")}
        </div>
      </Panel>
      <div className="grid2">
        <Panel title={translate("Forms waiting", "نماذج في الانتظار")} small={F2.length}>
          {F2.length ? (
            <div className="todo">
              {F2.map((f) => (
                <button key={f._id} onClick={() => open({ type: "frm", id: f._id, ft: f.ft })} data-testid={`appr-form-${f._id}`}>
                  <Pill c="warn">{FT[f.ft].t}</Pill>
                  <span className="who">
                    {byId[f.employee]?.name}: {frmSummary(f, translate)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="sub">{translate("Nothing waiting.", "لا يوجد شيء في الانتظار.")}</div>
          )}
        </Panel>
        <Panel title={translate("Expense claims waiting", "مطالبات مصروفات في الانتظار")} small={X.length}>
          {X.length ? (
            <div className="todo">
              {X.map((x) => (
                <button key={x._id} onClick={() => open({ type: "exp", id: x._id })}>
                  <Pill c="warn">{fmt(x.amount)}</Pill>
                  <span className="who">
                    {byId[x.employee]?.name}: {x.type}
                    {x.desc ? `, ${x.desc}` : ""} ({x.date}){!x.receipt && <span className="warnline"> {translate("no receipt", "لا يوجد إيصال")}</span>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="sub">{translate("Nothing waiting.", "لا يوجد شيء في الانتظار.")}</div>
          )}
        </Panel>
        <Panel title={translate("Timesheets not approved", "سجلات دوام غير معتمدة")} small={unap.length}>
          {unap.length ? (
            <div className="todo">
              {unap.map((id) => {
                const t = state.time[id];
                return (
                  <button key={id} onClick={() => go("ts", { emp: id })}>
                    <Pill c={t.t.unrec ? "bad" : "info"}>{t.t.unrec ? translate(`${t.t.unrec} blank`, `${t.t.unrec} فارغ`) : translate("complete", "مكتمل")}</Pill>
                    <span className="who">
                      {byId[id]?.name} · {translate(`${t.t.present} days, ${r1(t.otHours)} OT h`, `${t.t.present} يوم، ${r1(t.otHours)} ساعة عمل إضافي`)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="sub">{translate(`All timesheets for ${mLabel(state.month)} are approved.`, `جميع سجلات الدوام لشهر ${mLabel(state.month)} معتمدة.`)}</div>
          )}
        </Panel>
        <Panel title={translate(`Payroll ${mLabel(state.month)}`, `الرواتب ${mLabel(state.month)}`)}>
          <div className="sub">
            {translate("Status:", "الحالة:")} <b>{st}</b>. {st === "draft" ? translate("HR submits when timesheets, visits and claims are in.", "ترسلها الموارد البشرية عند استكمال سجلات الدوام والزيارات والمطالبات.") : st === "review" ? translate("The MD reviews the register and approves or sends it back.", "يراجع المدير العام السجل ويوافق عليه أو يعيده.") : st === "approved" ? translate("HR closes the month, prints or emails payslips and posts the journal to the ERP.", "تُغلق الموارد البشرية الشهر، وتطبع أو ترسل إيصالات الراتب بالبريد، وتُرحّل القيد إلى نظام تخطيط الموارد.") : translate("Closed and locked.", "مغلق ومقفل.")}
          </div>
          <div className="row2" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => go("pay")}>
              {translate("Open payroll", "فتح الرواتب")}
            </button>
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ===================== Forms ===================== */
export function Forms() {
  const { state, openPdf } = useHr();
  const { translate } = useLanguage();
  const { open, go } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const FT = ftMap(translate);
  const F2 = [...state.forms].sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  const pend = F2.filter((f) => f.status === "Pending");
  const ym = state.today.slice(0, 7);
  const edit = canEdit(state.role);
  return (
    <>
      <Top title={translate("Forms", "النماذج")} />
      <div className="kpis">
        <Kpi label={translate("Waiting for approval", "في انتظار الموافقة")} value={pend.length} sub={translate("across all forms", "في كل النماذج")} alert={!!pend.length} />
        <Kpi label={translate("Approved this month", "معتمدة هذا الشهر")} value={F2.filter((f) => f.status === "Approved" && String(f.decided || "").slice(0, 7) === ym).length} sub={translate("forms", "نماذج")} />
        <Kpi label={translate("Leave approved this year", "إجازات معتمدة هذا العام")} value={F2.filter((f) => f.ft === "leave" && f.status === "Approved" && String(f.from).slice(0, 4) === ym.slice(0, 4)).length} sub={translate("requests", "طلبات")} />
      </div>
      <Panel title={translate("Reservia HR forms", "نماذج ريزيرفيا للموارد البشرية")}>
        <div className="sub" style={{ marginBottom: 10 }}>
          {translate("Fill a form on screen, send it for approval, then print it for the personnel file. Approved leave posts to Attendance. An approved visit request creates a Planned visit.", "عبّئ النموذج على الشاشة، أرسله للموافقة، ثم اطبعه لملف شؤون الموظف. الإجازة المعتمدة تُرحَّل إلى الحضور. طلب الزيارة المعتمد يُنشئ زيارة مخططة.")}
        </div>
        <div className="formgrid">
          {["leave", "ot", "visit", "report", "hire", "exit"].map((k) =>
            k === "report" ? (
              <div className="fcard" key={k}>
                <span className="mono">HR-F04</span>
                <b>{translate("Site visit report", "تقرير الزيارة الميدانية")}</b>
                <span className="sub">{translate("Due within 24 hours of return. Written inside the visit record.", "يُسلَّم خلال 24 ساعة من العودة، ويُكتب داخل سجل الزيارة.")}</span>
                <div className="row2">
                  <button className="btn primary sm" onClick={() => go("visit")}>
                    {translate("Open site visits", "فتح الزيارات الميدانية")}
                  </button>
                  <button className="btn sm" onClick={() => openPdf("sheets/report?blank=1")}>
                    {translate("Blank copy", "نسخة فارغة")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="fcard" key={k}>
                <span className="mono">{FT[k].c}</span>
                <b>{FT[k].t}</b>
                <span className="sub">{FT[k].d}</span>
                <div className="row2">
                  {(edit || (!!state.me && (k === "leave" || k === "ot" || k === "visit"))) && (
                    <button className="btn primary sm" data-testid={`new-form-${k}`} onClick={() => open({ type: "frm", ft: k, empId: edit ? undefined : state.me || undefined })}>
                      {k === "hire" || k === "exit" ? translate("Open for an employee", "فتح لموظف") : translate("New request", "طلب جديد")}
                    </button>
                  )}
                  <button className="btn sm" onClick={() => openPdf(`sheets/${k}?blank=1`)}>
                    {translate("Blank copy", "نسخة فارغة")}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </Panel>
      <Panel title={translate("Requests", "الطلبات")} small={F2.length}>
        {F2.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{translate("Date", "التاريخ")}</th>
                  <th>{translate("Form", "النموذج")}</th>
                  <th>{translate("Employee", "الموظف")}</th>
                  <th>{translate("Details", "التفاصيل")}</th>
                  <th>{translate("Status", "الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {F2.map((f) => (
                  <tr key={f._id} onClick={() => open({ type: "frm", id: f._id, ft: f.ft })}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {String(f.created || "").slice(0, 10)}
                    </td>
                    <td>
                      {FT[f.ft].t} {f.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                    </td>
                    <td>{byId[f.employee]?.name || translate("(removed)", "(محذوف)")}</td>
                    <td className="sub">{frmSummary(f, translate)}</td>
                    <td>{statusPill(f.status, translate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sub">{translate("No requests yet.", "لا توجد طلبات بعد.")}</div>
        )}
      </Panel>
    </>
  );
}

export function FormModal({ id, ft: ft0, empId }: { id?: string; ft?: string; empId?: string }) {
  const { state, call, toast, openPdf } = useHr();
  const { translate } = useLanguage();
  const { close } = useModal();
  const byId = useEmp();
  const f0 = id ? state?.forms.find((x) => x._id === id) : null;
  const ft = (f0?.ft || ft0 || "leave") as string;
  const today = state?.today || "";
  const add = (d: string, k: number) => {
    const x = new Date(`${d}T00:00:00`);
    x.setDate(x.getDate() + k);
    return x.toISOString().slice(0, 10);
  };
  const firstEmp = empId || (canEdit(state?.role) ? state?.employees.find((e) => e.status !== "Left")?._id : state?.me) || "";
  const defaults: Record<string, Record<string, unknown>> = {
    leave: { ltype: "Annual leave", from: add(today, 21), to: add(today, 21) },
    ot: { odate: today, kind: state?.lists.OT_KINDS[0], from: "18:00", to: "20:00", hours: 2 },
    visit: { from: add(today, 3), city: "Cairo", days: 1, nights: 0, purpose: "Site survey", back: add(today, 3), transport: "Company arranges", stay: "Not needed", meals: "Not provided" },
    exit: { last: add(today, 90), reason: "Resignation" },
  };
  const f = useFormVals(f0 ? { ...f0, empId: f0.employee } : { empId: firstEmp, ...(defaults[ft] || {}) });
  const exitEmp = byId[f.v.empId];
  const [steps, setSteps] = useState<Record<string, boolean>>(() => (exitEmp?.exit?.steps as Record<string, boolean>) || {});
  if (!state) return null;
  const FT = ftMap(translate);
  const EXIT_STEPS = exitSteps(translate);
  // MD/HR for anyone; any other role may raise leave / overtime / visit requests for themself only.
  const edit = canEdit(state.role) || ((ft === "leave" || ft === "ot" || ft === "visit") && canActOn(state, f0 ? f0.employee : f.v.empId || state.me));
  const canDecide = canDecideHr(state.role) && (!f0 || f0.employee !== state.me || canEdit(state.role));
  const emps = state.employees.filter((e) => e.status !== "Left" && (canEdit(state.role) || e._id === state.me)).map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  const title = `${FT[ft].c} ${FT[ft].t}`;
  if (ft === "hire" || ft === "exit") {
    const e = byId[f.v.empId];
    return (
      <Modal title={title} onClose={close}>
        <div className="fg">
          <Sel label={translate("Employee", "الموظف")} k="empId" f={f} opts={emps} />
          {ft === "exit" && (
            <>
              <Inp label={translate("Last working day", "آخر يوم عمل")} k="last" f={f} type="date" />
              <Sel
                label={translate("Reason", "السبب")}
                k="reason"
                f={f}
                opts={[
                  ["Resignation", translate("Resignation", "استقالة")],
                  ["Termination", translate("Termination", "فصل")],
                  ["End of contract", translate("End of contract", "انتهاء العقد")],
                ]}
              />
            </>
          )}
        </div>
        {ft === "hire" && e && (
          <>
            <div className="tablewrap">
              <table className="mini">
                <thead>
                  <tr>
                    <th>{translate("Document", "المستند")}</th>
                    <th>{translate("Status", "الحالة")}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.lists.DOCS.map((d) => {
                    const s = state.docStatus[e._id]?.docs[d.k] || "miss";
                    return (
                      <tr key={d.k}>
                        <td>{d.n}</td>
                        <td>
                          <Pill c={SL[s][1]}>{slText(s, translate)}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sub">{translate('Nobody starts until the "before day 1" items are on file. Keep the signed four-copy contract; one copy goes to the Ministry of Manpower.', "لا يبدأ أحد العمل قبل توافر بنود ما قبل اليوم الأول. يُحفظ العقد الموقّع من أربع نسخ؛ وتُرسل نسخة إلى مكتب القوى العاملة.")}</div>
          </>
        )}
        {ft === "exit" && (
          <>
            <div className="tablewrap">
              <table className="mini">
                <thead>
                  <tr>
                    <th></th>
                    <th>{translate("Step", "الخطوة")}</th>
                    <th>{translate("Owner", "المسؤول")}</th>
                  </tr>
                </thead>
                <tbody>
                  {EXIT_STEPS.map((x, i) => (
                    <tr key={i}>
                      <td>
                        <input type="checkbox" checked={!!steps[i]} aria-label={x[0]} onChange={(ev) => setSteps((o) => ({ ...o, [i]: ev.target.checked }))} />
                      </td>
                      <td>{x[0]}</td>
                      <td className="sub">{x[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sub">{translate("Tick each step as it is signed off. When all twelve are done, set the employee status to Left in People.", "علّم كل خطوة عند اعتمادها. وعند اكتمال الاثنتي عشرة خطوة، غيّر حالة الموظف إلى ترك الخدمة في صفحة الموظفين.")}</div>
          </>
        )}
        <div className="row2">
          {ft === "exit" && edit && (
            <button className="btn primary" onClick={() => call("PUT", `employees/${f.v.empId}/exit`, { last: f.v.last, reason: f.v.reason, steps }).then(() => toast(translate("Checklist saved", "تم حفظ القائمة")))}>
              {translate("Save checklist", "حفظ القائمة")}
            </button>
          )}
          <button className="btn" onClick={() => openPdf(`sheets/${ft}?empId=${f.v.empId}`)}>
            {translate("Print", "طباعة")}
          </button>
        </div>
      </Modal>
    );
  }
  const hints: string[] = [];
  if (ft === "leave") {
    const lv = state.leave.find((l) => l.empId === f.v.empId);
    if (lv) hints.push(translate(`Used so far this year: ${lv.used} of ${lv.ent}.`, `استُخدم حتى الآن هذا العام: ${lv.used} من ${lv.ent}.`));
    if (f.v.ltype === "Casual leave") hints.push(translate("Casual leave: 2 days at most at a time, 7 a year, taken from the annual balance.", "الإجازة العارضة: يومان على الأكثر في المرة، 7 أيام في العام، تُخصم من رصيد الإجازة السنوية."));
    if (f.v.ltype === "Sick leave") hints.push(translate("Attach the medical certificate to the personnel file.", "أرفق الشهادة الطبية بملف شؤون الموظف."));
    if (f.v.ltype === "Unpaid leave") hints.push(translate("Unpaid leave needs the written approval of the MD.", "الإجازة بدون مرتب تحتاج موافقة كتابية من المدير العام."));
    if (f.v.balanceOverride)
      hints.push(
        translate(
          `Sent over the remaining balance - MD override by ${f.v.balanceOverrideByName || "the MD"} on ${f.v.balanceOverrideAt}: "${f.v.balanceOverrideReason}"`,
          `أُرسلت متجاوزة الرصيد المتبقي - تجاوز من المدير العام ${f.v.balanceOverrideByName || "المدير العام"} بتاريخ ${f.v.balanceOverrideAt}: "${f.v.balanceOverrideReason}"`
        )
      );
  }
  if (ft === "ot") {
    if (f.v.odate && f.v.odate < today) hints.push(translate("Policy: approval must come before the work starts. This date has passed, so record it as an exception with a reason.", "السياسة: يجب أن تأتي الموافقة قبل بدء العمل. هذا التاريخ قد مضى، لذا سجّله كحالة استثناء مع بيان السبب."));
    const c = state.cfg;
    const k = f.v.kind;
    const rateEn = k === state.lists.OT_KINDS[0] ? `wage x ${c.otDay} by day, x ${c.otNight} at night` : k === state.lists.OT_KINDS[1] ? `daily wage x ${c.otFri} plus a substitute day` : k === state.lists.OT_KINDS[2] ? `daily wage x ${c.otSat}, no substitute day` : `daily wage x ${c.otHol} in total`;
    const rateAr = k === state.lists.OT_KINDS[0] ? `الأجر × ${c.otDay} نهارًا، × ${c.otNight} ليلاً` : k === state.lists.OT_KINDS[1] ? `الأجر اليومي × ${c.otFri} بالإضافة إلى يوم بدل` : k === state.lists.OT_KINDS[2] ? `الأجر اليومي × ${c.otSat}، بدون يوم بدل` : `الأجر اليومي × ${c.otHol} إجماليًا`;
    hints.push(translate(`Rate for this work: ${rateEn}.`, `معدل هذا العمل: ${rateAr}.`));
  }
  if (ft === "visit") {
    const gc = state.cfg.cities.find((c) => c.n === f.v.city)?.z === "Greater Cairo";
    hints.push(
      gc
        ? translate(`Greater Cairo day: daily wage x ${state.cfg.siteGC} in total, no meal allowance.`, `يوم داخل القاهرة الكبرى: الأجر اليومي × ${state.cfg.siteGC} إجماليًا، بدون بدل وجبات.`)
        : translate(
            `Outside Greater Cairo: daily wage x ${state.cfg.siteOut} in total plus EGP ${state.cfg.perDiem} meal per diem each day (none if all meals are provided).`,
            `خارج القاهرة الكبرى: الأجر اليومي × ${state.cfg.siteOut} إجماليًا بالإضافة إلى ${state.cfg.perDiem} جنيه بدل وجبات يوميًا (لا يُدفع إذا وُفرت جميع الوجبات).`
          )
    );
    hints.push(translate("An HSE induction and issued PPE are needed before the first visit.", "التدريب التعريفي على الصحة والسلامة وتسليم معدات الحماية مطلوبان قبل أول زيارة."));
  }
  const save = async () => {
    if (!id || f0?.status === "Pending") {
      if (edit) {
        const r = await call(id ? "PATCH" : "POST", id ? `forms/${id}` : "forms", { ...f.v, ft });
        (r.data.warnings || []).forEach((w: string) => toast(w));
        if (!id) {
          toast(translate("Sent for approval", "أُرسل للموافقة"));
          close();
          return;
        }
      }
    }
    if (id && canDecide && f.v.status !== f0?.status) {
      const r = await call("POST", `forms/${id}/decide`, { status: f.v.status, by: f.v.by, dnote: f.v.dnote });
      const fx = r.data.effects || {};
      toast(fx.attendanceDays ? translate(`Approved. ${fx.attendanceDays} days posted to Attendance`, `تمت الموافقة. تم ترحيل ${fx.attendanceDays} يوم إلى الحضور`) : fx.visit ? translate("Approved. Visit added as Planned", "تمت الموافقة. أُضيفت الزيارة كمخططة") : translate("Saved", "تم الحفظ"));
    } else toast(translate("Saved", "تم الحفظ"));
    close();
  };
  const ro = !!id && f0?.status !== "Pending";
  return (
    <Modal title={title} onClose={close}>
      <div className="fg">
        <Sel label={translate("Employee", "الموظف")} k="empId" f={f} opts={emps} disabled={!edit || ro} />
        {ft === "leave" && (
          <>
            <Sel label={translate("Type of leave", "نوع الإجازة")} k="ltype" f={f} opts={state.lists.LEAVE_TYPES} disabled={!edit || ro} />
            <Inp label={translate("First day of leave", "أول يوم إجازة")} k="from" f={f} type="date" disabled={!edit || ro} />
            <Inp label={translate("Last day of leave", "آخر يوم إجازة")} k="to" f={f} type="date" disabled={!edit || ro} />
            <Inp label={translate("Who covers your work", "من يغطي عملك")} k="cover" f={f} disabled={!edit || ro} />
            <Inp label={translate("Phone during leave", "الهاتف خلال الإجازة")} k="phone" f={f} disabled={!edit || ro} />
            <Txt label={translate("Reason or note", "السبب أو ملاحظة")} k="reason" f={f} />
            {/* HR Portal D1: sending a request over the remaining balance is blocked unless the MD
                gives a reason here - shown only to the MD, since nobody else can send it anyway. */}
            {state.role === "md" && !ro && (
              <Txt label={translate("Reason to send anyway if this is over the remaining balance (MD only)", "سبب الإرسال رغم تجاوز الرصيد المتبقي (للمدير العام فقط)")} k="balanceOverrideReason" f={f} />
            )}
          </>
        )}
        {ft === "ot" && (
          <>
            <Inp label={translate("Date of the work", "تاريخ العمل")} k="odate" f={f} type="date" disabled={!edit || ro} />
            <Sel label={translate("Type of work", "نوع العمل")} k="kind" f={f} opts={state.lists.OT_KINDS} disabled={!edit || ro} />
            <Inp label={translate("Planned start", "وقت البدء المخطط")} k="from" f={f} type="time" disabled={!edit || ro} />
            <Inp label={translate("Planned end", "وقت الانتهاء المخطط")} k="to" f={f} type="time" disabled={!edit || ro} />
            <Inp label={translate("Hours beyond the normal day", "ساعات تتجاوز اليوم العادي")} k="hours" f={f} type="number" step="0.5" disabled={!edit || ro} />
            <Inp label={translate("Project or site", "المشروع أو الموقع")} k="site" f={f} disabled={!edit || ro} />
            <Txt label={translate("Why the work cannot wait", "سبب عدم إمكانية تأجيل العمل")} k="reason" f={f} />
          </>
        )}
        {ft === "visit" && (
          <>
            <Inp label={translate("First day", "أول يوم")} k="from" f={f} type="date" disabled={!edit || ro} />
            <Sel label={translate("City", "المدينة")} k="city" f={f} opts={state.cfg.cities.map((c) => [c.n, `${c.n} (${c.z})`] as [string, string])} disabled={!edit || ro} />
            <Inp label={translate("Client or site", "العميل أو الموقع")} k="site" f={f} disabled={!edit || ro} />
            <Sel label={translate("Purpose", "الغرض")} k="purpose" f={f} opts={state.lists.PURPOSES} disabled={!edit || ro} />
            <Inp label={translate("Days on site", "عدد الأيام بالموقع")} k="days" f={f} type="number" min={1} disabled={!edit || ro} />
            <Inp label={translate("Nights away", "عدد الليالي خارج المقر")} k="nights" f={f} type="number" min={0} disabled={!edit || ro} />
            <Inp label={translate("Expected return", "تاريخ العودة المتوقع")} k="back" f={f} type="date" disabled={!edit || ro} />
            <Sel
              label={translate("Transport", "النقل")}
              k="transport"
              f={f}
              opts={[
                ["Company arranges", translate("Company arranges", "الشركة تتولى الترتيب")],
                ["Employee pays, reimbursed on receipts", translate("Employee pays, reimbursed on receipts", "الموظف يدفع ويُرد له المبلغ مقابل الإيصالات")],
              ]}
              disabled={!edit || ro}
            />
            <Sel
              label={translate("Accommodation", "الإقامة")}
              k="stay"
              f={f}
              opts={[
                ["Not needed", translate("Not needed", "غير مطلوبة")],
                ["Company books", translate("Company books", "الشركة تحجز")],
                ["Client provides", translate("Client provides", "العميل يوفرها")],
              ]}
              disabled={!edit || ro}
            />
            <Sel
              label={translate("Meals", "الوجبات")}
              k="meals"
              f={f}
              opts={[
                ["Not provided", translate("Not provided", "غير مقدَّمة")],
                ["Provided all day by client or hotel", translate("Provided all day by client or hotel", "مقدَّمة طوال اليوم من العميل أو الفندق")],
              ]}
              disabled={!edit || ro}
            />
            <Inp label={translate("CRM lead or project reference", "رقم العميل المحتمل أو مرجع المشروع")} k="ref" f={f} disabled={!edit || ro} />
            <Txt label={translate("Objective of the visit", "هدف الزيارة")} k="reason" f={f} />
          </>
        )}
      </div>
      {hints.map((h) => (
        <div className="sub" key={h}>
          &bull; {h}
        </div>
      ))}
      {id && canDecide && (
        <div className="sect">
          <h4>{translate("Decision", "القرار")}</h4>
          <div className="fg">
            <Sel
              label={translate("Status", "الحالة")}
              k="status"
              f={f}
              opts={[
                ["Pending", translate("Pending", "قيد الانتظار")],
                ["Approved", translate("Approved", "مُعتمد")],
                ["Rejected", translate("Rejected", "مرفوض")],
              ]}
            />
            <Inp label={translate("Decided by", "اعتمده")} k="by" f={f} placeholder={translate("Your name is used when blank", "يُستخدم اسمك إذا تُرك فارغًا")} />
            <Inp label={translate("Manager note", "ملاحظة المدير")} k="dnote" f={f} full />
          </div>
        </div>
      )}
      <div className="row2">
        {(edit || (id && canDecide)) && (
          <button className="btn primary" data-testid="hr-save-form" onClick={() => save().catch(() => undefined)}>
            {id ? translate("Save", "حفظ") : translate("Send for approval", "إرسال للموافقة")}
          </button>
        )}
        {id && (
          <button className="btn" onClick={() => openPdf(`sheets/${ft}?id=${id}`)}>
            {translate("Print", "طباعة")}
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton label={translate("Delete", "حذف")} armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")} onConfirm={() => call("DELETE", `forms/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Training ===================== */
export function Training() {
  const { state, download } = useHr();
  const { translate } = useLanguage();
  const { open } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const E = state.employees.filter((e) => e.status !== "Left");
  const req = state.cfg.req;
  const L = [...state.trainings].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const addM = (s: string, k: number) => {
    const d = new Date(`${s}T00:00:00`);
    d.setMonth(d.getMonth() + k);
    return d.toISOString().slice(0, 10);
  };
  return (
    <>
      <Top title={translate("Training", "التدريب")}>
        {canEdit(state.role) && (
          <>
            <button className="btn" onClick={() => download(`exports/training.csv?month=${state.month}`)}>
              {translate("Export CSV", "تصدير CSV")}
            </button>
            <button className="btn primary" onClick={() => open({ type: "trn" })}>
              {translate("Log training", "تسجيل تدريب")}
            </button>
          </>
        )}
      </Top>
      {!E.length ? (
        <Empty title={translate("No employees yet", "لا يوجد موظفون بعد")} text={translate("Add people first, then record courses and certificates.", "أضف الموظفين أولاً، ثم سجّل الدورات والشهادات.")} />
      ) : (
        <>
          <div className="legend">{translate("Required courses are set in Settings. Select a cell to log a course.", "تُحدَّد الدورات المطلوبة من الإعدادات. اختر خلية لتسجيل دورة.")}</div>
          <div className="tablewrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th>{translate("Employee", "الموظف")}</th>
                  {req.map((r) => (
                    <th className="vh" title={translate(`${r.n} (valid ${r.m} months)`, `${r.n} (سارٍ ${r.m} شهرًا)`)} key={r.n}>
                      {r.n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {E.map((e) => (
                  <tr key={e._id}>
                    <td>
                      <button className="lnk" onClick={() => open({ type: "emp", id: e._id })}>
                        {e.name}
                      </button>
                      <div className="sub">{e.dept}</div>
                    </td>
                    {req.map((r, i) => {
                      const s = state.trnStatus[e._id]?.[i] || { s: "miss", exp: "" };
                      return (
                        <td className="cc" key={r.n}>
                          <button className={`dc ${s.s}`} title={translate(`${r.n}: ${SL[s.s][0]}${s.exp ? ` until ${s.exp}` : ""}`, `${r.n}: ${slText(s.s, translate)}${s.exp ? ` حتى ${s.exp}` : ""}`)} aria-label={translate(`${e.name}, ${r.n}, ${SL[s.s][0]}`, `${e.name}, ${r.n}, ${slText(s.s, translate)}`)} onClick={() => open({ type: "trn", empId: e._id, course: r.n })}>
                            {SL_ICON[s.s]}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Panel title={translate("Training log", "سجل التدريب")} small={translate(`${L.length} records`, `${L.length} سجل`)}>
            {L.length ? (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>{translate("Date", "التاريخ")}</th>
                      <th>{translate("Employee", "الموظف")}</th>
                      <th>{translate("Course", "الدورة")}</th>
                      <th>{translate("Provider", "الجهة المقدِّمة")}</th>
                      <th className="num">{translate("Hours", "الساعات")}</th>
                      <th>{translate("Valid until", "سارٍ حتى")}</th>
                      <th>{translate("Certificate", "الشهادة")}</th>
                      <th className="num">{translate("Cost", "التكلفة")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {L.map((t) => {
                      const rq = req.find((r) => r.n === t.course);
                      return (
                        <tr key={t._id} onClick={() => open({ type: "trn", id: t._id })}>
                          <td className="mono">{t.date}</td>
                          <td>{byId[t.employee]?.name || translate("(removed)", "(محذوف)")}</td>
                          <td>
                            {t.course} {t.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                          </td>
                          <td>{t.provider}</td>
                          <td className="num">{t.hours || ""}</td>
                          <td className="mono">{t.exp || (rq && rq.m ? addM(t.date, rq.m) : "")}</td>
                          <td>{t.cert ? <Pill c="good">{translate("On file", "محفوظة")}</Pill> : <Pill c="warn">{translate("Not on file", "غير محفوظة")}</Pill>}</td>
                          <td className="num">{t.cost ? fmt(t.cost) : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sub">{translate("No training logged yet.", "لا يوجد تدريب مسجَّل بعد.")}</div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

export function TrainingModal({ id, empId, course }: { id?: string; empId?: string; course?: string }) {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  const { close } = useModal();
  const t = id ? state?.trainings.find((x) => x._id === id) : null;
  const f = useFormVals(t ? { ...t, empId: t.employee } : { empId: empId || "", course: course || "", date: state?.today, cert: true, kind: "Training course" });
  if (!state || (id && !t)) return null;
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, e.name] as [string, string]);
  return (
    <Modal title={id ? translate("Training or certificate", "تدريب أو شهادة") : translate("Log training or certificate", "تسجيل تدريب أو شهادة")} onClose={close}>
      <div className="fg">
        <Sel label={translate("Employee", "الموظف")} k="empId" f={f} opts={[["", translate("Choose", "اختر")], ...emps]} />
        <Sel label={translate("Type", "النوع")} k="kind" f={f} opts={state.lists.CERT_KINDS} />
        <label>
          {translate("Course", "الدورة")}
          <input list="hr-courses" value={f.v.course || ""} onChange={(e) => f.set("course", e.target.value)} />
          <datalist id="hr-courses">
            {state.cfg.req.map((r) => (
              <option key={r.n} value={r.n} />
            ))}
          </datalist>
        </label>
        <Inp label={translate("Provider", "الجهة المقدِّمة")} k="provider" f={f} />
        <Inp label={translate("Date completed", "تاريخ الإكمال")} k="date" f={f} type="date" />
        <Inp label={translate("Hours", "الساعات")} k="hours" f={f} type="number" />
        <Inp label={translate("Valid until (blank = course default)", "سارٍ حتى (اتركه فارغًا لاستخدام إعداد الدورة)")} k="exp" f={f} type="date" />
        <Inp label={translate("Cost (EGP)", "التكلفة (جنيه)")} k="cost" f={f} type="number" />
        <Chk label={translate("Certificate on file", "الشهادة محفوظة")} k="cert" f={f} />
      </div>
      <div className="row2">
        <button className="btn primary" onClick={() => call(id ? "PATCH" : "POST", id ? `records/training/${id}` : "records/training", f.v).then(() => (toast(translate("Saved", "تم الحفظ")), close()))}>
          {translate("Save", "حفظ")}
        </button>
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton label={translate("Delete", "حذف")} armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")} onConfirm={() => call("DELETE", `records/training/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Performance ===================== */
const perfScore = (goals: { w: number; s: number }[]) => {
  const tw = sum(goals, (g) => +g.w || 0);
  return tw ? Math.round((sum(goals, (g) => (+g.w || 0) * (+g.s || 0)) / tw) * 10) / 10 : 0;
};
export function Performance() {
  const { state } = useHr();
  const { translate } = useLanguage();
  const { open } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const P = [...state.performance].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const probs = state.employees.filter((e) => e.status !== "Left" && probationSoon(e, state.today));
  return (
    <>
      <Top title={translate("Performance", "الأداء")}>
        <button className="btn primary" onClick={() => open({ type: "perf" })}>
          {translate("New review", "تقييم جديد")}
        </button>
      </Top>
      <div className="kpis">
        <Kpi label={translate("Reviews on file", "التقييمات المسجَّلة")} value={P.length} />
        <Kpi label={translate("Average rating", "متوسط التقييم")} value={P.length ? (sum(P, (p) => +(p.rating || 0) || perfScore(p.goals || [])) / P.length).toFixed(1) : translate("n/a", "غير متاح")} sub={translate("out of 5", "من 5")} />
        <Kpi label={translate("Probation ending in 30 days", "فترات اختبار تنتهي خلال 30 يومًا")} value={probs.length} sub={probs.map((e) => e.name.split(" ")[0]).join(", ") || translate("nobody", "لا أحد")} alert={!!probs.length} />
      </div>
      <Panel title={translate("How it works", "آلية العمل")}>
        <div className="sub">{translate("Each review has weighted goals scored 1 to 5. The weighted score sets the rating. Enter the monthly target achievement on the payslip (it releases the commission); use reviews here for the probation decision, the half-year and the annual cycle.", "يحتوي كل تقييم على أهداف موزونة تُقيَّم من 1 إلى 5. الدرجة الموزونة تحدد التقييم النهائي. أدخل نسبة تحقيق الهدف الشهري في إيصال الراتب (فهذا يُفرج عن العمولة)؛ واستخدم التقييمات هنا لقرار نهاية فترة الاختبار والدورة النصف سنوية والسنوية.")}</div>
      </Panel>
      {!P.length ? (
        <Empty title={translate("No reviews yet", "لا توجد تقييمات بعد")} text={translate("Start with the probation reviews, due before the three months end.", "ابدأ بتقييمات فترة الاختبار، المطلوبة قبل انتهاء الثلاثة أشهر.")} />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{translate("Date", "التاريخ")}</th>
                <th>{translate("Employee", "الموظف")}</th>
                <th>{translate("Cycle", "الدورة")}</th>
                <th>{translate("Goals", "الأهداف")}</th>
                <th className="num">{translate("Score", "الدرجة")}</th>
                <th>{translate("Rating", "التقييم")}</th>
                <th>{translate("Reviewer", "المُقيِّم")}</th>
              </tr>
            </thead>
            <tbody>
              {P.map((p) => {
                const sc = perfScore(p.goals || []);
                return (
                  <tr key={p._id} onClick={() => open({ type: "perf", id: p._id })}>
                    <td className="mono">{p.date}</td>
                    <td>{byId[p.employee]?.name || translate("(removed)", "(محذوف)")}</td>
                    <td>
                      {p.cycle} {p.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                    </td>
                    <td className="sub">{(p.goals || []).map((g: { t: string }) => g.t).join("; ")}</td>
                    <td className="num">{sc}</td>
                    <td>
                      <Pill c={sc >= 3.5 ? "good" : sc >= 2.5 ? "info" : "warn"}>{sc >= 4.5 ? translate("Outstanding", "ممتاز") : sc >= 3.5 ? translate("Strong", "قوي") : sc >= 2.5 ? translate("Meets", "مُستوفٍ") : sc >= 1.5 ? translate("Below", "دون المطلوب") : translate("Unrated", "غير مقيَّم")}</Pill>
                    </td>
                    <td>{p.by}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function PerfModal({ id }: { id?: string }) {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  const { close } = useModal();
  const p = id ? state?.performance.find((x) => x._id === id) : null;
  const today = state?.today || "";
  const f = useFormVals(p ? { ...p, empId: p.employee } : { empId: "", cycle: `${today.slice(0, 4)} ${+today.slice(5, 7) <= 6 ? "H1" : "H2"}`, date: today, by: "" });
  const [goals, setGoals] = useState<{ t: string; w: number; s: number }[]>(p?.goals?.length ? p.goals : [{ t: "", w: 40, s: 3 }, { t: "", w: 30, s: 3 }, { t: "", w: 30, s: 3 }]);
  if (!state || (id && !p)) return null;
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  const setG = (i: number, k: "t" | "w" | "s", v: string) => setGoals((g) => g.map((x, j) => (j === i ? { ...x, [k]: k === "t" ? v : +v } : x)));
  return (
    <Modal title={id ? translate("Performance review", "تقييم الأداء") : translate("New review", "تقييم جديد")} onClose={close}>
      <div className="fg">
        <Sel label={translate("Employee", "الموظف")} k="empId" f={f} opts={[["", translate("Choose", "اختر")], ...emps]} />
        <Inp label={translate("Cycle", "الدورة")} k="cycle" f={f} />
        <Inp label={translate("Review date", "تاريخ التقييم")} k="date" f={f} type="date" />
        <Inp label={translate("Reviewer", "المُقيِّم")} k="by" f={f} />
      </div>
      <div className="tablewrap">
        <table className="mini">
          <thead>
            <tr>
              <th>{translate("Goal", "الهدف")}</th>
              <th>{translate("Weight %", "الوزن %")}</th>
              <th>{translate("Score 1 to 5", "الدرجة من 1 إلى 5")}</th>
            </tr>
          </thead>
          <tbody>
            {goals.map((g, i) => (
              <tr key={i}>
                <td>
                  <input value={g.t} placeholder={translate("Goal", "الهدف")} onChange={(e) => setG(i, "t", e.target.value)} />
                </td>
                <td>
                  <input type="number" value={g.w} min={0} max={100} onChange={(e) => setG(i, "w", e.target.value)} />
                </td>
                <td>
                  <select value={g.s} onChange={(e) => setG(i, "s", e.target.value)}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row2">
        <button className="btn sm" onClick={() => setGoals((g) => [...g, { t: "", w: 0, s: 3 }])}>
          {translate("Add goal", "إضافة هدف")}
        </button>
        <span className="sub">{translate(`Weights should total 100. Score now ${perfScore(goals.filter((g) => g.t))}.`, `يجب أن يكون إجمالي الأوزان 100. الدرجة الآن ${perfScore(goals.filter((g) => g.t))}.`)}</span>
      </div>
      <Txt label={translate("Summary and development plan", "الملخص وخطة التطوير")} k="note" f={f} />
      <div className="row2">
        <button className="btn primary" onClick={() => call(id ? "PATCH" : "POST", id ? `records/performance/${id}` : "records/performance", { ...f.v, goals }).then(() => (toast(translate("Saved", "تم الحفظ")), close()))}>
          {translate("Save", "حفظ")}
        </button>
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton label={translate("Delete", "حذف")} armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")} onConfirm={() => call("DELETE", `records/performance/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Policy ===================== */
const POLICY_OPEN_DATA: { type: string; typeAr: string; en: string; ar: string; noteEn: string; noteAr: string }[] = [
  { type: "Decision", typeAr: "قرار", en: "Overtime on total wage (policy choice) or basic wage only", ar: "العمل الإضافي يُحسب على إجمالي الأجر (اختيار السياسة) أو على الأجر الأساسي فقط", noteEn: "Payroll uses the setting in Settings", noteAr: "الرواتب تستخدم الإعداد المحدد في الإعدادات" },
  { type: "Decision", typeAr: "قرار", en: "21 days annual leave from year one, against 15 in the law", ar: "21 يوم إجازة سنوية من السنة الأولى، مقابل 15 يومًا في القانون", noteEn: "Company term, cannot later be cut", noteAr: "شرط من الشركة، لا يمكن تقليصه لاحقًا" },
  { type: "Decision", typeAr: "قرار", en: "Late arrival: 15 minutes grace, 3 times a month, then deductions", ar: "التأخير في الحضور: سماح 15 دقيقة، 3 مرات في الشهر، ثم تُطبَّق الخصومات", noteEn: "Payroll applies it when the deduction setting is on", noteAr: "تُطبَّق في الرواتب عند تفعيل إعداد الخصم" },
  { type: "Law check", typeAr: "مراجعة قانونية", en: "Pay on a weekly rest day: double pay plus a substitute day, or either one", ar: "الأجر في يوم الراحة الأسبوعي: أجر مضاعف بالإضافة إلى يوم بدل، أو أحدهما فقط", noteEn: "Sources differ", noteAr: "المصادر مختلفة" },
  { type: "Law check", typeAr: "مراجعة قانونية", en: "Overtime basis: total wage or basic wage", ar: "أساس حساب العمل الإضافي: إجمالي الأجر أو الأجر الأساسي", noteEn: "Sources differ", noteAr: "المصادر مختلفة" },
  { type: "Law check", typeAr: "مراجعة قانونية", en: "Night hours 22:00 to 06:00", ar: "ساعات العمل الليلي من 22:00 إلى 06:00", noteEn: "One source", noteAr: "مصدر واحد" },
  { type: "Law check", typeAr: "مراجعة قانونية", en: "Ramadan hours: 6 or 7", ar: "ساعات رمضان: 6 أو 7", noteEn: "Policy uses 6", noteAr: "السياسة تعتمد 6 ساعات" },
  { type: "Law check", typeAr: "مراجعة قانونية", en: "Monthly incentive counts as wage (Art. 1), so insurance and overtime base default to the total wage", ar: "الحافز الشهري يُعد جزءًا من الأجر (المادة 1)، لذلك يكون أساس التأمين والعمل الإضافي هو إجمالي الأجر بشكل افتراضي", noteEn: "Lawyer to confirm; change in Settings", noteAr: "يحتاج تأكيد المحامي؛ يمكن تغييره من الإعدادات" },
  { type: "Decision", typeAr: "قرار", en: "Friday is the weekly rest day in the contract; Saturday work is overtime at the HR Policy rate", ar: "يوم الجمعة هو يوم الراحة الأسبوعي في العقد؛ العمل يوم السبت يُعد عملاً إضافيًا بمعدل سياسة الموارد البشرية", noteEn: "Contract v2, 10 Nov 2026", noteAr: "العقد الإصدار 2، 10 نوفمبر 2026" },
  { type: "Law check", typeAr: "مراجعة قانونية", en: "How rest days and holidays are counted inside annual leave", ar: "كيفية حساب أيام الراحة والعطلات الرسمية ضمن الإجازة السنوية", noteEn: "Not confirmed", noteAr: "غير مؤكد" },
  { type: "Law check", typeAr: "مراجعة قانونية", en: "Whether a resignation needs Manpower approval first, and the end-of-service payment", ar: "هل تحتاج الاستقالة إلى موافقة مسبقة من مكتب القوى العاملة، ومستحقات نهاية الخدمة", noteEn: "Ask a lawyer", noteAr: "استشارة محامٍ" },
  { type: "Accountant", typeAr: "المحاسب", en: "Tax and insurance treatment of the site allowance and the per diem", ar: "المعاملة الضريبية والتأمينية لبدل الموقع والبدل اليومي", noteEn: "Settings: site allowances are not taxed by default", noteAr: "الإعدادات: بدلات الموقع غير خاضعة للضريبة بشكل افتراضي" },
  { type: "Check", typeAr: "تأكيد", en: "Holiday x3 and Friday x2 are treated as additional pay on top of the monthly salary", ar: "يُعامل أجر العطلة الرسمية ×3 وأجر الجمعة ×2 كأجر إضافي فوق الراتب الشهري", noteEn: "Confirm that the normal holiday pay is not inside the x3", noteAr: "التأكد من أن الأجر العادي للعطلة غير مُدرج داخل الـ×3" },
];
export function Policy() {
  const { state } = useHr();
  const { translate } = useLanguage();
  if (!state) return null;
  const c = state.cfg;
  const d = 20000 / 30;
  const hr = d / 8;
  const f2 = (x: number) => fmt(Math.round(x * 100) / 100);
  const POLICY_OPEN: [string, string, string][] = POLICY_OPEN_DATA.map((r) => [translate(r.type, r.typeAr), translate(r.en, r.ar), translate(r.noteEn, r.noteAr)]);
  const rates: [string, string, string][] = [
    [translate("Normal day", "اليوم العادي"), translate("8 hours at daily wage", "8 ساعات بالأجر اليومي"), translate(`${f2(d)} a day, ${f2(hr)} an hour`, `${f2(d)} في اليوم، ${f2(hr)} في الساعة`)],
    [translate("Weekday overtime, 06:00 to 22:00", "العمل الإضافي في أيام الأسبوع، من 06:00 إلى 22:00"), translate(`Hourly wage x ${c.otDay}`, `الأجر بالساعة × ${c.otDay}`), translate(`${f2(hr * c.otDay)} an hour`, `${f2(hr * c.otDay)} في الساعة`)],
    [translate("Weekday overtime, 22:00 to 06:00", "العمل الإضافي في أيام الأسبوع، من 22:00 إلى 06:00"), translate(`Hourly wage x ${c.otNight}`, `الأجر بالساعة × ${c.otNight}`), translate(`${f2(hr * c.otNight)} an hour`, `${f2(hr * c.otNight)} في الساعة`)],
    [translate("Friday worked (statutory rest day)", "العمل يوم الجمعة (يوم الراحة القانوني)"), translate(`Daily wage x ${c.otFri}, plus a substitute day`, `الأجر اليومي × ${c.otFri}، بالإضافة إلى يوم بدل`), translate(`${f2(d * c.otFri)} plus a day off`, `${f2(d * c.otFri)} بالإضافة إلى يوم إجازة`)],
    [translate("Saturday worked (company rest day)", "العمل يوم السبت (يوم راحة الشركة)"), translate(`Daily wage x ${c.otSat}, no substitute day`, `الأجر اليومي × ${c.otSat}، بدون يوم بدل`), f2(d * c.otSat)],
    [translate("Official holiday worked", "العمل في عطلة رسمية"), translate(`Daily wage x ${c.otHol} in total`, `الأجر اليومي × ${c.otHol} إجماليًا`), f2(d * c.otHol)],
    [translate("Site visit in Greater Cairo", "زيارة ميدانية داخل القاهرة الكبرى"), translate(`Daily wage x ${c.siteGC} in total, no meal allowance`, `الأجر اليومي × ${c.siteGC} إجماليًا، بدون بدل وجبات`), translate(`${f2(d * c.siteGC)}, of which ${f2(d * (c.siteGC - 1))} is the allowance`, `${f2(d * c.siteGC)}، منها ${f2(d * (c.siteGC - 1))} هو البدل`)],
    [translate("Domestic travel outside Greater Cairo", "السفر الداخلي خارج القاهرة الكبرى"), translate(`Daily wage x ${c.siteOut} in total, plus EGP ${c.perDiem} per diem`, `الأجر اليومي × ${c.siteOut} إجماليًا، بالإضافة إلى ${c.perDiem} جنيه بدل يومي`), translate(`${f2(d * c.siteOut)} plus ${c.perDiem}, of which ${f2(d * (c.siteOut - 1))} is the allowance`, `${f2(d * c.siteOut)} بالإضافة إلى ${c.perDiem}، منها ${f2(d * (c.siteOut - 1))} هو البدل`)],
  ];
  const list = (xs: string[]) => (
    <div className="todo2">
      {xs.map((x) => (
        <div className="sub" key={x}>
          &bull; {x}
        </div>
      ))}
    </div>
  );
  return (
    <>
      <Top title={translate("HR policy", "سياسة الموارد البشرية")} />
      <div className="banner info">{translate("Draft of 19 October 2026: Attendance, Overtime, Travel and Leave, written to sit inside Labour Law 14 of 2025. Legal floors come from law-firm and news summaries, not the official text, which prevails.", "مسودة 19 أكتوبر 2026: الحضور والعمل الإضافي والسفر والإجازات، مكتوبة لتتوافق مع قانون العمل رقم 14 لسنة 2025. الحدود القانونية مستمدة من ملخصات مكاتب محاماة وأخبار، لا من النص الرسمي الذي يُعتد به.")}</div>
      <Panel title={translate("Pay rules, with an example at EGP 20,000 a month", "قواعد الأجر، بمثال على راتب 20,000 جنيه شهريًا")}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{translate("Situation", "الحالة")}</th>
                <th>{translate("Rule", "القاعدة")}</th>
                <th>{translate("Example", "مثال")}</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r[0]}>
                  <td>{r[0]}</td>
                  <td>{r[1]}</td>
                  <td className="mono">{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sub">{translate("Rates read from Settings, so a change there updates this table and payroll together. Daily wage = monthly wage / 30. Hourly wage = daily wage / 8. Where two rates cover the same hours, the higher is paid. Meal per diem is added on top.", "تُقرأ المعدلات من الإعدادات، فأي تغيير هناك يُحدّث هذا الجدول والرواتب معًا. الأجر اليومي = الأجر الشهري ÷ 30. الأجر بالساعة = الأجر اليومي ÷ 8. عند تداخل معدلين على نفس الساعات، يُدفع الأعلى. يُضاف بدل الوجبات فوق ذلك.")}</div>
      </Panel>
      <div className="grid2">
        <Panel title={translate("Time and attendance", "الوقت والحضور")}>
          {list([
            translate("Week: Sunday to Thursday, 09:00 to 18:00, one unpaid hour at 13:00. 8 hours a day, 40 a week.", "أسبوع العمل: من الأحد إلى الخميس، من 09:00 إلى 18:00، مع ساعة غير مدفوعة عند 13:00. 8 ساعات يوميًا، 40 ساعة أسبوعيًا."),
            translate("Friday is the statutory rest day. Saturday is a company rest day.", "الجمعة هي يوم الراحة القانوني. السبت هو يوم راحة الشركة."),
            translate(`Late: ${c.grace} minutes grace, ${c.graceTimes} times a month. After that late minutes are deducted.`, `التأخير: سماح ${c.grace} دقيقة، ${c.graceTimes} مرات في الشهر. بعد ذلك تُخصم دقائق التأخير.`),
            translate("Absence: tell the line manager before 09:30 on day one.", "الغياب: إخبار المدير المباشر قبل 09:30 في اليوم الأول."),
            translate("Ramadan: 09:00 to 16:00, 6 working hours.", "رمضان: من 09:00 إلى 16:00، 6 ساعات عمل."),
            translate("Overtime needs written approval before the work starts (form HR-F02). Time at work, overtime included, stays under 12 hours a day.", "العمل الإضافي يحتاج موافقة كتابية قبل بدء العمل (نموذج HR-F02). يبقى وقت العمل، بما فيه الإضافي، أقل من 12 ساعة يوميًا."),
            translate("Overtime is paid in the same month by bank transfer. Time off instead of pay only on written request.", "يُدفع العمل الإضافي في نفس الشهر عبر التحويل البنكي. الإجازة التعويضية بدلاً من الأجر فقط بطلب كتابي."),
          ])}
        </Panel>
        <Panel title={translate("Leave", "الإجازات")}>
          {list([
            translate(`Annual: ${c.annualDays} working days a year from year one (law: 15 in year one, 21 from year two).`, `سنوية: ${c.annualDays} يوم عمل سنويًا من السنة الأولى (القانون: 15 يومًا في السنة الأولى، 21 من السنة الثانية).`),
            translate("Casual: up to 7 days a year, 2 at most at a time, from the annual balance.", "عارضة: حتى 7 أيام سنويًا، بحد أقصى يومين في المرة، من رصيد الإجازة السنوية."),
            translate("Request annual leave 14 working days ahead. The manager answers within 5 working days. One block of at least 6 days a year.", "طلب الإجازة السنوية قبل 14 يوم عمل. يرد المدير خلال 5 أيام عمل. فترة واحدة من 6 أيام على الأقل سنويًا."),
            translate("Carry over up to 42 days. Unused days are paid at exit at the daily wage.", "ترحيل حتى 42 يومًا. تُدفع الأيام غير المستخدمة عند ترك الخدمة بالأجر اليومي."),
            translate("Maternity 4 months paid, up to 3 times. Paternity paid on the day of birth.", "إجازة الوضع 4 أشهر بأجر، حتى 3 مرات. إجازة الأبوة بأجر يوم الولادة."),
            translate("Sick leave on a medical certificate, paid as the Social Insurance Law sets.", "الإجازة المرضية بشهادة طبية، تُدفع حسب ما يحدده قانون التأمينات الاجتماعية."),
            translate("Unpaid leave needs the MD in writing.", "الإجازة بدون مرتب تحتاج موافقة كتابية من المدير العام."),
          ])}
        </Panel>
      </div>
      <Panel title={translate("Site visits and travel", "الزيارات الميدانية والسفر")}>
        {list([
          translate("A visit needs a manager approval and a site visit form (HR-F03) with date, site, purpose and expected return.", "الزيارة تحتاج موافقة المدير ونموذج زيارة ميدانية (HR-F03) يتضمن التاريخ والموقع والغرض وتاريخ العودة المتوقع."),
          translate("The company books and pays accommodation and transport. Where the employee pays, it is reimbursed at cost against receipts.", "تحجز الشركة وتدفع تكاليف الإقامة والتنقل. وإذا دفع الموظف، يُرد له المبلغ بالتكلفة مقابل الإيصالات."),
          translate("HSE induction and issued PPE before the first visit. Visit report within 24 hours of return (HR-F04).", "تدريب تعريفي على الصحة والسلامة وتسليم معدات الحماية قبل أول زيارة. تقرير الزيارة خلال 24 ساعة من العودة (HR-F04)."),
          translate("If a visit falls on a Friday, Saturday or holiday, the higher of the visit rate and the rest-day rate applies.", "إذا وقعت الزيارة يوم جمعة أو سبت أو عطلة رسمية، يُطبَّق الأعلى بين معدل الزيارة ومعدل يوم الراحة."),
          translate(`Meal per diem: EGP ${c.perDiem} flat, outside Greater Cairo only. None if the client or hotel provides all meals. HR reviews it every quarter and resets it when prices move 10% or more.`, `بدل الوجبات اليومي: ${c.perDiem} جنيه ثابت، خارج القاهرة الكبرى فقط. لا يُدفع إذا وفّر العميل أو الفندق كل الوجبات. تراجعه الموارد البشرية كل ربع سنة وتعدّله عند تغير الأسعار بنسبة 10% أو أكثر.`),
        ])}
      </Panel>
      <Panel title={translate("Open points", "نقاط مفتوحة")} small={POLICY_OPEN.length}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{translate("Type", "النوع")}</th>
                <th>{translate("Point", "النقطة")}</th>
                <th>{translate("Note", "ملاحظة")}</th>
              </tr>
            </thead>
            <tbody>
              {POLICY_OPEN.map((r) => (
                <tr key={r[1]}>
                  <td>
                    <Pill c={r[0] === translate("Decision", "قرار") ? "info" : "warn"}>{r[0]}</Pill>
                  </td>
                  <td>{r[1]}</td>
                  <td className="sub">{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ===================== Settings ===================== */
export function Settings() {
  const { state, month, call, toast } = useHr();
  const { translate } = useLanguage();
  const c = state?.cfg;
  const f = useFormVals(c ? { ...c, commRule: c.commPro ? "pro" : "full" } : {});
  const [eff, setEff] = useState(month);
  const [note, setNote] = useState("");
  if (!state || !c) return null;
  const edit = canEdit(state.role);
  const cities = (f.v.cities || []) as { n: string; z: string }[];
  const req = (f.v.req || []) as { n: string; m: number; d: string }[];
  const brackets = (f.v.brackets || []) as [number | null, number][];
  const ww = (f.v.workWeek || []) as number[];
  const save = () => {
    const values: Record<string, unknown> = {};
    const keys = ["stdHours", "breakH", "shiftStart", "grace", "graceTimes", "lateDeduct", "annualDays", "workWeek", "otDay", "otNight", "otFri", "otSat", "otHol", "nightFrom", "nightTo", "otBase", "siteGC", "siteOut", "perDiem", "insEmp", "insEr", "insMin", "insMax", "exemption", "brackets", "siteTaxable", "sickPaid", "insBaseMode", "insProrate", "taxMethod", "martyrsPct", "reimbTaxable", "hrName", "mdName", "holidays", "cities", "req"];
    keys.forEach((k) => {
      if (JSON.stringify(f.v[k]) !== JSON.stringify(c[k])) values[k] = f.v[k];
    });
    if ((f.v.commRule === "pro") !== c.commPro) values.commPro = f.v.commRule === "pro";
    if (!Object.keys(values).length) return toast(translate("Nothing changed", "لم يتغير شيء"));
    return call("POST", "settings", { effectiveMonth: eff, values, note }).then(() => toast(translate(`Settings saved, effective from ${mLabel(eff)}`, `تم حفظ الإعدادات، نافذة من ${mLabel(eff)}`)));
  };
  const N = (label: string, k: string, hint?: string, step = "any") => (
    <label>
      {label}
      <input type="number" step={step} value={f.v[k] ?? ""} disabled={!edit} onChange={(e) => f.set(k, e.target.value === "" ? "" : +e.target.value)} data-testid={`set-${k}`} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
  return (
    <>
      <Top title={translate("Settings", "الإعدادات")} />
      <div className="banner info">
        {translate("Every change is dated: it applies from the month you choose, and months before it keep the rates of their time.", "كل تغيير له تاريخ: يُطبَّق من الشهر الذي تختاره، وتحتفظ الشهور السابقة له بمعدلات وقتها.")}
        {state.cfgVersion ? translate(` Current version from ${mLabel(state.cfgVersion.effectiveMonth)}, saved by ${state.cfgVersion.byName}.`, ` الإصدار الحالي من ${mLabel(state.cfgVersion.effectiveMonth)}، حفظه ${state.cfgVersion.byName}.`) : translate(" Using the defaults.", " يُستخدم الإعداد الافتراضي.")}
      </div>
      <div className="setup">
        <Panel title={translate("Working time", "وقت العمل")}>
          <div className="fg">
            {N(translate("Standard hours per day", "ساعات العمل المعتادة يوميًا"), "stdHours")}
            {N(translate("Unpaid break (hours, taken on days over 5 h)", "الراحة غير مدفوعة الأجر (ساعات، في الأيام التي تتجاوز 5 ساعات)"), "breakH")}
            <Inp label={translate("Shift start", "بداية الدوام")} k="shiftStart" f={f} type="time" disabled={!edit} />
            {N(translate("Late grace (minutes)", "سماح التأخير (دقائق)"), "grace")}
            {N(translate("Free grace arrivals per month", "عدد مرات السماح المجانية شهريًا"), "graceTimes")}
            {N(translate("Annual leave (working days a year)", "الإجازة السنوية (يوم عمل سنويًا)"), "annualDays")}
            <div className="full">
              <span className="lbl">{translate("Working days", "أيام العمل")}</span>
              <div className="acts">
                {DN.map((d, i) => (
                  <button key={d} aria-pressed={ww.includes(i)} disabled={!edit} onClick={() => f.set("workWeek", ww.includes(i) ? ww.filter((x) => x !== i) : [...ww, i].sort())}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <Chk label={translate("Deduct late minutes from pay", "خصم دقائق التأخير من الأجر")} k="lateDeduct" f={f} full />
            <Chk label={translate("Pay sick leave in full", "دفع الإجازة المرضية بالكامل")} k="sickPaid" f={f} full />
            <label className="full">
              {translate("Public holidays (one date per line, YYYY-MM-DD)", "العطلات الرسمية (تاريخ واحد في كل سطر، YYYY-MM-DD)")}
              <textarea rows={5} value={f.v.holidays || ""} disabled={!edit} onChange={(e) => f.set("holidays", e.target.value)} />
              <span className="hint">{translate("Fixed-date holidays are pre-filled. Add the moving Islamic holidays when the government announces them.", "العطلات ذات التاريخ الثابت مُدخَلة مسبقًا. أضف العطلات الإسلامية المتغيرة عند إعلان الحكومة عنها.")}</span>
            </label>
          </div>
        </Panel>
        <Panel title={translate("Overtime and site pay", "العمل الإضافي وأجر الموقع")}>
          <div className="fg">
            {N(translate("Day overtime multiplier", "معامل العمل الإضافي النهاري"), "otDay", translate("Policy section 3: wage x 1.35 (06:00 to 22:00)", "السياسة البند 3: الأجر × 1.35 (من 06:00 إلى 22:00)"), "0.05")}
            {N(translate("Night overtime multiplier", "معامل العمل الإضافي الليلي"), "otNight", translate("Policy: wage x 1.70 (22:00 to 06:00)", "السياسة: الأجر × 1.70 (من 22:00 إلى 06:00)"), "0.05")}
            {N(translate("Friday worked (statutory rest day)", "العمل يوم الجمعة (يوم الراحة القانوني)"), "otFri", translate("Policy: daily wage x 2, plus a substitute day. Official text to confirm", "السياسة: الأجر اليومي × 2، بالإضافة إلى يوم بدل. يحتاج تأكيد النص الرسمي"), "0.05")}
            {N(translate("Saturday worked (company rest day)", "العمل يوم السبت (يوم راحة الشركة)"), "otSat", translate("Policy: daily wage x 1.5, company term", "السياسة: الأجر اليومي × 1.5، شرط من الشركة"), "0.05")}
            {N(translate("Official holiday worked", "العمل في عطلة رسمية"), "otHol", translate("Policy: daily wage x 3 in total. Check if the normal holiday pay is already inside it", "السياسة: الأجر اليومي × 3 إجماليًا. تأكد من أن الأجر العادي للعطلة مُدرج داخله"), "0.05")}
            {N(translate("Night starts (hour)", "بداية الليل (ساعة)"), "nightFrom")}
            {N(translate("Night ends (hour)", "نهاية الليل (ساعة)"), "nightTo")}
            <Sel
              label={translate("Overtime hourly rate is based on", "معدل العمل الإضافي بالساعة يُحسب على")}
              k="otBase"
              f={f}
              opts={[
                ["basic", translate("Basic pay", "الأجر الأساسي")],
                ["gross", translate("Total wage (basic plus allowances)", "إجمالي الأجر (الأساسي بالإضافة إلى البدلات)")],
              ]}
              disabled={!edit}
            />
            {N(translate("Site day in Greater Cairo (x daily wage, total)", "يوم موقع داخل القاهرة الكبرى (× الأجر اليومي، إجماليًا)"), "siteGC", translate("Policy section 4: 1.5, so the extra is 0.5 of a day", "السياسة البند 4: 1.5، أي أن الإضافة هي 0.5 من اليوم"), "0.05")}
            {N(translate("Site day outside Greater Cairo (x daily wage, total)", "يوم موقع خارج القاهرة الكبرى (× الأجر اليومي، إجماليًا)"), "siteOut", translate("Policy: 2.0, so the extra is 1.0 of a day", "السياسة: 2.0، أي أن الإضافة هي 1.0 من اليوم"), "0.05")}
            {N(translate("Meal per diem outside Greater Cairo (EGP a day)", "بدل الوجبات اليومي خارج القاهرة الكبرى (جنيه في اليوم)"), "perDiem", translate("Policy section 5: EGP 250 flat", "السياسة البند 5: 250 جنيه ثابت"), "1")}
          </div>
        </Panel>
        <Panel title={translate("Social insurance and income tax", "التأمينات الاجتماعية وضريبة الدخل")}>
          <div className="fg">
            {N(translate("Employee share %", "نسبة حصة الموظف %"), "insEmp", translate("Law 148 of 2019: 11%", "القانون 148 لسنة 2019: 11%"), "0.05")}
            {N(translate("Employer share %", "نسبة حصة الشركة %"), "insEr", translate("Law 148 of 2019: 18.75%", "القانون 148 لسنة 2019: 18.75%"), "0.05")}
            {N(translate("Insurable wage floor (EGP a month)", "الحد الأدنى للأجر التأميني (جنيه شهريًا)"), "insMin", translate("Two sources give 2,700 for 2026; one older page gives 2,300", "مصدران يذكران 2,700 لعام 2026؛ وصفحة أقدم تذكر 2,300"), "1")}
            {N(translate("Insurable wage ceiling (EGP a month)", "الحد الأقصى للأجر التأميني (جنيه شهريًا)"), "insMax", translate("Two sources give 16,700 for 2026; one older page gives 14,500", "مصدران يذكران 16,700 لعام 2026؛ وصفحة أقدم تذكر 14,500"), "1")}
            {N(translate("Personal exemption (EGP a year)", "الإعفاء الشخصي (جنيه سنويًا)"), "exemption", translate("Applied before the brackets", "يُطبَّق قبل الشرائح"), "1")}
            <Sel
              label={translate("Insurable wage is based on", "الأجر التأميني يُحسب على")}
              k="insBaseMode"
              f={f}
              full
              disabled={!edit}
              opts={[
                ["all", translate("Total fixed wage (basic, transport, incentive, other): Law 14 of 2025 Art. 1 counts allowances and incentives as wage", "إجمالي الأجر الثابت (الأساسي، النقل، الحافز، الأخرى): المادة 1 من القانون 14 لسنة 2025 تعتبر البدلات والحوافز جزءًا من الأجر")],
                ["basicother", translate("Basic plus other fixed allowances", "الأساسي بالإضافة إلى البدلات الثابتة الأخرى")],
                ["basic", translate("Basic gross salary only", "الراتب الأساسي الإجمالي فقط")],
              ]}
            />
            <Chk label={translate("Prorate insurance for a partial month (today's rule)", "تناسب التأمين لشهر جزئي (القاعدة الحالية)")} k="insProrate" f={f} full />
            <Sel
              label={translate("Income tax method", "طريقة ضريبة الدخل")}
              k="taxMethod"
              f={f}
              full
              disabled={!edit}
              opts={[
                ["prorated", translate("Annualize the prorated month's pay (today's default)", "حساب سنوي لأجر الشهر المحسوب بالتناسب (الافتراضي الحالي)")],
                ["fullMonthEquivalent", translate("Annualize the full-month-equivalent pay, then prorate the resulting tax", "حساب سنوي لما يعادل أجر الشهر الكامل، ثم حساب الضريبة بالتناسب")],
              ]}
            />
            <div className="hint full">
              {translate("Set the default only after the accountant confirms. Open an employee's Payroll row for a month with a partial-month joiner or leaver to preview both figures side by side before changing this.", "لا تضبط الإعداد الافتراضي إلا بعد تأكيد المحاسب. افتح صف رواتب موظف لشهر فيه التحاق أو ترك جزئي للمقارنة بين الرقمين قبل تغيير هذا الإعداد.")}
            </div>
            {N(translate("Martyrs and Veterans of War Fund %", "صندوق الشهداء ومحاربي الحرب %"), "martyrsPct", translate("0 = off, until Finance confirms the rate and the base (same insurable wage as social insurance)", "0 = معطّل، حتى تؤكد المالية النسبة والأساس (نفس الأجر التأميني المستخدم في التأمينات الاجتماعية)"), "0.01")}
            <Sel
              label={translate("Performance commission", "عمولة الأداء")}
              k="commRule"
              f={f}
              disabled={!edit}
              opts={[
                ["full", translate("Paid in full at 100% of target, nothing below (offer wording)", "تُدفع بالكامل عند 100% من الهدف، ولا شيء دون ذلك (صياغة العرض)")],
                ["pro", translate("Paid pro rata to the percentage achieved, capped at 150%", "تُدفع بالتناسب مع نسبة الإنجاز، بحد أقصى 150%")],
              ]}
            />
            <Chk label={translate("Treat site allowances as taxable pay", "معاملة بدلات الموقع كأجر خاضع للضريبة")} k="siteTaxable" f={f} full />
            <Chk label={translate("Treat receipted reimbursements as taxable pay", "معاملة المبالغ المستردة بإيصالات كأجر خاضع للضريبة")} k="reimbTaxable" f={f} full />
            <div className="full">
              <span className="lbl">{translate("Annual tax brackets (Law 7 of 2024, as reported by payroll guides)", "شرائح الضريبة السنوية (القانون 7 لسنة 2024، كما ورد في دلائل الرواتب)")}</span>
              <table className="mini">
                <thead>
                  <tr>
                    <th>{translate("Up to (EGP a year)", "حتى (جنيه سنويًا)")}</th>
                    <th>{translate("Rate %", "النسبة %")}</th>
                  </tr>
                </thead>
                <tbody>
                  {brackets.map((b, i) => (
                    <tr key={i}>
                      <td>{b[0] == null ? <span className="sub">{translate("Above the last limit", "ما يتجاوز الحد الأخير")}</span> : <input type="number" value={b[0]} disabled={!edit} onChange={(e) => f.set("brackets", brackets.map((x, j) => (j === i ? [+e.target.value, x[1]] : x)))} />}</td>
                      <td>
                        <input type="number" step="0.5" value={b[1]} disabled={!edit} onChange={(e) => f.set("brackets", brackets.map((x, j) => (j === i ? [x[0], +e.target.value] : x)))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
        <Panel title={translate("Cities and zones", "المدن والمناطق")}>
          <div className="sub" style={{ marginBottom: 8 }}>
            {translate("A city with the zone name ", "المدينة التي تحمل اسم المنطقة ")}
            <b>Greater Cairo</b>
            {translate(" (Cairo, Giza, Qalyubia) pays the Greater Cairo site rate with no meal per diem. Any other zone pays the travel rate plus the per diem.", " (القاهرة، الجيزة، القليوبية) تُدفع لها معدل موقع القاهرة الكبرى بدون بدل وجبات. وأي منطقة أخرى تُدفع لها معدل السفر بالإضافة إلى البدل اليومي.")}
          </div>
          <div className="tablewrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>{translate("City", "المدينة")}</th>
                  <th>{translate("Zone", "المنطقة")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cities.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <input value={x.n} disabled={!edit} onChange={(e) => f.set("cities", cities.map((y, j) => (j === i ? { ...y, n: e.target.value } : y)))} />
                    </td>
                    <td>
                      <input value={x.z} disabled={!edit} onChange={(e) => f.set("cities", cities.map((y, j) => (j === i ? { ...y, z: e.target.value } : y)))} />
                    </td>
                    <td>
                      {edit && (
                        <button className="btn sm danger" onClick={() => f.set("cities", cities.filter((_, j) => j !== i))}>
                          {translate("Remove", "إزالة")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {edit && (
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => f.set("cities", [...cities, { n: translate("New city", "مدينة جديدة"), z: "" }])}>
                {translate("Add city", "إضافة مدينة")}
              </button>
            </div>
          )}
        </Panel>
        <Panel title={translate("Required training", "التدريب المطلوب")}>
          <div className="tablewrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>{translate("Course", "الدورة")}</th>
                  <th className="num">{translate("Valid (months)", "سارٍ (أشهر)")}</th>
                  <th>{translate("Applies to", "ينطبق على")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {req.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <input value={x.n} disabled={!edit} onChange={(e) => f.set("req", req.map((y, j) => (j === i ? { ...y, n: e.target.value } : y)))} />
                    </td>
                    <td>
                      <input type="number" value={x.m} disabled={!edit} onChange={(e) => f.set("req", req.map((y, j) => (j === i ? { ...y, m: +e.target.value } : y)))} />
                    </td>
                    <td>
                      <select value={x.d} disabled={!edit} onChange={(e) => f.set("req", req.map((y, j) => (j === i ? { ...y, d: e.target.value } : y)))}>
                        <option value="all">{translate("Everyone", "الجميع")}</option>
                        {state.lists.DEPTS.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {edit && (
                        <button className="btn sm danger" onClick={() => f.set("req", req.filter((_, j) => j !== i))}>
                          {translate("Remove", "إزالة")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {edit && (
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => f.set("req", [...req, { n: translate("New course", "دورة جديدة"), m: 12, d: "all" }])}>
                {translate("Add course", "إضافة دورة")}
              </button>
            </div>
          )}
        </Panel>
        <Panel title={translate("Signatories and approvals", "الموقِّعون والموافقات")}>
          <div className="fg">
            <Inp label={translate("HR officer (prepares payroll)", "مسؤول الموارد البشرية (يُحضّر الرواتب)")} k="hrName" f={f} disabled={!edit} />
            <Inp label={translate("Managing Director (approves)", "المدير العام (يوافق)")} k="mdName" f={f} disabled={!edit} />
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            {translate("Names print on payslips and the register. Each approval step is also stamped with the portal name of the person who took it.", "تُطبَع الأسماء على إيصالات الراتب والسجل. وتُسجَّل كل خطوة موافقة أيضًا باسم البوابة لمن قام بها.")}
          </div>
        </Panel>
        {edit && (
          <Panel title={translate("Save", "حفظ")}>
            <div className="fg">
              <label>
                {translate("Applies from (month)", "يُطبَّق من (الشهر)")}
                <input type="month" value={eff} onChange={(e) => setEff(e.target.value)} data-testid="set-eff" />
              </label>
              <label>
                {translate("Note", "ملاحظة")}
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={translate("Why the change", "سبب التغيير")} />
              </label>
            </div>
            <div className="row2" style={{ marginTop: 8 }}>
              <button className="btn primary" data-testid="set-save" onClick={() => save()?.catch(() => undefined)}>
                {translate("Save settings", "حفظ الإعدادات")}
              </button>
            </div>
          </Panel>
        )}
        {edit && <DataPanel />}
      </div>
    </>
  );
}

function DataPanel() {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  if (!state) return null;
  const hasExample = state.employees.some((e) => e.example);
  return (
    <Panel title={translate("Data", "البيانات")}>
      <p className="sub">{translate("Pay figures are encrypted on the server and shown only to the MD, HR and Finance. National ID numbers and bank account numbers are not stored here; keep scans in the company drive and record the folder path in Documents.", "أرقام الأجور مُشفَّرة على الخادم وتُعرض فقط للمدير العام والموارد البشرية والمالية. لا تُحفظ أرقام البطاقة الشخصية والحسابات البنكية هنا؛ احتفظ بالمسحات في محرك الشركة وسجّل مسار المجلد في المستندات.")}</p>
      <div className="row2">
        {!hasExample && (
          <button className="btn" data-testid="hr-seed-settings" onClick={() => call("POST", "example").then(() => toast(translate("Example team loaded", "تم تحميل فريق تجريبي")))}>
            {translate("Load example team", "تحميل فريق تجريبي")}
          </button>
        )}
        {hasExample && (
          <ArmedButton
            label={translate("Remove example data", "إزالة البيانات التجريبية")}
            armed={translate("Click again to remove", "اضغط مرة أخرى للإزالة")}
            onConfirm={() => call("DELETE", "example").then((r) => toast(translate(`Removed ${r.data.removed} example records`, `تمت إزالة ${r.data.removed} سجل تجريبي`)))}
          />
        )}
      </div>
    </Panel>
  );
}
