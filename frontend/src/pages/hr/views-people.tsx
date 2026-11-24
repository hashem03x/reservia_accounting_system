import { useEffect, useMemo, useState } from "react";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { useLanguage } from "@/context/LanguageContext";
import { canEdit, Employee, fmt, grossOf, mLabel, r1, sum, useHr, diffDays } from "./hr-context";
import { ArmedButton, Chk, Drawer, Empty, Inp, Kpi, Modal, MonthBar, Panel, Pill, Sel, SL, slText, SL_ICON, Top, Txt, useFormVals, useModal } from "./ui";

// Reservia HR Portal - Overview, People (and the employee drawer), Org chart, Documents, Hiring and
// Assets: the reference prototype's vHome, vPeople, empDrawer, vOrg, vDocs, vHire and vAssets.

// Display-only Arabic labels for backend enum values (state.lists.*); the English value itself is
// always kept as the <Sel> option value and in filter/compare logic, per HR Portal D10.
const EMP_STATUS_AR: Record<string, string> = { Active: "نشط", Probation: "تحت الاختبار", Left: "ترك الخدمة" };
const EMP_TYPE_AR: Record<string, string> = { "Full time": "دوام كامل", Contract: "عقد", "Part time": "دوام جزئي", Intern: "متدرب" };
const PAY_METHODS_AR: Record<string, string> = { "Bank transfer": "تحويل بنكي", Cash: "نقدًا", Cheque: "شيك" };
const STAGE_AR: Record<string, string> = { Applied: "تقدَّم", Screened: "تم الفرز", Interview: "مقابلة", Offer: "عرض", Documents: "المستندات", Hired: "تم التعيين", Rejected: "مرفوض" };
const ASSET_TYPE_AR: Record<string, string> = { Laptop: "كمبيوتر محمول", "Mobile phone": "هاتف محمول", "SIM line": "خط شريحة", Vehicle: "سيارة", "PPE set": "طقم معدات حماية", "Tools and meters": "أدوات وعدادات", "Access card or keys": "بطاقة دخول أو مفاتيح", Other: "أخرى" };

export function useEmp() {
  const { state } = useHr();
  return useMemo(() => {
    const byId: Record<string, Employee> = {};
    (state?.employees || []).forEach((e) => (byId[e._id] = e));
    return byId;
  }, [state]);
}
const empSort = (a: Employee, b: Employee) => String(a.code).localeCompare(String(b.code)) || a.name.localeCompare(b.name);

export function usePendingCount() {
  const { state } = useHr();
  if (!state) return 0;
  const st = state.payroll.status;
  return state.forms.filter((f) => f.status === "Pending").length + state.expenses.filter((x) => x.status === "Pending").length + (st === "review" || st === "approved" ? 1 : 0);
}

