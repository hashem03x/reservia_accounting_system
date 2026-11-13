import { useState } from "react";
import { canEdit, DN, fmt, Form, mLabel, r1, sum, useHr } from "./hr-context";
import { ArmedButton, Chk, Empty, Inp, Kpi, Modal, MonthBar, Panel, Pill, Sel, SL, SL_ICON, statusPill, Top, Txt, useFormVals, useModal } from "./ui";
import { probationSoon, useEmp, usePendingCount } from "./views-people";

// Reservia HR Portal - Approvals, Forms (HR-F01 to F06), Training, Performance, Policy and Settings:
// the reference prototype's vAppr, vForms/frmModal, vTrain, vPerf, vPolicy and vSet.

const FT: Record<string, { c: string; t: string; d: string }> = {
  leave: { c: "HR-F01", t: "Leave request", d: "Annual, casual, sick, unpaid, maternity or paternity leave." },
  ot: { c: "HR-F02", t: "Overtime and rest-day approval", d: "Written approval before overtime, Friday, Saturday or holiday work starts." },
  visit: { c: "HR-F03", t: "Site visit request", d: "Manager approval before any site visit or domestic trip." },
  hire: { c: "HR-F05", t: "New hire checklist", d: "Documents that must be on file before day 1, pulled from the personnel file." },
  exit: { c: "HR-F06", t: "Exit clearance", d: "Twelve steps from notice to the closed file." },
};
const EXIT_STEPS: [string, string][] = [
  ["Written notice received (3 months, open-ended contract)", "Employee or HR"], ["Handover plan: projects, bids, drawings, client contacts, passwords", "Line manager"],
  ["Handover note and file index signed", "Employee and successor"], ["Exit interview form completed", "HR"],
  ["Assets returned: laptop, phone, ID, keys, PPE, vehicle, SIM, site cards", "Employee and IT"], ["Email, ERP, CRM and shared drive access closed", "IT"],
  ["Clearance signed by line manager, IT, finance and HR", "HR"], ["Final settlement: salary, unused leave at daily wage, overtime, allowances, less advances", "Finance"],
  ["Exit form sent to the Social Insurance Authority", "HR"], ["Experience certificate issued (within 15 days of request)", "HR"],
  ["NDA reminder letter sent", "HR"], ["Employee file closed and kept 5 years", "HR"],
];

export function frmSummary(f: Form) {
  if (f.ft === "leave") return `${f.ltype}, ${f.from} to ${f.to} (${f.days || 0} working days)`;
  if (f.ft === "ot") return `${f.kind} on ${f.odate}, ${f.hours || 0} h${f.site ? `, ${f.site}` : ""}${f.exception ? " (after the fact)" : ""}`;
  if (f.ft === "visit") return `${f.city}, ${f.site}, from ${f.from} (${f.days || 1} d)`;
  return "";
}