/* ===================== Overview ===================== */
export function Home() {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  const { go } = useModal();
  const pend = usePendingCount();
  if (!state) return null;
  const E = state.employees.filter((e) => e.status !== "Left");
  if (!state.employees.length && !state.candidates.length)
    return (
      <>
        <Top title={translate("Overview", "نظرة عامة")} />
        <Empty title={translate("No team recorded yet", "لا يوجد فريق مسجَّل بعد")} text={translate("Add your first employee, or load a small example team to see how documents, attendance, overtime, site visits and the monthly payout fit together. Example rows carry an Example tag and can be removed in one click.", "أضف أول موظف، أو حمّل فريقًا تجريبيًا صغيرًا لترى كيف تتكامل المستندات والحضور والعمل الإضافي والزيارات الميدانية والمستحقات الشهرية. تحمل الصفوف التجريبية وسم مثال ويمكن إزالتها بضغطة واحدة.")}>
          {canEdit(state.role) && (
            <div className="row2" style={{ justifyContent: "center" }}>
              <button className="btn primary" onClick={() => go("people", { new: "1" })}>
                {translate("Add first employee", "إضافة أول موظف")}
              </button>
              <button className="btn" data-testid="hr-seed" onClick={() => call("POST", "example").then(() => toast(translate("Example team loaded", "تم تحميل فريق تجريبي")))}>
                {translate("Load example team", "تحميل فريق تجريبي")}
              </button>
            </div>
          )}
        </Empty>
      </>
    );
  const ds = state.docStatus;
  const dsc = E.length && Object.keys(ds).length ? E.reduce((a, e) => a + (ds[e._id]?.score ?? 1), 0) / E.length : 1;
  let exp = 0;
  let soon = 0;
  let miss = 0;
  let tneed = 0;
  let tok = 0;
  const items: [string, string, string, string][] = [];
  E.forEach((e) => {
    const d = ds[e._id]?.docs || {};
    state.lists.DOCS.forEach((doc) => {
      const s = d[doc.k];
      if (s === "exp") {
        exp++;
        items.push(["bad", translate("Document expired", "مستند منتهي"), `${e.name}: ${doc.n}`, "docs"]);
      } else if (s === "soon") {
        soon++;
        items.push(["warn", translate("Document expires soon", "مستند قريب الانتهاء"), `${e.name}: ${doc.n}`, "docs"]);
      }
    });
    const mm = Object.values(d).filter((s) => s === "miss").length;
    if (mm) {
      miss += mm;
      items.push(["warn", translate(`${mm} document${mm > 1 ? "s" : ""} missing`, `${mm} مستند غير متوفر`), e.name, "docs"]);
    }
    state.cfg.req.forEach((rq, i) => {
      const s = state.trnStatus[e._id]?.[i]?.s;
      if (!s || s === "na") return;
      tneed++;
      if (s === "ok" || s === "soon") tok++;
      if (s === "exp") items.push(["bad", translate("Training expired", "تدريب منتهي"), `${e.name}: ${rq.n}`, "train"]);
      else if (s === "miss") items.push(["warn", translate("Training missing", "تدريب غير متوفر"), `${e.name}: ${rq.n}`, "train"]);
      else if (s === "soon") items.push(["warn", translate("Training due soon", "تدريب قريب الاستحقاق"), `${e.name}: ${rq.n}`, "train"]);
    });
  });
  const unrec = sum(Object.values(state.time), (t) => t.t.unrec);
  if (unrec) items.push(["warn", translate(`${unrec} working day${unrec > 1 ? "s" : ""} not recorded`, `${unrec} يوم عمل غير مسجَّل`), mLabel(state.month), "att"]);
  state.candidates.filter((c) => c.stage === "Documents" || c.stage === "Offer").forEach((c) => items.push(["info", translate(`Hiring: ${c.stage}`, `التوظيف: ${translate(c.stage, STAGE_AR[c.stage] || c.stage)}`), `${c.name} (${c.role || ""})`, "hire"]));
  const order: Record<string, number> = { bad: 0, warn: 1, info: 2 };
  items.sort((a, b) => order[a[0]] - order[b[0]]);
  const rows = state.payroll.rows;
  const byDept: Record<string, number> = {};
  rows.forEach((r) => (byDept[r.dept || "Other"] = (byDept[r.dept || "Other"] || 0) + r.net));
  const mx = Math.max(1, ...Object.values(byDept));
  const otHours = sum(Object.values(state.time), (t) => t.otHours);
  return (
    <>
      <Top title={translate("Overview", "نظرة عامة")}>
        <MonthBar />
      </Top>
      <div className="kpis">
        <Kpi label={translate("Headcount", "عدد الموظفين")} value={E.length} sub={translate(`${E.filter((e) => e.status === "Probation").length} on probation`, `${E.filter((e) => e.status === "Probation").length} تحت الاختبار`)} />
        {canEdit(state.role) && <Kpi label={translate("Personnel files complete", "ملفات الموظفين المكتملة")} value={`${Math.round(dsc * 100)}%`} sub={translate(`${miss} documents missing`, `${miss} مستند غير متوفر`)} />}
        {canEdit(state.role) && <Kpi label={translate("Expired or due in 60 days", "منتهية أو مستحقة خلال 60 يومًا")} value={exp + soon} sub={translate(`${exp} expired`, `${exp} منتهي`)} />}
        {canEdit(state.role) && <Kpi label={translate("Training compliance", "الالتزام بالتدريب")} value={tneed ? `${Math.round((tok / tneed) * 100)}%` : translate("n/a", "غير متاح")} sub={translate(`against ${state.cfg.req.length} required courses`, `من ${state.cfg.req.length} دورة مطلوبة`)} />}
        <Kpi label={translate("Overtime hours", "ساعات العمل الإضافي")} value={r1(otHours)} sub={mLabel(state.month)} />
        {state.canSeePay && <Kpi label={translate("Net payout", "صافي المستحقات")} value={fmt(sum(rows, (r) => r.net))} sub={translate(`EGP, ${state.payroll.status}`, `جنيه، ${state.payroll.status}`)} />}
        <Kpi label={translate("Approvals waiting", "موافقات في الانتظار")} value={pend} sub={translate("forms, claims, payroll", "نماذج، مطالبات، رواتب")} alert={!!pend} />
      </div>
      <div className="grid2">
        <Panel title={translate("Needs attention", "يحتاج إلى اهتمام")} small={items.length}>
          {items.length ? (
            <div className="todo">
              {items.slice(0, 12).map((i, n) => (
                <button key={n} onClick={() => go(i[3])}>
                  <Pill c={i[0]}>{i[1]}</Pill>
                  <span className="who">{i[2]}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="sub">{translate("Nothing is overdue. Documents, training and attendance are in order.", "لا يوجد شيء متأخر. المستندات والتدريب والحضور في حالة جيدة.")}</div>
          )}
        </Panel>
        {state.canSeePay && (
          <Panel title={translate("Net payout by department", "صافي المستحقات حسب القسم")} small={mLabel(state.month)}>
            <div className="bars">
              {Object.keys(byDept)
                .sort((a, b) => byDept[b] - byDept[a])
                .map((k) => (
                  <div className="bar" key={k}>
                    <span>{k}</span>
                    <div className="t">
                      <i style={{ width: `${(byDept[k] / mx) * 100}%`, background: "var(--primary)" }} />
                    </div>
                    <span className="v">{fmt(byDept[k])}</span>
                  </div>
                ))}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}

/* ===================== People ===================== */
export function People() {
  const { state } = useHr();
  const { translate } = useLanguage();
  const { open } = useModal();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [st, setSt] = useState("Active");
  if (!state) return null;
  const E = state.employees
    .filter((e) => (!st || (st === "Active" ? e.status !== "Left" : e.status === st)) && (!dept || e.dept === dept) && (!q || `${e.name} ${e.role} ${e.code}`.toLowerCase().includes(q.toLowerCase())))
    .sort(empSort);
  return (
    <>
      <Top title={translate("People", "الموظفون")}>
        {canEdit(state.role) && (
          <button className="btn primary" data-testid="hr-new-emp" onClick={() => open({ type: "emp" })}>
            {translate("Add employee", "إضافة موظف")}
          </button>
        )}
      </Top>
      <div className="filters">
        <input placeholder={translate("Search name, role or code", "ابحث بالاسم أو الوظيفة أو الكود")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">{translate("All departments", "كل الأقسام")}</option>
          {state.lists.DEPTS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="Active">{translate("Current staff", "الموظفون الحاليون")}</option>
          <option value="">{translate("Everyone", "الجميع")}</option>
          <option value="Left">{translate("Left", "ترك الخدمة")}</option>
        </select>
      </div>
      {!E.length ? (
        <Empty title={translate("No employees match", "لا يوجد موظفون مطابقون")} text={translate("Change the filters or add a new employee.", "غيّر الفلاتر أو أضف موظفًا جديدًا.")} />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{translate("Code", "الكود")}</th>
                <th>{translate("Name", "الاسم")}</th>
                <th>{translate("Department", "القسم")}</th>
                <th>{translate("Base city", "مدينة العمل")}</th>
                <th>{translate("Status", "الحالة")}</th>
                <th>{translate("Joined", "تاريخ الالتحاق")}</th>
                {state.canSeePay && <th className="num">{translate("Monthly pay", "الراتب الشهري")}</th>}
                {canEdit(state.role) && <th>{translate("Files", "الملفات")}</th>}
              </tr>
            </thead>
            <tbody>
              {E.map((e) => {
                const sc = Math.round((state.docStatus[e._id]?.score ?? 1) * 100);
                return (
                  <tr key={e._id} onClick={() => open({ type: "emp", id: e._id })} data-testid={`emp-row-${e.code}`}>
                    <td className="mono">{e.code}</td>
                    <td>
                      <b>{e.name}</b> {e.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                      <div className="sub">{e.role}</div>
                    </td>
                    <td>{e.dept}</td>
                    <td>{e.city}</td>
                    <td>
                      <Pill c={e.status === "Active" ? "good" : e.status === "Left" ? "" : "warn"}>{translate(e.status, EMP_STATUS_AR[e.status] || e.status)}</Pill>
                    </td>
                    <td className="mono">{e.hire}</td>
                    {state.canSeePay && <td className="num">{fmt(grossOf(e))}</td>}
                    {canEdit(state.role) && (
                      <td>
                        <Pill c={sc >= 90 ? "good" : sc >= 60 ? "warn" : "bad"}>{sc}%</Pill>
                      </td>
                    )}
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

const addMonths = (s: string, k: number) => {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  const day = d.getDate();
  d.setMonth(d.getMonth() + k);
  if (d.getDate() !== day) d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function EmployeeDrawer({ id }: { id?: string }) {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  const { close, open, go } = useModal();
  const byId = useEmp();
  const e = id ? byId[id] : undefined;
  const today = state?.today || "";
  const f = useFormVals(
    e
      ? { ...e, mgrId: e.mgrId || "" }
      : { status: "Probation", type: "Contract", dept: "Sales", city: "Cairo", paym: "Bank transfer", insured: true, hire: today, cstart: today, cend: addMonths(today, 12), probEnd: addMonths(today, 3), mgr: state?.cfg.mdName || "", nat: "Egyptian" }
  );
  if (!state || (id && !e)) return null;
  const edit = canEdit(state.role);
  const pay = state.canSeePay;
  const save = async () => {
    const body: Record<string, unknown> = {};
    ["code", "name", "role", "dept", "status", "type", "hire", "end", "city", "mgr", "phone", "email", "emg", "emgp", "file", "nat", "sin", "sinRegDate", "edu", "cno", "offerDate", "cstart", "cend", "probEnd", "paym", "insured"].forEach((k) => (body[k] = f.v[k] ?? ""));
    if (edit) body.user = f.v.user || null;
    body.insured = !!f.v.insured;
    if (pay) {
      ["basic", "transport", "incentive", "commission", "other"].forEach((k) => (body[k] = +f.v[k] || 0));
      // HR Portal D5: a blank override means "use the rule" (null), never the digit 0 - sending 0
      // here would re-create the exact bug D5 reports (the field always showing "0").
      body.insBase = f.v.insBase === "" || f.v.insBase == null ? null : +f.v.insBase || 0;
    }
    await (id ? call("PATCH", `employees/${id}`, body) : call("POST", "employees", body));
    toast(translate("Saved", "تم الحفظ"));
    close();
  };
  const t = id ? state.time[id] : undefined;
  const row = id ? state.payroll.rows.find((r) => r.id === id) : undefined;
  const vs = id ? state.visits.filter((v) => v.employee === id && v.status === "Done" && v.date.slice(0, 7) === state.month) : [];
  const trn = id ? state.trainings.filter((x) => x.employee === id).sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
  const ast = id ? state.assets.filter((a) => a.employee === id && !a.returned) : [];
  const ro = !edit;
  return (
    <Drawer title={id ? e!.name : translate("New employee", "موظف جديد")} sub={id ? e!.role : undefined} onClose={close}>
      <div className="fg">
        <Inp label={translate("Employee code", "كود الموظف")} k="code" f={f} placeholder={translate("Next free code", "الكود المتاح التالي")} disabled={ro} />
        <Inp label={translate("Full name", "الاسم الكامل")} k="name" f={f} disabled={ro} />
        <Inp label={translate("Job title", "الوظيفة")} k="role" f={f} disabled={ro} />
        <Sel label={translate("Department", "القسم")} k="dept" f={f} opts={state.lists.DEPTS} disabled={ro} />
        <Sel label={translate("Status", "الحالة")} k="status" f={f} opts={state.lists.EMP_STATUS.map((s) => [s, translate(s, EMP_STATUS_AR[s] || s)] as [string, string])} disabled={ro} />
        <Sel label={translate("Contract type", "نوع العقد")} k="type" f={f} opts={state.lists.EMP_TYPE.map((s) => [s, translate(s, EMP_TYPE_AR[s] || s)] as [string, string])} disabled={ro} />
        <Inp label={translate("Joining date", "تاريخ الالتحاق")} k="hire" f={f} type="date" disabled={ro} />
        <Inp label={translate("Leaving date", "تاريخ ترك الخدمة")} k="end" f={f} type="date" disabled={ro} />
        <Inp label={translate("Base city", "مدينة العمل")} k="city" f={f} disabled={ro} />
        <Inp label={translate("Reports to", "يرفع تقاريره إلى")} k="mgr" f={f} disabled={ro} />
        <Inp label={translate("Mobile", "الهاتف المحمول")} k="phone" f={f} disabled={ro} />
        <Inp label={translate("Email", "البريد الإلكتروني")} k="email" f={f} type="email" disabled={ro} />
        <Inp label={translate("Emergency contact", "جهة الاتصال في حالات الطوارئ")} k="emg" f={f} disabled={ro} />
        <Inp label={translate("Emergency phone", "هاتف الطوارئ")} k="emgp" f={f} disabled={ro} />
        <Inp label={translate("Personnel file location", "موقع ملف شؤون الموظف")} k="file" f={f} full placeholder={translate("e.g. HR cabinet 1, folder EMP-01, and drive path", "مثال: خزانة الموارد البشرية 1، مجلد EMP-01، ومسار المحرك")} disabled={ro} />
        {edit && <PortalLogin f={f} />}
      </div>
      <div className="sect">
        <h4>{translate("Contract", "العقد")}</h4>
        <div className="fg">
          <Inp label={translate("Contract No.", "رقم العقد")} k="cno" f={f} disabled={ro} />
          <Inp label={translate("Offer date", "تاريخ العرض")} k="offerDate" f={f} type="date" disabled={ro} />
          <Inp label={translate("Contract start", "بداية العقد")} k="cstart" f={f} type="date" disabled={ro} />
          <Inp label={translate("Contract end (fixed term)", "نهاية العقد (مدة محددة)")} k="cend" f={f} type="date" disabled={ro} />
          <Inp label={translate("Probation ends", "نهاية فترة الاختبار")} k="probEnd" f={f} type="date" disabled={ro} />
          <Inp label={translate("Nationality", "الجنسية")} k="nat" f={f} disabled={ro} />
          {state.role !== "manager" && <Inp label={translate("Social insurance No.", "رقم التأمين الاجتماعي")} k="sin" f={f} disabled={ro} />}
          {/* HR Portal D5: the registration DATE, not only the number - on the employee record
              itself, not only inside Documents. Hidden from a line manager, same as the number. */}
          {state.role !== "manager" && <Inp label={translate("Social insurance registration date", "تاريخ تسجيل التأمين الاجتماعي")} k="sinRegDate" f={f} type="date" disabled={ro} />}
          <Inp label={translate("Highest qualification", "أعلى شهادة دراسية")} k="edu" f={f} disabled={ro} />
        </div>
        <div className="sub" style={{ marginTop: 6 }}>
          {translate("National ID and bank account numbers are not stored here (policy). Keep them on the signed paper file.", "لا يُحفظ رقم البطاقة الشخصية والحساب البنكي هنا (حسب السياسة). احتفظ بهما في الملف الورقي الموقَّع.")}
        </div>
      </div>
      {pay && (
        <div className="sect">
          <h4>{translate("Monthly pay (EGP, from the signed offer)", "الراتب الشهري (جنيه، من العرض الموقَّع)")}</h4>
          <div className="fg">
            <Inp label={translate("Basic gross salary", "الراتب الأساسي الإجمالي")} k="basic" f={f} type="number" disabled={ro} />
            <Inp label={translate("Transportation allowance", "بدل الانتقال")} k="transport" f={f} type="number" disabled={ro} />
            <Inp label={translate("Incentive monthly payout", "الحافز الشهري")} k="incentive" f={f} type="number" disabled={ro} />
            <Inp label={translate("Performance commission (at 100% target)", "عمولة الأداء (عند 100% من الهدف)")} k="commission" f={f} type="number" disabled={ro} />
            <Inp label={translate("Other fixed allowances", "بدلات ثابتة أخرى")} k="other" f={f} type="number" disabled={ro} />
            <Sel label={translate("Payment method", "طريقة الدفع")} k="paym" f={f} opts={state.lists.PAY_METHODS.map((s) => [s, translate(s, PAY_METHODS_AR[s] || s)] as [string, string])} disabled={ro} />
            <Chk label={translate("Registered for social insurance", "مُسجَّل في التأمين الاجتماعي")} k="insured" f={f} />
            <Inp label={translate("Insurable wage override", "تجاوز الأجر التأميني")} k="insBase" f={f} type="number" placeholder={translate("Blank = rule in Settings", "فارغ = القاعدة في الإعدادات")} disabled={ro} />
            <div className="full sub">
              {translate("Total fixed: ", "الإجمالي الثابت: ")}
              <b className="mono">{fmt(grossOf(f.v))}</b>
              {translate(" a month, plus commission ", " شهريًا، بالإضافة إلى العمولة ")}
              <span className="mono">{fmt(f.v.commission || 0)}</span>
              {translate(" when the target is met.", " عند تحقيق الهدف.")}
            </div>
          </div>
        </div>
      )}
      {id && t && (
        <div className="sect">
          <h4>{translate(`${mLabel(state.month)} at a glance`, `نظرة سريعة على ${mLabel(state.month)}`)}</h4>
          <div className="rowline">
            <span>{translate("Timesheet", "سجل الدوام")}</span>
            <b className="mono">
              {t.approval ? <Pill c="good">{translate("Approved", "مُعتمد")}</Pill> : <Pill c="warn">{t.t.unrec ? translate(`${t.t.unrec} days not recorded`, `${t.t.unrec} يوم غير مسجَّل`) : translate("Open", "مفتوح")}</Pill>} {translate(`${t.t.present} days present`, `${t.t.present} يوم حضور`)}
            </b>
          </div>
          <div className="rowline">
            <span>{translate("Overtime", "العمل الإضافي")}</span>
            <b className="mono">
              {translate(`${r1(t.otHours)} h${row ? ` = ${fmt(row.otPay)}` : ""}`, `${r1(t.otHours)} س${row ? ` = ${fmt(row.otPay)}` : ""}`)}
            </b>
          </div>
          <div className="rowline">
            <span>{translate("Field visits", "الزيارات الميدانية")}</span>
            <b className="mono">
              {vs.length}
              {row ? translate(` = ${fmt(row.site)} allowance`, ` = ${fmt(row.site)} بدل`) : ""}
            </b>
          </div>
          {row && (
            <>
              <div className="rowline">
                <span>{translate("Commission", "العمولة")}</span>
                <b className="mono">{row.tgt == null ? translate("target not entered", "لم يُدخل الهدف") : translate(`${row.tgt}% = ${fmt(row.comm)}`, `${row.tgt}% = ${fmt(row.comm)}`)}</b>
              </div>
              <div className="rowline">
                <span>{translate("Net payout", "صافي المستحقات")}</span>
                <b className="mono">{fmt(row.net)}</b>
              </div>
            </>
          )}
          <div className="row2" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => go("ts", { emp: id })}>
              {translate("Open timesheet", "فتح سجل الدوام")}
            </button>
            {edit && (
              <>
                <button className="btn sm" onClick={() => open({ type: "vis", empId: id })}>
                  {translate("Log a visit", "تسجيل زيارة")}
                </button>
                <button className="btn sm" onClick={() => open({ type: "exp", empId: id })}>
                  {translate("Add expense claim", "إضافة مطالبة مصروفات")}
                </button>
              </>
            )}
            {pay && row && (
              <button className="btn sm" onClick={() => open({ type: "pay", id })}>
                {translate("Payslip", "إيصال الراتب")}
              </button>
            )}
            {/* Bug fix: this button used to show whenever the viewer could see pay, regardless of
                whether a payroll row actually exists for this employee this month (e.g. hired/
                added after the month was closed, or payroll not run yet) - clicking it opened a
                PayDrawer that silently rendered nothing at all (views-pay.tsx). An explicit,
                disabled state with a reason is clearer than hiding the button outright or than a
                silent no-op. */}
            {pay && !row && (
              <button className="btn sm" disabled title={translate(`No payroll record for ${mLabel(state.month)} yet - run or check payroll for this employee.`, `لا يوجد سجل رواتب لشهر ${mLabel(state.month)} حتى الآن - شغّل أو تحقق من الرواتب لهذا الموظف.`)}>
                {translate("Payslip (not available this month)", "إيصال الراتب (غير متاح هذا الشهر)")}
              </button>
            )}
          </div>
        </div>
      )}
      {id && edit && (
        <div className="sect">
          <h4>{translate("Training and certifications", "التدريب والشهادات")}</h4>
          <div className="acts">
            {state.cfg.req.map((rq, i) => {
              const s = state.trnStatus[id]?.[i]?.s || "miss";
              if (s === "na") return null;
              return (
                <button key={i} onClick={() => open({ type: "trn", empId: id, course: rq.n })} style={{ borderColor: `var(--${({ ok: "good", soon: "warn", exp: "bad", miss: "bad" } as Record<string, string>)[s] || "line"})` }}>
                  {rq.n}: {slText(s, translate)}
                </button>
              );
            })}
          </div>
          {trn.length ? (
            trn.slice(0, 8).map((x) => (
              <div className="rowline" key={x._id}>
                <span>
                  <button className="lnk" onClick={() => open({ type: "trn", id: x._id })}>
                    {x.course}
                  </button>{" "}
                  <span className="sub">
                    {x.kind || translate("Training course", "دورة تدريبية")}
                    {x.provider ? `, ${x.provider}` : ""}
                  </span>
                </span>
                <span className="mono sub">
                  {x.date}
                  {x.exp ? translate(` to ${x.exp}`, ` إلى ${x.exp}`) : ""}
                </span>
              </div>
            ))
          ) : (
            <div className="sub">{translate("No courses or certificates logged yet.", "لا توجد دورات أو شهادات مسجَّلة بعد.")}</div>
          )}
        </div>
      )}
      {id && edit && (
        <div className="sect">
          <h4>{translate("Company assets held", "عهد الشركة الموجودة")}</h4>
          {ast.length ? (
            ast.map((a) => (
              <div className="rowline" key={a._id}>
                <span>
                  <button className="lnk" onClick={() => open({ type: "ast", id: a._id })}>
                    {translate(a.type, ASSET_TYPE_AR[a.type] || a.type)}
                  </button>{" "}
                  <span className="sub">
                    {a.desc}
                    {a.serial ? ` · ${a.serial}` : ""}
                  </span>
                </span>
                <span className="mono sub">{a.issued}</span>
              </div>
            ))
          ) : (
            <div className="sub">{translate("Nothing issued. Use the belongings sheet when handing over a laptop, phone or SIM.", "لا توجد عهد مُسلَّمة. استخدم كشف العهد عند تسليم كمبيوتر محمول أو هاتف أو شريحة.")}</div>
          )}
          <div className="row2" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => open({ type: "ast", empId: id })}>
              {translate("Issue an asset", "تسليم عهدة")}
            </button>
          </div>
        </div>
      )}
      <div className="row2">
        {edit && (
          <button className="btn primary" data-testid="hr-save-emp" onClick={save}>
            {translate("Save", "حفظ")}
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton
              label={translate("Delete", "حذف")}
              armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")}
              onConfirm={() =>
                call("DELETE", `employees/${id}`)
                  .then(() => {
                    toast(translate("Employee deleted", "تم حذف الموظف"));
                    close();
                  })
                  .catch(() => undefined)
              }
            />
          </span>
        )}
      </div>
    </Drawer>
  );
}

/** Links a person to their portal login, so a line manager sees and approves for their direct reports. */
function PortalLogin({ f }: { f: ReturnType<typeof useFormVals> }) {
  const { translate } = useLanguage();
  const privateRequest = usePrivateRequest();
  const [logins, setLogins] = useState<{ _id: string; name: string; email: string; role: string }[]>([]);
  useEffect(() => {
    privateRequest({ url: "hr/logins" })
      .then((r) => setLogins(r.data || []))
      .catch(() => setLogins([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Sel
      label={translate("Portal login (line managers: links their team)", "تسجيل دخول البوابة (المديرون المباشرون: يربط فريقهم)")}
      k="user"
      f={f}
      full
      opts={[["", translate("Not linked", "غير مرتبط")], ...logins.map((u) => [u._id, `${u.name} (${u.email}, HR ${u.role})`] as [string, string])]}
    />
  );
}

/* ===================== Org chart ===================== */
export function Org() {
  const { state, download } = useHr();
  const { translate } = useLanguage();
  const { open } = useModal();
  if (!state) return null;
  const E = state.employees.filter((e) => e.status !== "Left");
  if (!E.length)
    return (
      <>
        <Top title={translate("Org chart", "الهيكل التنظيمي")} />
        <Empty title={translate("No employees yet", "لا يوجد موظفون بعد")} text={translate('Add people with a "Reports to" name and the chart builds itself.', 'أضف الموظفين مع اسم "يرفع تقاريره إلى" وسيُبنى المخطط تلقائيًا.')} />
      </>
    );
  const byName: Record<string, Employee> = {};
  E.forEach((e) => (byName[String(e.name || "").trim().toLowerCase()] = e));
  const kids: Record<string, Employee[]> = {};
  const roots: Employee[] = [];
  E.forEach((e) => {
    const p = byName[String(e.mgr || "").trim().toLowerCase()];
    if (p && p._id !== e._id) (kids[p._id] = kids[p._id] || []).push(e);
    else roots.push(e);
  });
  const seen: Record<string, 1> = {};
  const node = (e: Employee, d: number): JSX.Element | null => {
    if (seen[e._id] || d > 8) return null;
    seen[e._id] = 1;
    const k = (kids[e._id] || []).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <li key={e._id}>
        <div className="node" tabIndex={0} role="button" onClick={() => open({ type: "emp", id: e._id })}>
          <b>{e.name}</b>
          <small>
            {e.role}
            {e.dept ? ` · ${e.dept}` : ""}
          </small>
        </div>
        {k.length > 0 && <ul>{k.map((x) => node(x, d + 1))}</ul>}
      </li>
    );
  };
  const md = state.cfg.mdName;
  const mdKey = String(md || "").trim().toLowerCase();
  // If an employee record matching the configured MD name exists, exclude them from the
  // regular tree and show their real direct reports under the header node instead - otherwise
  // they'd render twice (once as the header, once as their own direct report) once such a
  // record is created (the MD intentionally has no employee record by default).
  const mdEmployee = mdKey ? byName[mdKey] : undefined;
  const visibleRoots = mdEmployee ? roots.filter((e) => e._id !== mdEmployee._id) : roots;
  const top = visibleRoots.filter((e) => String(e.mgr || "").trim().toLowerCase() === mdKey || !e.mgr);
  const other = visibleRoots.filter((e) => !top.includes(e));
  const mdDirectReports = mdEmployee ? (kids[mdEmployee._id] || []).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const byDept: Record<string, number> = {};
  E.forEach((e) => (byDept[e.dept || "Other"] = (byDept[e.dept || "Other"] || 0) + 1));
  return (
    <>
      <Top title={translate("Org chart", "الهيكل التنظيمي")}>
        {canEdit(state.role) && (
          <button className="btn" onClick={() => download(`exports/org.csv?month=${state.month}`)}>
            {translate("Export CSV", "تصدير CSV")}
          </button>
        )}
      </Top>
      <div className="kpis">
        <Kpi label={translate("Headcount", "عدد الموظفين")} value={E.length} sub={translate(`${Object.keys(byDept).length} departments`, `${Object.keys(byDept).length} قسم`)} />
        <Kpi label={translate("Managers", "المديرون")} value={Object.keys(kids).length} sub={translate("with direct reports", "لديهم مرؤوسون مباشرون")} />
        <Kpi label={translate("Largest team", "أكبر فريق")} value={Math.max(0, ...Object.values(kids).map((k) => k.length))} sub={translate("direct reports", "مرؤوسون مباشرون")} />
      </div>
      <Panel title={translate("Reporting lines", "خطوط التسلسل الإداري")}>
        <ul className="tree">
          <li>
            <div className="node">
              <b>{md || <span className="sub">{translate("Not assigned", "غير مُعيَّن")}</span>}</b>
              <small>
                {translate("Managing Director", "المدير العام")}
                {!md && translate(" - set in Settings", " - يُحدَّد في الإعدادات")}
              </small>
            </div>
            <ul>
              {mdDirectReports.map((e) => node(e, 1))}
              {top.map((e) => node(e, 1))}
            </ul>
          </li>
          {other.map((e) => node(e, 1))}
        </ul>
        {other.length > 0 && <div className="sub" style={{ marginTop: 8 }}>{translate('People whose "Reports to" does not match an employee name are shown at the top level. Fix the spelling in their record.', 'الموظفون الذين لا يتطابق حقل "يرفع تقاريره إلى" لديهم مع اسم موظف يظهرون في المستوى الأعلى. صحّح الإملاء في سجلهم.')}</div>}
      </Panel>
      <Panel title={translate("By department", "حسب القسم")}>
        <div className="bars">
          {Object.keys(byDept)
            .sort((a, b) => byDept[b] - byDept[a])
            .map((k) => (
              <div className="bar" key={k}>
                <span>{k}</span>
                <div className="t">
                  <i style={{ width: `${(byDept[k] / E.length) * 100}%`, background: "var(--primary)" }} />
                </div>
                <span className="v">{byDept[k]}</span>
              </div>
            ))}
        </div>
      </Panel>
    </>
  );
}

/* ===================== Documents ===================== */
export function Docs() {
  const { state, download } = useHr();
  const { translate } = useLanguage();
  const { open } = useModal();
  const [dq, setDq] = useState("");
  if (!state) return null;
  const E = state.employees.filter((e) => e.status !== "Left").sort(empSort);
  if (!E.length)
    return (
      <>
        <Top title={translate("Documents", "المستندات")} />
        <Empty title={translate("No employees yet", "لا يوجد موظفون بعد")} text={translate("Add people first, then track each document here.", "أضف الموظفين أولاً، ثم تابع كل مستند هنا.")} />
      </>
    );
  const idx: { e: Employee; d: (typeof state.lists.DOCS)[number]; r: { date?: string; exp?: string; loc?: string } }[] = [];
  E.forEach((e) => state.lists.DOCS.forEach((d) => e.docs?.[d.k]?.st === "ok" && idx.push({ e, d, r: e.docs[d.k] })));
  const shown = idx.filter((x) => !dq || `${x.e.name} ${x.d.n} ${x.r.loc || ""}`.toLowerCase().includes(dq.toLowerCase()));
  return (
    <>
      <Top title={translate("Documents", "المستندات")}>
        <button className="btn" onClick={() => download(`exports/personnel.csv?month=${state.month}`)}>
          {translate("Export checklist", "تصدير القائمة")}
        </button>
      </Top>
      <div className="legend">
        {["ok", "soon", "exp", "miss", "na"].map((k) => (
          <span key={k}>
            <span className={`dc ${k} s`}>{SL_ICON[k]}</span> {slText(k, translate)} &nbsp;{" "}
          </span>
        ))}
        <span className="sub">{translate("Select a cell to record the document, its expiry and where it is kept.", "اختر خلية لتسجيل المستند وتاريخ انتهائه ومكان حفظه.")}</span>
      </div>
      <div className="tablewrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>{translate("Employee", "الموظف")}</th>
              {state.lists.DOCS.map((d) => (
                <th className="vh" title={d.n} key={d.k}>
                  {d.s}
                </th>
              ))}
              <th className="num">{translate("Done", "مكتمل")}</th>
            </tr>
          </thead>
          <tbody>
            {E.map((e) => (
              <tr key={e._id}>
                <td>
                  <button className="lnk" onClick={() => open({ type: "emp", id: e._id })}>
                    {e.name}
                  </button>
                  <div className="sub">{e.role}</div>
                </td>
                {state.lists.DOCS.map((d) => {
                  const s = state.docStatus[e._id]?.docs[d.k] || "miss";
                  return (
                    <td className="cc" key={d.k}>
                      <button className={`dc ${s}`} title={translate(`${d.n}: ${SL[s][0]}`, `${d.n}: ${slText(s, translate)}`)} aria-label={translate(`${e.name}, ${d.n}, ${SL[s][0]}`, `${e.name}, ${d.n}, ${slText(s, translate)}`)} data-testid={`doc-${e.code}-${d.k}`} onClick={() => open({ type: "doc", id: e._id, k: d.k })}>
                        {SL_ICON[s]}
                      </button>
                    </td>
                  );
                })}
                <td className="num">{Math.round((state.docStatus[e._id]?.score ?? 1) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Panel title={translate("Storage index", "فهرس الحفظ")} small={translate(`${idx.length} documents on file`, `${idx.length} مستند محفوظ`)}>
        <div className="filters" style={{ marginBottom: 10 }}>
          <input placeholder={translate("Find a document, person or location", "البحث عن مستند أو شخص أو موقع")} value={dq} onChange={(e) => setDq(e.target.value)} />
        </div>
        {shown.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{translate("Employee", "الموظف")}</th>
                  <th>{translate("Document", "المستند")}</th>
                  <th>{translate("Kept at", "محفوظ في")}</th>
                  <th>{translate("Received", "تاريخ الاستلام")}</th>
                  <th>{translate("Expires", "تاريخ الانتهاء")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={`${x.e._id}-${x.d.k}`} onClick={() => open({ type: "doc", id: x.e._id, k: x.d.k })}>
                    <td>{x.e.name}</td>
                    <td>{x.d.n}</td>
                    <td>{x.r.loc || <span className="warnline">{translate("Add a location", "إضافة موقع")}</span>}</td>
                    <td className="mono">{x.r.date}</td>
                    <td className="mono">{x.r.exp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sub">{translate("No documents recorded as received yet.", "لا توجد مستندات مسجَّلة كمُستلمة بعد.")}</div>
        )}
      </Panel>
    </>
  );
}

export function DocModal({ id, k }: { id: string; k: string }) {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  const { close } = useModal();
  const e = useEmp()[id];
  const d = state?.lists.DOCS.find((x) => x.k === k);
  const r = e?.docs?.[k] || { st: "pending" };
  const f = useFormVals({ st: r.st || "pending", date: r.date || state?.today, exp: r.exp || "", loc: r.loc || "" });
  if (!state || !e || !d) return null;
  return (
    <Modal title={`${e.name}: ${d.n}`} onClose={close}>
      <div className="fg">
        <Sel
          label={translate("Status", "الحالة")}
          k="st"
          f={f}
          opts={[
            ["pending", translate("Not received", "لم يُستلم")],
            ["ok", translate("Received and filed", "تم الاستلام والحفظ")],
            ["na", translate("Not applicable", "غير ينطبق")],
          ]}
        />
        <Inp label={translate("Date received", "تاريخ الاستلام")} k="date" f={f} type="date" />
        {d.exp && <Inp label={translate("Expiry date", "تاريخ الانتهاء")} k="exp" f={f} type="date" />}
        <Inp label={translate("Where it is kept", "مكان الحفظ")} k="loc" f={f} full placeholder={translate("e.g. HR cabinet 1, folder EMP-01 / Drive: HR/Personnel/EMP-01", "مثال: خزانة الموارد البشرية 1، مجلد EMP-01 / المحرك: HR/Personnel/EMP-01")} />
      </div>
      <div className="row2">
        {canEdit(state.role) && (
          <button className="btn primary" data-testid="hr-save-doc" onClick={() => call("PUT", `employees/${id}/documents/${k}`, f.v).then(() => (toast(translate("Saved", "تم الحفظ")), close()))}>
            {translate("Save", "حفظ")}
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Hiring ===================== */
const STAGE_COLOR: Record<string, string> = { Applied: "s0", Screened: "s1", Interview: "s2", Offer: "s3", Documents: "s4", Hired: "s6" };
export function Hire() {
  const { state } = useHr();
  const { translate } = useLanguage();
  const { open } = useModal();
  if (!state) return null;
  const cs = state.candidates;
  return (
    <>
      <Top title={translate("Hiring", "التوظيف")}>
        <button className="btn primary" onClick={() => open({ type: "cand" })}>
          {translate("Add candidate", "إضافة مرشَّح")}
        </button>
      </Top>
      {!cs.length ? (
        <Empty title={translate("No candidates yet", "لا يوجد مرشَّحون بعد")} text={translate("Track each applicant from first contact to signed documents, then convert them into an employee record in one step.", "تابع كل متقدِّم من أول اتصال حتى توقيع المستندات، ثم حوّله إلى سجل موظف بخطوة واحدة.")} />
      ) : (
        <>
          <div className="board">
            {state.lists.STAGES.filter((s) => s !== "Rejected").map((s) => {
              const L = cs.filter((c) => c.stage === s);
              return (
                <div className="col" key={s}>
                  <h3>
                    <i style={{ ["--c" as string]: `var(--${STAGE_COLOR[s]})` }} />
                    {translate(s, STAGE_AR[s] || s)}
                    <span>{L.length}</span>
                  </h3>
                  {L.map((c) => (
                    <div className="card" key={c._id} tabIndex={0} role="button" onClick={() => open({ type: "cand", id: c._id })} style={{ ["--c" as string]: `var(--${STAGE_COLOR[s]})` }}>
                      <b>
                        {c.name} {c.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                      </b>
                      <div className="row">
                        <span>{c.role}</span>
                        {c.start && <span className="mono">{c.start}</span>}
                      </div>
                      {c.offer ? <div className="row mono">{translate("Offer", "العرض")} {fmt(c.offer)}</div> : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {cs.some((c) => c.stage === "Rejected") && (
            <div className="sub">
              {translate("Not progressed:", "لم يتقدَّموا:")}{" "}
              {cs
                .filter((c) => c.stage === "Rejected")
                .map((c) => (
                  <button key={c._id} className="lnk" onClick={() => open({ type: "cand", id: c._id })}>
                    {c.name}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

export function CandModal({ id }: { id?: string }) {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  const { close, open } = useModal();
  const c = id ? state?.candidates.find((x) => x._id === id) : null;
  const f = useFormVals(c ? { ...c } : { stage: "Applied", dept: "Sales" });
  if (!state || (id && !c)) return null;
  const save = () => call(id ? "PATCH" : "POST", id ? `records/candidates/${id}` : "records/candidates", f.v).then(() => (toast(translate("Saved", "تم الحفظ")), close()));
  return (
    <Modal title={id ? c?.name || "" : translate("New candidate", "مرشَّح جديد")} onClose={close}>
      <div className="fg">
        <Inp label={translate("Full name", "الاسم الكامل")} k="name" f={f} />
        <Inp label={translate("Role applied for", "الوظيفة المتقدَّم لها")} k="role" f={f} />
        <Sel label={translate("Department", "القسم")} k="dept" f={f} opts={state.lists.DEPTS} />
        <Sel label={translate("Stage", "المرحلة")} k="stage" f={f} opts={state.lists.STAGES.map((s) => [s, translate(s, STAGE_AR[s] || s)] as [string, string])} />
        <Inp label={translate("Source", "المصدر")} k="src" f={f} placeholder={translate("LinkedIn, referral, Wuzzuf", "لينكد إن، ترشيح، ووزف")} />
        <Inp label={translate("Mobile", "الهاتف المحمول")} k="phone" f={f} />
        <Inp label={translate("Email", "البريد الإلكتروني")} k="email" f={f} type="email" />
        <Inp label={translate("Offered monthly basic (EGP)", "الراتب الأساسي الشهري المعروض (جنيه)")} k="offer" f={f} type="number" />
        <Inp label={translate("Planned start date", "تاريخ البدء المخطط")} k="start" f={f} type="date" />
        <Txt label={translate("Notes", "ملاحظات")} k="notes" f={f} />
      </div>
      <div className="row2">
        <button className="btn primary" onClick={save}>
          {translate("Save", "حفظ")}
        </button>
        {/* F23: gated on whether a real employee record was ever created (c.employee), not on
            stage - a candidate manually moved to "Hired" via the Stage dropdown above (without
            using this button) used to make this button disappear with no way back, forcing a
            second, manual re-entry of the same person as a brand-new employee. */}
        {id && !c?.employee && (
          <button
            className="btn"
            onClick={() =>
              call("POST", `candidates/${id}/hire`).then((res) => {
                toast(translate("Employee record created. Complete the pay details.", "تم إنشاء سجل الموظف. استكمل تفاصيل الراتب."));
                open({ type: "emp", id: res.data._id });
              })
            }
          >
            {translate("Convert to employee", "تحويل إلى موظف")}
          </button>
        )}
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton label={translate("Delete", "حذف")} armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")} onConfirm={() => call("DELETE", `records/candidates/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Assets ===================== */
export function Assets() {
  const { state, openPdf } = useHr();
  const { translate } = useLanguage();
  const { open } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const A = [...state.assets].sort((a, b) => String(b.issued || "").localeCompare(String(a.issued || "")));
  const out = A.filter((a) => !a.returned);
  return (
    <>
      <Top title={translate("Assets", "العهد")}>
        <button className="btn primary" onClick={() => open({ type: "ast" })}>
          {translate("Issue an asset", "تسليم عهدة")}
        </button>
      </Top>
      <div className="kpis">
        <Kpi label={translate("Items issued", "عهد مُسلَّمة")} value={out.length} sub={translate(`${A.length - out.length} returned`, `${A.length - out.length} مُستردَّة`)} />
        <Kpi label={translate("Laptops out", "كمبيوترات محمولة بالخارج")} value={out.filter((a) => a.type === "Laptop").length} />
        <Kpi label={translate("Phones and SIM lines", "الهواتف وخطوط الشرائح")} value={out.filter((a) => a.type === "Mobile phone" || a.type === "SIM line").length} />
        <Kpi label={translate("Vehicles", "السيارات")} value={out.filter((a) => a.type === "Vehicle").length} />
      </div>
      {!A.length ? (
        <Empty title={translate("No assets recorded", "لا توجد عهد مسجَّلة")} text={translate("Record each laptop, phone, SIM line, vehicle and PPE set against the person who holds it. Print the belongings sheet at handover and again at return.", "سجّل كل كمبيوتر محمول وهاتف وخط شريحة وسيارة وطقم معدات حماية مقابل الشخص الذي يحتفظ به. اطبع كشف العهد عند التسليم وعند الاسترداد مرة أخرى.")} />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{translate("Type", "النوع")}</th>
                <th>{translate("Description", "الوصف")}</th>
                <th>{translate("Serial or number", "الرقم المسلسل أو العدد")}</th>
                <th>{translate("Held by", "في عهدة")}</th>
                <th>{translate("Issued", "تاريخ التسليم")}</th>
                <th>{translate("Returned", "تاريخ الاسترداد")}</th>
                <th>{translate("Condition", "الحالة")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {A.map((a) => (
                <tr key={a._id} onClick={() => open({ type: "ast", id: a._id })}>
                  <td>{translate(a.type, ASSET_TYPE_AR[a.type] || a.type)}</td>
                  <td>
                    {a.desc} {a.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                  </td>
                  <td className="mono">{a.serial}</td>
                  <td>{byId[a.employee]?.name || translate("(removed)", "(محذوف)")}</td>
                  <td className="mono">{a.issued}</td>
                  <td className="mono">{a.returned || <Pill c="good">{translate("In use", "قيد الاستخدام")}</Pill>}</td>
                  <td className="sub">{a.cond}</td>
                  <td>
                    <button
                      className="btn sm"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openPdf(`sheets/belongings?empId=${a.employee}`);
                      }}
                    >
                      {translate("Belongings sheet", "كشف العهد")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sub">{translate("Use the signed belongings sheet (mobile, line, laptop) for the handover and keep it in the personnel file. Exit clearance in Forms checks these items are back.", "استخدم كشف العهد الموقَّع (الهاتف، الخط، الكمبيوتر المحمول) عند التسليم واحفظه في ملف شؤون الموظف. يتأكد إخلاء الطرف في النماذج من استرداد هذه العهد.")}</div>
    </>
  );
}

export function AssetModal({ id, empId }: { id?: string; empId?: string }) {
  const { state, call, toast } = useHr();
  const { translate } = useLanguage();
  const { close } = useModal();
  const a = id ? state?.assets.find((x) => x._id === id) : null;
  const f = useFormVals(a ? { ...a, empId: a.employee } : { type: "Laptop", issued: state?.today, empId: empId || "", cond: "New" });
  if (!state || (id && !a)) return null;
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  return (
    <Modal title={id ? translate("Asset", "العهدة") : translate("Issue an asset", "تسليم عهدة")} onClose={close}>
      <div className="fg">
        <Sel label={translate("Held by", "في عهدة")} k="empId" f={f} opts={[["", translate("Choose", "اختر")], ...emps]} />
        <Sel label={translate("Type", "النوع")} k="type" f={f} opts={state.lists.ASSET_TYPES.map((s) => [s, translate(s, ASSET_TYPE_AR[s] || s)] as [string, string])} />
        <Inp label={translate("Description (make, model, number)", "الوصف (الماركة، الموديل، العدد)")} k="desc" f={f} />
        <Inp label={translate("Serial or IMEI", "الرقم المسلسل أو IMEI")} k="serial" f={f} />
        <Inp label={translate("Issued on", "تاريخ التسليم")} k="issued" f={f} type="date" />
        <Inp label={translate("Returned on", "تاريخ الاسترداد")} k="returned" f={f} type="date" />
        <Inp label={translate("Condition", "الحالة")} k="cond" f={f} />
        <Inp label={translate("Value (EGP, optional)", "القيمة (جنيه، اختياري)")} k="value" f={f} type="number" />
        <Txt label={translate("Notes", "ملاحظات")} k="note" f={f} />
      </div>
      <div className="row2">
        <button className="btn primary" onClick={() => call(id ? "PATCH" : "POST", id ? `records/assets/${id}` : "records/assets", f.v).then(() => (toast(translate("Saved", "تم الحفظ")), close()))}>
          {translate("Save", "حفظ")}
        </button>
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton label={translate("Delete", "حذف")} armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")} onConfirm={() => call("DELETE", `records/assets/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

export const probationSoon = (e: Employee, today: string) => {
  const pe = e.probEnd || (e.hire ? addMonths(e.hire, 3) : "");
  return pe && diffDays(pe, today) >= 0 && diffDays(pe, today) <= 30;
};