/* ===================== Approvals ===================== */
export function Approvals() {
  const { state } = useHr();
  const { open, go } = useModal();
  const byId = useEmp();
  usePendingCount();
  if (!state) return null;
  const F2 = state.forms.filter((f) => f.status === "Pending").sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")));
  const X = state.expenses.filter((x) => x.status === "Pending");
  const unap = state.inMonth.filter((id) => !state.time[id]?.approval);
  const st = state.payroll.status;
  return (
    <>
      <Top title="Approvals">
        <MonthBar />
      </Top>
      <div className="kpis">
        <Kpi label="Forms waiting" value={F2.length} sub="leave, overtime, visits" alert={!!F2.length} />
        <Kpi label="Expense claims waiting" value={X.length} sub={`${fmt(sum(X, (x) => x.amount))} EGP`} alert={!!X.length} />
        <Kpi label="Timesheets open" value={unap.length} sub={`of ${state.inMonth.length} for ${mLabel(state.month)}`} />
        <Kpi label="Payroll" value={st} sub={st === "review" ? "waiting for the MD" : st === "approved" ? "ready to close" : st === "closed" ? "locked" : "HR working"} />
      </div>
      <Panel title="How approval works">
        <div className="flow">
          <span className="on">Employee or HR enters</span>
          <span>Line manager approves forms, claims and timesheets</span>
          <span>HR prepares payroll and submits</span>
          <span>MD approves</span>
          <span>HR closes, pays and posts to ERP</span>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          Each approval is stamped with your portal name. Forms and claims are decided inside the item; payroll stages are on the Payroll page.
        </div>
      </Panel>
      <div className="grid2">
        <Panel title="Forms waiting" small={F2.length}>
          {F2.length ? (
            <div className="todo">
              {F2.map((f) => (
                <button key={f._id} onClick={() => open({ type: "frm", id: f._id, ft: f.ft })} data-testid={`appr-form-${f._id}`}>
                  <Pill c="warn">{FT[f.ft].t}</Pill>
                  <span className="who">
                    {byId[f.employee]?.name}: {frmSummary(f)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="sub">Nothing waiting.</div>
          )}
        </Panel>
        <Panel title="Expense claims waiting" small={X.length}>
          {X.length ? (
            <div className="todo">
              {X.map((x) => (
                <button key={x._id} onClick={() => open({ type: "exp", id: x._id })}>
                  <Pill c="warn">{fmt(x.amount)}</Pill>
                  <span className="who">
                    {byId[x.employee]?.name}: {x.type}
                    {x.desc ? `, ${x.desc}` : ""} ({x.date}){!x.receipt && <span className="warnline"> no receipt</span>}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="sub">Nothing waiting.</div>
          )}
        </Panel>
        <Panel title="Timesheets not approved" small={unap.length}>
          {unap.length ? (
            <div className="todo">
              {unap.map((id) => {
                const t = state.time[id];
                return (
                  <button key={id} onClick={() => go("ts", { emp: id })}>
                    <Pill c={t.t.unrec ? "bad" : "info"}>{t.t.unrec ? `${t.t.unrec} blank` : "complete"}</Pill>
                    <span className="who">
                      {byId[id]?.name} · {t.t.present} days, {r1(t.otHours)} OT h
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="sub">All timesheets for {mLabel(state.month)} are approved.</div>
          )}
        </Panel>
        <Panel title={`Payroll ${mLabel(state.month)}`}>
          <div className="sub">
            Status: <b>{st}</b>. {st === "draft" ? "HR submits when timesheets, visits and claims are in." : st === "review" ? "The MD reviews the register and approves or sends it back." : st === "approved" ? "HR closes the month, prints or emails payslips and posts the journal to the ERP." : "Closed and locked."}
          </div>
          <div className="row2" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => go("pay")}>
              Open payroll
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
  const { open, go } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const F2 = [...state.forms].sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  const pend = F2.filter((f) => f.status === "Pending");
  const ym = state.today.slice(0, 7);
  const edit = canEdit(state.role);
  return (
    <>
      <Top title="Forms" />
      <div className="kpis">
        <Kpi label="Waiting for approval" value={pend.length} sub="across all forms" alert={!!pend.length} />
        <Kpi label="Approved this month" value={F2.filter((f) => f.status === "Approved" && String(f.decided || "").slice(0, 7) === ym).length} sub="forms" />
        <Kpi label="Leave approved this year" value={F2.filter((f) => f.ft === "leave" && f.status === "Approved" && String(f.from).slice(0, 4) === ym.slice(0, 4)).length} sub="requests" />
      </div>
      <Panel title="Reservia HR forms">
        <div className="sub" style={{ marginBottom: 10 }}>
          Fill a form on screen, send it for approval, then print it for the personnel file. Approved leave posts to Attendance. An approved visit request creates a Planned visit.
        </div>
        <div className="formgrid">
          {["leave", "ot", "visit", "report", "hire", "exit"].map((k) =>
            k === "report" ? (
              <div className="fcard" key={k}>
                <span className="mono">HR-F04</span>
                <b>Site visit report</b>
                <span className="sub">Due within 24 hours of return. Written inside the visit record.</span>
                <div className="row2">
                  <button className="btn primary sm" onClick={() => go("visit")}>
                    Open site visits
                  </button>
                  <button className="btn sm" onClick={() => openPdf("sheets/report?blank=1")}>
                    Blank copy
                  </button>
                </div>
              </div>
            ) : (
              <div className="fcard" key={k}>
                <span className="mono">{FT[k].c}</span>
                <b>{FT[k].t}</b>
                <span className="sub">{FT[k].d}</span>
                <div className="row2">
                  {edit && (
                    <button className="btn primary sm" data-testid={`new-form-${k}`} onClick={() => open({ type: "frm", ft: k })}>
                      {k === "hire" || k === "exit" ? "Open for an employee" : "New request"}
                    </button>
                  )}
                  <button className="btn sm" onClick={() => openPdf(`sheets/${k}?blank=1`)}>
                    Blank copy
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </Panel>
      <Panel title="Requests" small={F2.length}>
        {F2.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Form</th>
                  <th>Employee</th>
                  <th>Details</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {F2.map((f) => (
                  <tr key={f._id} onClick={() => open({ type: "frm", id: f._id, ft: f.ft })}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {String(f.created || "").slice(0, 10)}
                    </td>
                    <td>
                      {FT[f.ft].t} {f.example && <Pill c="info">Example</Pill>}
                    </td>
                    <td>{byId[f.employee]?.name || "(removed)"}</td>
                    <td className="sub">{frmSummary(f)}</td>
                    <td>{statusPill(f.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sub">No requests yet.</div>
        )}
      </Panel>
    </>
  );
}

export function FormModal({ id, ft: ft0, empId }: { id?: string; ft?: string; empId?: string }) {
  const { state, call, toast, openPdf } = useHr();
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
  const firstEmp = empId || state?.employees.find((e) => e.status !== "Left")?._id || "";
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
  const edit = canEdit(state.role);
  const canDecide = edit || state.role === "manager";
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  const title = `${FT[ft].c} ${FT[ft].t}`;
  if (ft === "hire" || ft === "exit") {
    const e = byId[f.v.empId];
    return (
      <Modal title={title} onClose={close}>
        <div className="fg">
          <Sel label="Employee" k="empId" f={f} opts={emps} />
          {ft === "exit" && (
            <>
              <Inp label="Last working day" k="last" f={f} type="date" />
              <Sel label="Reason" k="reason" f={f} opts={["Resignation", "Termination", "End of contract"]} />
            </>
          )}
        </div>
        {ft === "hire" && e && (
          <>
            <div className="tablewrap">
              <table className="mini">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {state.lists.DOCS.map((d) => {
                    const s = state.docStatus[e._id]?.docs[d.k] || "miss";
                    return (
                      <tr key={d.k}>
                        <td>{d.n}</td>
                        <td>
                          <Pill c={SL[s][1]}>{SL[s][0]}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sub">Nobody starts until the "before day 1" items are on file. Keep the signed four-copy contract; one copy goes to the Ministry of Manpower.</div>
          </>
        )}
        {ft === "exit" && (
          <>
            <div className="tablewrap">
              <table className="mini">
                <thead>
                  <tr>
                    <th></th>
                    <th>Step</th>
                    <th>Owner</th>
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
            <div className="sub">Tick each step as it is signed off. When all twelve are done, set the employee status to Left in People.</div>
          </>
        )}
        <div className="row2">
          {ft === "exit" && edit && (
            <button className="btn primary" onClick={() => call("PUT", `employees/${f.v.empId}/exit`, { last: f.v.last, reason: f.v.reason, steps }).then(() => toast("Checklist saved"))}>
              Save checklist
            </button>
          )}
          <button className="btn" onClick={() => openPdf(`sheets/${ft}?empId=${f.v.empId}`)}>
            Print
          </button>
        </div>
      </Modal>
    );
  }
  const hints: string[] = [];
  if (ft === "leave") {
    const lv = state.leave.find((l) => l.empId === f.v.empId);
    if (lv) hints.push(`Used so far this year: ${lv.used} of ${lv.ent}.`);
    if (f.v.ltype === "Casual leave") hints.push("Casual leave: 2 days at most at a time, 7 a year, taken from the annual balance.");
    if (f.v.ltype === "Sick leave") hints.push("Attach the medical certificate to the personnel file.");
    if (f.v.ltype === "Unpaid leave") hints.push("Unpaid leave needs the written approval of the MD.");
  }
  if (ft === "ot") {
    if (f.v.odate && f.v.odate < today) hints.push("Policy: approval must come before the work starts. This date has passed, so record it as an exception with a reason.");
    const c = state.cfg;
    const k = f.v.kind;
    hints.push(`Rate for this work: ${k === state.lists.OT_KINDS[0] ? `wage x ${c.otDay} by day, x ${c.otNight} at night` : k === state.lists.OT_KINDS[1] ? `daily wage x ${c.otFri} plus a substitute day` : k === state.lists.OT_KINDS[2] ? `daily wage x ${c.otSat}, no substitute day` : `daily wage x ${c.otHol} in total`}.`);
  }
  if (ft === "visit") {
    const gc = state.cfg.cities.find((c) => c.n === f.v.city)?.z === "Greater Cairo";
    hints.push(gc ? `Greater Cairo day: daily wage x ${state.cfg.siteGC} in total, no meal allowance.` : `Outside Greater Cairo: daily wage x ${state.cfg.siteOut} in total plus EGP ${state.cfg.perDiem} meal per diem each day (none if all meals are provided).`);
    hints.push("An HSE induction and issued PPE are needed before the first visit.");
  }
  const save = async () => {
    if (!id || f0?.status === "Pending") {
      if (edit) {
        const r = await call(id ? "PATCH" : "POST", id ? `forms/${id}` : "forms", { ...f.v, ft });
        (r.data.warnings || []).forEach((w: string) => toast(w));
        if (!id) {
          toast("Sent for approval");
          close();
          return;
        }
      }
    }
    if (id && canDecide && f.v.status !== f0?.status) {
      const r = await call("POST", `forms/${id}/decide`, { status: f.v.status, by: f.v.by, dnote: f.v.dnote });
      const fx = r.data.effects || {};
      toast(fx.attendanceDays ? `Approved. ${fx.attendanceDays} days posted to Attendance` : fx.visit ? "Approved. Visit added as Planned" : "Saved");
    } else toast("Saved");
    close();
  };
  const ro = !!id && f0?.status !== "Pending";
  return (
    <Modal title={title} onClose={close}>
      <div className="fg">
        <Sel label="Employee" k="empId" f={f} opts={emps} disabled={!edit || ro} />
        {ft === "leave" && (
          <>
            <Sel label="Type of leave" k="ltype" f={f} opts={state.lists.LEAVE_TYPES} disabled={!edit || ro} />
            <Inp label="First day of leave" k="from" f={f} type="date" disabled={!edit || ro} />
            <Inp label="Last day of leave" k="to" f={f} type="date" disabled={!edit || ro} />
            <Inp label="Who covers your work" k="cover" f={f} disabled={!edit || ro} />
            <Inp label="Phone during leave" k="phone" f={f} disabled={!edit || ro} />
            <Txt label="Reason or note" k="reason" f={f} />
          </>
        )}
        {ft === "ot" && (
          <>
            <Inp label="Date of the work" k="odate" f={f} type="date" disabled={!edit || ro} />
            <Sel label="Type of work" k="kind" f={f} opts={state.lists.OT_KINDS} disabled={!edit || ro} />
            <Inp label="Planned start" k="from" f={f} type="time" disabled={!edit || ro} />
            <Inp label="Planned end" k="to" f={f} type="time" disabled={!edit || ro} />
            <Inp label="Hours beyond the normal day" k="hours" f={f} type="number" step="0.5" disabled={!edit || ro} />
            <Inp label="Project or site" k="site" f={f} disabled={!edit || ro} />
            <Txt label="Why the work cannot wait" k="reason" f={f} />
          </>
        )}
        {ft === "visit" && (
          <>
            <Inp label="First day" k="from" f={f} type="date" disabled={!edit || ro} />
            <Sel label="City" k="city" f={f} opts={state.cfg.cities.map((c) => [c.n, `${c.n} (${c.z})`] as [string, string])} disabled={!edit || ro} />
            <Inp label="Client or site" k="site" f={f} disabled={!edit || ro} />
            <Sel label="Purpose" k="purpose" f={f} opts={state.lists.PURPOSES} disabled={!edit || ro} />
            <Inp label="Days on site" k="days" f={f} type="number" min={1} disabled={!edit || ro} />
            <Inp label="Nights away" k="nights" f={f} type="number" min={0} disabled={!edit || ro} />
            <Inp label="Expected return" k="back" f={f} type="date" disabled={!edit || ro} />
            <Sel label="Transport" k="transport" f={f} opts={["Company arranges", "Employee pays, reimbursed on receipts"]} disabled={!edit || ro} />
            <Sel label="Accommodation" k="stay" f={f} opts={["Not needed", "Company books", "Client provides"]} disabled={!edit || ro} />
            <Sel label="Meals" k="meals" f={f} opts={["Not provided", "Provided all day by client or hotel"]} disabled={!edit || ro} />
            <Inp label="CRM lead or project reference" k="ref" f={f} disabled={!edit || ro} />
            <Txt label="Objective of the visit" k="reason" f={f} />
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
          <h4>Decision</h4>
          <div className="fg">
            <Sel label="Status" k="status" f={f} opts={["Pending", "Approved", "Rejected"]} />
            <Inp label="Decided by" k="by" f={f} placeholder="Your name is used when blank" />
            <Inp label="Manager note" k="dnote" f={f} full />
          </div>
        </div>
      )}
      <div className="row2">
        {(edit || (id && canDecide)) && (
          <button className="btn primary" data-testid="hr-save-form" onClick={() => save().catch(() => undefined)}>
            {id ? "Save" : "Send for approval"}
          </button>
        )}
        {id && (
          <button className="btn" onClick={() => openPdf(`sheets/${ft}?id=${id}`)}>
            Print
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton onConfirm={() => call("DELETE", `forms/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Training ===================== */
export function Training() {
  const { state, download } = useHr();
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
      <Top title="Training">
        {canEdit(state.role) && (
          <>
            <button className="btn" onClick={() => download(`exports/training.csv?month=${state.month}`)}>
              Export CSV
            </button>
            <button className="btn primary" onClick={() => open({ type: "trn" })}>
              Log training
            </button>
          </>
        )}
      </Top>
      {!E.length ? (
        <Empty title="No employees yet" text="Add people first, then record courses and certificates." />
      ) : (
        <>
          <div className="legend">Required courses are set in Settings. Select a cell to log a course.</div>
          <div className="tablewrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th>Employee</th>
                  {req.map((r) => (
                    <th className="vh" title={`${r.n} (valid ${r.m} months)`} key={r.n}>
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
                          <button className={`dc ${s.s}`} title={`${r.n}: ${SL[s.s][0]}${s.exp ? ` until ${s.exp}` : ""}`} aria-label={`${e.name}, ${r.n}, ${SL[s.s][0]}`} onClick={() => open({ type: "trn", empId: e._id, course: r.n })}>
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
          <Panel title="Training log" small={`${L.length} records`}>
            {L.length ? (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Employee</th>
                      <th>Course</th>
                      <th>Provider</th>
                      <th className="num">Hours</th>
                      <th>Valid until</th>
                      <th>Certificate</th>
                      <th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {L.map((t) => {
                      const rq = req.find((r) => r.n === t.course);
                      return (
                        <tr key={t._id} onClick={() => open({ type: "trn", id: t._id })}>
                          <td className="mono">{t.date}</td>
                          <td>{byId[t.employee]?.name || "(removed)"}</td>
                          <td>
                            {t.course} {t.example && <Pill c="info">Example</Pill>}
                          </td>
                          <td>{t.provider}</td>
                          <td className="num">{t.hours || ""}</td>
                          <td className="mono">{t.exp || (rq && rq.m ? addM(t.date, rq.m) : "")}</td>
                          <td>{t.cert ? <Pill c="good">On file</Pill> : <Pill c="warn">Not on file</Pill>}</td>
                          <td className="num">{t.cost ? fmt(t.cost) : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sub">No training logged yet.</div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}

export function TrainingModal({ id, empId, course }: { id?: string; empId?: string; course?: string }) {
  const { state, call, toast } = useHr();
  const { close } = useModal();
  const t = id ? state?.trainings.find((x) => x._id === id) : null;
  const f = useFormVals(t ? { ...t, empId: t.employee } : { empId: empId || "", course: course || "", date: state?.today, cert: true, kind: "Training course" });
  if (!state || (id && !t)) return null;
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, e.name] as [string, string]);
  return (
    <Modal title={id ? "Training or certificate" : "Log training or certificate"} onClose={close}>
      <div className="fg">
        <Sel label="Employee" k="empId" f={f} opts={[["", "Choose"], ...emps]} />
        <Sel label="Type" k="kind" f={f} opts={state.lists.CERT_KINDS} />
        <label>
          Course
          <input list="hr-courses" value={f.v.course || ""} onChange={(e) => f.set("course", e.target.value)} />
          <datalist id="hr-courses">
            {state.cfg.req.map((r) => (
              <option key={r.n} value={r.n} />
            ))}
          </datalist>
        </label>
        <Inp label="Provider" k="provider" f={f} />
        <Inp label="Date completed" k="date" f={f} type="date" />
        <Inp label="Hours" k="hours" f={f} type="number" />
        <Inp label="Valid until (blank = course default)" k="exp" f={f} type="date" />
        <Inp label="Cost (EGP)" k="cost" f={f} type="number" />
        <Chk label="Certificate on file" k="cert" f={f} />
      </div>
      <div className="row2">
        <button className="btn primary" onClick={() => call(id ? "PATCH" : "POST", id ? `records/training/${id}` : "records/training", f.v).then(() => (toast("Saved"), close()))}>
          Save
        </button>
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton onConfirm={() => call("DELETE", `records/training/${id}`).then(close)} />
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
  const { open } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const P = [...state.performance].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const probs = state.employees.filter((e) => e.status !== "Left" && probationSoon(e, state.today));
  return (
    <>
      <Top title="Performance">
        <button className="btn primary" onClick={() => open({ type: "perf" })}>
          New review
        </button>
      </Top>
      <div className="kpis">
        <Kpi label="Reviews on file" value={P.length} />
        <Kpi label="Average rating" value={P.length ? (sum(P, (p) => +(p.rating || 0) || perfScore(p.goals || [])) / P.length).toFixed(1) : "n/a"} sub="out of 5" />
        <Kpi label="Probation ending in 30 days" value={probs.length} sub={probs.map((e) => e.name.split(" ")[0]).join(", ") || "nobody"} alert={!!probs.length} />
      </div>
      <Panel title="How it works">
        <div className="sub">Each review has weighted goals scored 1 to 5. The weighted score sets the rating. Enter the monthly target achievement on the payslip (it releases the commission); use reviews here for the probation decision, the half-year and the annual cycle.</div>
      </Panel>
      {!P.length ? (
        <Empty title="No reviews yet" text="Start with the probation reviews, due before the three months end." />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>Cycle</th>
                <th>Goals</th>
                <th className="num">Score</th>
                <th>Rating</th>
                <th>Reviewer</th>
              </tr>
            </thead>
            <tbody>
              {P.map((p) => {
                const sc = perfScore(p.goals || []);
                return (
                  <tr key={p._id} onClick={() => open({ type: "perf", id: p._id })}>
                    <td className="mono">{p.date}</td>
                    <td>{byId[p.employee]?.name || "(removed)"}</td>
                    <td>
                      {p.cycle} {p.example && <Pill c="info">Example</Pill>}
                    </td>
                    <td className="sub">{(p.goals || []).map((g: { t: string }) => g.t).join("; ")}</td>
                    <td className="num">{sc}</td>
                    <td>
                      <Pill c={sc >= 3.5 ? "good" : sc >= 2.5 ? "info" : "warn"}>{sc >= 4.5 ? "Outstanding" : sc >= 3.5 ? "Strong" : sc >= 2.5 ? "Meets" : sc >= 1.5 ? "Below" : "Unrated"}</Pill>
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
  const { close } = useModal();
  const p = id ? state?.performance.find((x) => x._id === id) : null;
  const today = state?.today || "";
  const f = useFormVals(p ? { ...p, empId: p.employee } : { empId: "", cycle: `${today.slice(0, 4)} ${+today.slice(5, 7) <= 6 ? "H1" : "H2"}`, date: today, by: "" });
  const [goals, setGoals] = useState<{ t: string; w: number; s: number }[]>(p?.goals?.length ? p.goals : [{ t: "", w: 40, s: 3 }, { t: "", w: 30, s: 3 }, { t: "", w: 30, s: 3 }]);
  if (!state || (id && !p)) return null;
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  const setG = (i: number, k: "t" | "w" | "s", v: string) => setGoals((g) => g.map((x, j) => (j === i ? { ...x, [k]: k === "t" ? v : +v } : x)));
  return (
    <Modal title={id ? "Performance review" : "New review"} onClose={close}>
      <div className="fg">
        <Sel label="Employee" k="empId" f={f} opts={[["", "Choose"], ...emps]} />
        <Inp label="Cycle" k="cycle" f={f} />
        <Inp label="Review date" k="date" f={f} type="date" />
        <Inp label="Reviewer" k="by" f={f} />
      </div>
      <div className="tablewrap">
        <table className="mini">
          <thead>
            <tr>
              <th>Goal</th>
              <th>Weight %</th>
              <th>Score 1 to 5</th>
            </tr>
          </thead>
          <tbody>
            {goals.map((g, i) => (
              <tr key={i}>
                <td>
                  <input value={g.t} placeholder="Goal" onChange={(e) => setG(i, "t", e.target.value)} />
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
          Add goal
        </button>
        <span className="sub">Weights should total 100. Score now {perfScore(goals.filter((g) => g.t))}.</span>
      </div>
      <Txt label="Summary and development plan" k="note" f={f} />
      <div className="row2">
        <button className="btn primary" onClick={() => call(id ? "PATCH" : "POST", id ? `records/performance/${id}` : "records/performance", { ...f.v, goals }).then(() => (toast("Saved"), close()))}>
          Save
        </button>
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton onConfirm={() => call("DELETE", `records/performance/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Policy ===================== */
const POLICY_OPEN: [string, string, string][] = [
  ["Decision", "Overtime on total wage (policy choice) or basic wage only", "Payroll uses the setting in Settings"],
  ["Decision", "21 days annual leave from year one, against 15 in the law", "Company term, cannot later be cut"],
  ["Decision", "Late arrival: 15 minutes grace, 3 times a month, then deductions", "Payroll applies it when the deduction setting is on"],
  ["Law check", "Pay on a weekly rest day: double pay plus a substitute day, or either one", "Sources differ"],
  ["Law check", "Overtime basis: total wage or basic wage", "Sources differ"],
  ["Law check", "Night hours 22:00 to 06:00", "One source"],
  ["Law check", "Ramadan hours: 6 or 7", "Policy uses 6"],
  ["Law check", "Monthly incentive counts as wage (Art. 1), so insurance and overtime base default to the total wage", "Lawyer to confirm; change in Settings"],
  ["Decision", "Friday is the weekly rest day in the contract; Saturday work is overtime at the HR Policy rate", "Contract v2, 10 Nov 2026"],
  ["Law check", "How rest days and holidays are counted inside annual leave", "Not confirmed"],
  ["Law check", "Whether a resignation needs Manpower approval first, and the end-of-service payment", "Ask a lawyer"],
  ["Accountant", "Tax and insurance treatment of the site allowance and the per diem", "Settings: site allowances are not taxed by default"],
  ["Check", "Holiday x3 and Friday x2 are treated as additional pay on top of the monthly salary", "Confirm that the normal holiday pay is not inside the x3"],
];
export function Policy() {
  const { state } = useHr();
  if (!state) return null;
  const c = state.cfg;
  const d = 20000 / 30;
  const hr = d / 8;
  const f2 = (x: number) => fmt(Math.round(x * 100) / 100);
  const rates: [string, string, string][] = [
    ["Normal day", "8 hours at daily wage", `${f2(d)} a day, ${f2(hr)} an hour`],
    ["Weekday overtime, 06:00 to 22:00", `Hourly wage x ${c.otDay}`, `${f2(hr * c.otDay)} an hour`],
    ["Weekday overtime, 22:00 to 06:00", `Hourly wage x ${c.otNight}`, `${f2(hr * c.otNight)} an hour`],
    ["Friday worked (statutory rest day)", `Daily wage x ${c.otFri}, plus a substitute day`, `${f2(d * c.otFri)} plus a day off`],
    ["Saturday worked (company rest day)", `Daily wage x ${c.otSat}, no substitute day`, f2(d * c.otSat)],
    ["Official holiday worked", `Daily wage x ${c.otHol} in total`, f2(d * c.otHol)],
    ["Site visit in Greater Cairo", `Daily wage x ${c.siteGC} in total, no meal allowance`, `${f2(d * c.siteGC)}, of which ${f2(d * (c.siteGC - 1))} is the allowance`],
    ["Domestic travel outside Greater Cairo", `Daily wage x ${c.siteOut} in total, plus EGP ${c.perDiem} per diem`, `${f2(d * c.siteOut)} plus ${c.perDiem}, of which ${f2(d * (c.siteOut - 1))} is the allowance`],
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
      <Top title="HR policy" />
      <div className="banner info">Draft of 19 October 2026: Attendance, Overtime, Travel and Leave, written to sit inside Labour Law 14 of 2025. Legal floors come from law-firm and news summaries, not the official text, which prevails.</div>
      <Panel title="Pay rules, with an example at EGP 20,000 a month">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Situation</th>
                <th>Rule</th>
                <th>Example</th>
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
        <div className="sub">Rates read from Settings, so a change there updates this table and payroll together. Daily wage = monthly wage / 30. Hourly wage = daily wage / 8. Where two rates cover the same hours, the higher is paid. Meal per diem is added on top.</div>
      </Panel>
      <div className="grid2">
        <Panel title="Time and attendance">
          {list([
            "Week: Sunday to Thursday, 09:00 to 18:00, one unpaid hour at 13:00. 8 hours a day, 40 a week.",
            "Friday is the statutory rest day. Saturday is a company rest day.",
            `Late: ${c.grace} minutes grace, ${c.graceTimes} times a month. After that late minutes are deducted.`,
            "Absence: tell the line manager before 09:30 on day one.",
            "Ramadan: 09:00 to 16:00, 6 working hours.",
            "Overtime needs written approval before the work starts (form HR-F02). Time at work, overtime included, stays under 12 hours a day.",
            "Overtime is paid in the same month by bank transfer. Time off instead of pay only on written request.",
          ])}
        </Panel>
        <Panel title="Leave">
          {list([
            `Annual: ${c.annualDays} working days a year from year one (law: 15 in year one, 21 from year two).`,
            "Casual: up to 7 days a year, 2 at most at a time, from the annual balance.",
            "Request annual leave 14 working days ahead. The manager answers within 5 working days. One block of at least 6 days a year.",
            "Carry over up to 42 days. Unused days are paid at exit at the daily wage.",
            "Maternity 4 months paid, up to 3 times. Paternity paid on the day of birth.",
            "Sick leave on a medical certificate, paid as the Social Insurance Law sets.",
            "Unpaid leave needs the MD in writing.",
          ])}
        </Panel>
      </div>
      <Panel title="Site visits and travel">
        {list([
          "A visit needs a manager approval and a site visit form (HR-F03) with date, site, purpose and expected return.",
          "The company books and pays accommodation and transport. Where the employee pays, it is reimbursed at cost against receipts.",
          "HSE induction and issued PPE before the first visit. Visit report within 24 hours of return (HR-F04).",
          "If a visit falls on a Friday, Saturday or holiday, the higher of the visit rate and the rest-day rate applies.",
          `Meal per diem: EGP ${c.perDiem} flat, outside Greater Cairo only. None if the client or hotel provides all meals. HR reviews it every quarter and resets it when prices move 10% or more.`,
        ])}
      </Panel>
      <Panel title="Open points" small={POLICY_OPEN.length}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Point</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {POLICY_OPEN.map((r) => (
                <tr key={r[1]}>
                  <td>
                    <Pill c={r[0] === "Decision" ? "info" : "warn"}>{r[0]}</Pill>
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
    const keys = ["stdHours", "breakH", "shiftStart", "grace", "graceTimes", "lateDeduct", "annualDays", "workWeek", "otDay", "otNight", "otFri", "otSat", "otHol", "nightFrom", "nightTo", "otBase", "siteGC", "siteOut", "perDiem", "insEmp", "insEr", "insMin", "insMax", "exemption", "brackets", "siteTaxable", "sickPaid", "insBaseMode", "reimbTaxable", "hrName", "mdName", "holidays", "cities", "req"];
    keys.forEach((k) => {
      if (JSON.stringify(f.v[k]) !== JSON.stringify(c[k])) values[k] = f.v[k];
    });
    if ((f.v.commRule === "pro") !== c.commPro) values.commPro = f.v.commRule === "pro";
    if (!Object.keys(values).length) return toast("Nothing changed");
    return call("POST", "settings", { effectiveMonth: eff, values, note }).then(() => toast(`Settings saved, effective from ${mLabel(eff)}`));
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
      <Top title="Settings" />
      <div className="banner info">
        Every change is dated: it applies from the month you choose, and months before it keep the rates of their time.
        {state.cfgVersion ? ` Current version from ${mLabel(state.cfgVersion.effectiveMonth)}, saved by ${state.cfgVersion.byName}.` : " Using the defaults."}
      </div>
      <div className="setup">
        <Panel title="Working time">
          <div className="fg">
            {N("Standard hours per day", "stdHours")}
            {N("Unpaid break (hours, taken on days over 5 h)", "breakH")}
            <Inp label="Shift start" k="shiftStart" f={f} type="time" disabled={!edit} />
            {N("Late grace (minutes)", "grace")}
            {N("Free grace arrivals per month", "graceTimes")}
            {N("Annual leave (working days a year)", "annualDays")}
            <div className="full">
              <span className="lbl">Working days</span>
              <div className="acts">
                {DN.map((d, i) => (
                  <button key={d} aria-pressed={ww.includes(i)} disabled={!edit} onClick={() => f.set("workWeek", ww.includes(i) ? ww.filter((x) => x !== i) : [...ww, i].sort())}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <Chk label="Deduct late minutes from pay" k="lateDeduct" f={f} full />
            <Chk label="Pay sick leave in full" k="sickPaid" f={f} full />
            <label className="full">
              Public holidays (one date per line, YYYY-MM-DD)
              <textarea rows={5} value={f.v.holidays || ""} disabled={!edit} onChange={(e) => f.set("holidays", e.target.value)} />
              <span className="hint">Fixed-date holidays are pre-filled. Add the moving Islamic holidays when the government announces them.</span>
            </label>
          </div>
        </Panel>
        <Panel title="Overtime and site pay">
          <div className="fg">
            {N("Day overtime multiplier", "otDay", "Policy section 3: wage x 1.35 (06:00 to 22:00)", "0.05")}
            {N("Night overtime multiplier", "otNight", "Policy: wage x 1.70 (22:00 to 06:00)", "0.05")}
            {N("Friday worked (statutory rest day)", "otFri", "Policy: daily wage x 2, plus a substitute day. Official text to confirm", "0.05")}
            {N("Saturday worked (company rest day)", "otSat", "Policy: daily wage x 1.5, company term", "0.05")}
            {N("Official holiday worked", "otHol", "Policy: daily wage x 3 in total. Check if the normal holiday pay is already inside it", "0.05")}
            {N("Night starts (hour)", "nightFrom")}
            {N("Night ends (hour)", "nightTo")}
            <Sel label="Overtime hourly rate is based on" k="otBase" f={f} opts={[["basic", "Basic pay"], ["gross", "Total wage (basic plus allowances)"]]} disabled={!edit} />
            {N("Site day in Greater Cairo (x daily wage, total)", "siteGC", "Policy section 4: 1.5, so the extra is 0.5 of a day", "0.05")}
            {N("Site day outside Greater Cairo (x daily wage, total)", "siteOut", "Policy: 2.0, so the extra is 1.0 of a day", "0.05")}
            {N("Meal per diem outside Greater Cairo (EGP a day)", "perDiem", "Policy section 5: EGP 250 flat", "1")}
          </div>
        </Panel>
        <Panel title="Social insurance and income tax">
          <div className="fg">
            {N("Employee share %", "insEmp", "Law 148 of 2019: 11%", "0.05")}
            {N("Employer share %", "insEr", "Law 148 of 2019: 18.75%", "0.05")}
            {N("Insurable wage floor (EGP a month)", "insMin", "Two sources give 2,700 for 2026; one older page gives 2,300", "1")}
            {N("Insurable wage ceiling (EGP a month)", "insMax", "Two sources give 16,700 for 2026; one older page gives 14,500", "1")}
            {N("Personal exemption (EGP a year)", "exemption", "Applied before the brackets", "1")}
            <Sel label="Insurable wage is based on" k="insBaseMode" f={f} full disabled={!edit} opts={[["all", "Total fixed wage (basic, transport, incentive, other): Law 14 of 2025 Art. 1 counts allowances and incentives as wage"], ["basicother", "Basic plus other fixed allowances"], ["basic", "Basic gross salary only"]]} />
            <Sel label="Performance commission" k="commRule" f={f} disabled={!edit} opts={[["full", "Paid in full at 100% of target, nothing below (offer wording)"], ["pro", "Paid pro rata to the percentage achieved, capped at 150%"]]} />
            <Chk label="Treat site allowances as taxable pay" k="siteTaxable" f={f} full />
            <Chk label="Treat receipted reimbursements as taxable pay" k="reimbTaxable" f={f} full />
            <div className="full">
              <span className="lbl">Annual tax brackets (Law 7 of 2024, as reported by payroll guides)</span>
              <table className="mini">
                <thead>
                  <tr>
                    <th>Up to (EGP a year)</th>
                    <th>Rate %</th>
                  </tr>
                </thead>
                <tbody>
                  {brackets.map((b, i) => (
                    <tr key={i}>
                      <td>{b[0] == null ? <span className="sub">Above the last limit</span> : <input type="number" value={b[0]} disabled={!edit} onChange={(e) => f.set("brackets", brackets.map((x, j) => (j === i ? [+e.target.value, x[1]] : x)))} />}</td>
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
        <Panel title="Cities and zones">
          <div className="sub" style={{ marginBottom: 8 }}>
            A city with the zone name <b>Greater Cairo</b> (Cairo, Giza, Qalyubia) pays the Greater Cairo site rate with no meal per diem. Any other zone pays the travel rate plus the per diem.
          </div>
          <div className="tablewrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>City</th>
                  <th>Zone</th>
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
                          Remove
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
              <button className="btn" onClick={() => f.set("cities", [...cities, { n: "New city", z: "" }])}>
                Add city
              </button>
            </div>
          )}
        </Panel>
        <Panel title="Required training">
          <div className="tablewrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>Course</th>
                  <th className="num">Valid (months)</th>
                  <th>Applies to</th>
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
                        <option value="all">Everyone</option>
                        {state.lists.DEPTS.map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {edit && (
                        <button className="btn sm danger" onClick={() => f.set("req", req.filter((_, j) => j !== i))}>
                          Remove
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
              <button className="btn" onClick={() => f.set("req", [...req, { n: "New course", m: 12, d: "all" }])}>
                Add course
              </button>
            </div>
          )}
        </Panel>
        <Panel title="Signatories and approvals">
          <div className="fg">
            <Inp label="HR officer (prepares payroll)" k="hrName" f={f} disabled={!edit} />
            <Inp label="Managing Director (approves)" k="mdName" f={f} disabled={!edit} />
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            Names print on payslips and the register. Each approval step is also stamped with the portal name of the person who took it.
          </div>
        </Panel>
        {edit && (
          <Panel title="Save">
            <div className="fg">
              <label>
                Applies from (month)
                <input type="month" value={eff} onChange={(e) => setEff(e.target.value)} data-testid="set-eff" />
              </label>
              <label>
                Note
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the change" />
              </label>
            </div>
            <div className="row2" style={{ marginTop: 8 }}>
              <button className="btn primary" data-testid="set-save" onClick={() => save()?.catch(() => undefined)}>
                Save settings
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
  if (!state) return null;
  const hasExample = state.employees.some((e) => e.example);
  return (
    <Panel title="Data">
      <p className="sub">Pay figures are encrypted on the server and shown only to the MD, HR and Finance. National ID numbers and bank account numbers are not stored here; keep scans in the company drive and record the folder path in Documents.</p>
      <div className="row2">
        {!hasExample && (
          <button className="btn" data-testid="hr-seed-settings" onClick={() => call("POST", "example").then(() => toast("Example team loaded"))}>
            Load example team
          </button>
        )}
        {hasExample && <ArmedButton label="Remove example data" armed="Click again to remove" onConfirm={() => call("DELETE", "example").then((r) => toast(`Removed ${r.data.removed} example records`))} />}
      </div>
    </Panel>
  );
}
