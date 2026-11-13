import { useMemo, useState } from "react";
import { canEdit, Employee, fmt, grossOf, mLabel, r1, sum, useHr, diffDays } from "./hr-context";
import { ArmedButton, Chk, Drawer, Empty, Inp, Kpi, Modal, MonthBar, Panel, Pill, Sel, SL, SL_ICON, Top, Txt, useFormVals, useModal } from "./ui";

// Reservia HR Portal - Overview, People (and the employee drawer), Org chart, Documents, Hiring and
// Assets: the reference prototype's vHome, vPeople, empDrawer, vOrg, vDocs, vHire and vAssets.

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
  const { go } = useModal();
  const pend = usePendingCount();
  if (!state) return null;
  const E = state.employees.filter((e) => e.status !== "Left");
  if (!state.employees.length && !state.candidates.length)
    return (
      <>
        <Top title="Overview" />
        <Empty title="No team recorded yet" text="Add your first employee, or load a small example team to see how documents, attendance, overtime, site visits and the monthly payout fit together. Example rows carry an Example tag and can be removed in one click.">
          {canEdit(state.role) && (
            <div className="row2" style={{ justifyContent: "center" }}>
              <button className="btn primary" onClick={() => go("people", { new: "1" })}>
                Add first employee
              </button>
              <button className="btn" data-testid="hr-seed" onClick={() => call("POST", "example").then(() => toast("Example team loaded"))}>
                Load example team
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
        items.push(["bad", "Document expired", `${e.name}: ${doc.n}`, "docs"]);
      } else if (s === "soon") {
        soon++;
        items.push(["warn", "Document expires soon", `${e.name}: ${doc.n}`, "docs"]);
      }
    });
    const mm = Object.values(d).filter((s) => s === "miss").length;
    if (mm) {
      miss += mm;
      items.push(["warn", `${mm} document${mm > 1 ? "s" : ""} missing`, e.name, "docs"]);
    }
    state.cfg.req.forEach((rq, i) => {
      const s = state.trnStatus[e._id]?.[i]?.s;
      if (!s || s === "na") return;
      tneed++;
      if (s === "ok" || s === "soon") tok++;
      if (s === "exp") items.push(["bad", "Training expired", `${e.name}: ${rq.n}`, "train"]);
      else if (s === "miss") items.push(["warn", "Training missing", `${e.name}: ${rq.n}`, "train"]);
      else if (s === "soon") items.push(["warn", "Training due soon", `${e.name}: ${rq.n}`, "train"]);
    });
  });
  const unrec = sum(Object.values(state.time), (t) => t.t.unrec);
  if (unrec) items.push(["warn", `${unrec} working day${unrec > 1 ? "s" : ""} not recorded`, mLabel(state.month), "att"]);
  state.candidates.filter((c) => c.stage === "Documents" || c.stage === "Offer").forEach((c) => items.push(["info", `Hiring: ${c.stage}`, `${c.name} (${c.role || ""})`, "hire"]));
  const order: Record<string, number> = { bad: 0, warn: 1, info: 2 };
  items.sort((a, b) => order[a[0]] - order[b[0]]);
  const rows = state.payroll.rows;
  const byDept: Record<string, number> = {};
  rows.forEach((r) => (byDept[r.dept || "Other"] = (byDept[r.dept || "Other"] || 0) + r.net));
  const mx = Math.max(1, ...Object.values(byDept));
  const otHours = sum(Object.values(state.time), (t) => t.otHours);
  return (
    <>
      <Top title="Overview">
        <MonthBar />
      </Top>
      <div className="kpis">
        <Kpi label="Headcount" value={E.length} sub={`${E.filter((e) => e.status === "Probation").length} on probation`} />
        {canEdit(state.role) && <Kpi label="Personnel files complete" value={`${Math.round(dsc * 100)}%`} sub={`${miss} documents missing`} />}
        {canEdit(state.role) && <Kpi label="Expired or due in 60 days" value={exp + soon} sub={`${exp} expired`} />}
        {canEdit(state.role) && <Kpi label="Training compliance" value={tneed ? `${Math.round((tok / tneed) * 100)}%` : "n/a"} sub={`against ${state.cfg.req.length} required courses`} />}
        <Kpi label="Overtime hours" value={r1(otHours)} sub={mLabel(state.month)} />
        {state.canSeePay && <Kpi label="Net payout" value={fmt(sum(rows, (r) => r.net))} sub={`EGP, ${state.payroll.status}`} />}
        <Kpi label="Approvals waiting" value={pend} sub="forms, claims, payroll" alert={!!pend} />
      </div>
      <div className="grid2">
        <Panel title="Needs attention" small={items.length}>
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
            <div className="sub">Nothing is overdue. Documents, training and attendance are in order.</div>
          )}
        </Panel>
        {state.canSeePay && (
          <Panel title="Net payout by department" small={mLabel(state.month)}>
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
      <Top title="People">
        {canEdit(state.role) && (
          <button className="btn primary" data-testid="hr-new-emp" onClick={() => open({ type: "emp" })}>
            Add employee
          </button>
        )}
      </Top>
      <div className="filters">
        <input placeholder="Search name, role or code" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {state.lists.DEPTS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="Active">Current staff</option>
          <option value="">Everyone</option>
          <option value="Left">Left</option>
        </select>
      </div>
      {!E.length ? (
        <Empty title="No employees match" text="Change the filters or add a new employee." />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Department</th>
                <th>Base city</th>
                <th>Status</th>
                <th>Joined</th>
                {state.canSeePay && <th className="num">Monthly pay</th>}
                {canEdit(state.role) && <th>Files</th>}
              </tr>
            </thead>
            <tbody>
              {E.map((e) => {
                const sc = Math.round((state.docStatus[e._id]?.score ?? 1) * 100);
                return (
                  <tr key={e._id} onClick={() => open({ type: "emp", id: e._id })} data-testid={`emp-row-${e.code}`}>
                    <td className="mono">{e.code}</td>
                    <td>
                      <b>{e.name}</b> {e.example && <Pill c="info">Example</Pill>}
                      <div className="sub">{e.role}</div>
                    </td>
                    <td>{e.dept}</td>
                    <td>{e.city}</td>
                    <td>
                      <Pill c={e.status === "Active" ? "good" : e.status === "Left" ? "" : "warn"}>{e.status}</Pill>
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
    ["code", "name", "role", "dept", "status", "type", "hire", "end", "city", "mgr", "phone", "email", "emg", "emgp", "file", "nat", "sin", "edu", "cno", "offerDate", "cstart", "cend", "probEnd", "paym", "insured"].forEach((k) => (body[k] = f.v[k] ?? ""));
    body.insured = !!f.v.insured;
    if (pay) ["basic", "transport", "incentive", "commission", "other", "insBase"].forEach((k) => (body[k] = +f.v[k] || 0));
    await (id ? call("PATCH", `employees/${id}`, body) : call("POST", "employees", body));
    toast("Saved");
    close();
  };
  const t = id ? state.time[id] : undefined;
  const row = id ? state.payroll.rows.find((r) => r.id === id) : undefined;
  const vs = id ? state.visits.filter((v) => v.employee === id && v.status === "Done" && v.date.slice(0, 7) === state.month) : [];
  const trn = id ? state.trainings.filter((x) => x.employee === id).sort((a, b) => String(b.date).localeCompare(String(a.date))) : [];
  const ast = id ? state.assets.filter((a) => a.employee === id && !a.returned) : [];
  const ro = !edit;
  return (
    <Drawer title={id ? e!.name : "New employee"} sub={id ? e!.role : undefined} onClose={close}>
      <div className="fg">
        <Inp label="Employee code" k="code" f={f} placeholder="Next free code" disabled={ro} />
        <Inp label="Full name" k="name" f={f} disabled={ro} />
        <Inp label="Job title" k="role" f={f} disabled={ro} />
        <Sel label="Department" k="dept" f={f} opts={state.lists.DEPTS} disabled={ro} />
        <Sel label="Status" k="status" f={f} opts={state.lists.EMP_STATUS} disabled={ro} />
        <Sel label="Contract type" k="type" f={f} opts={state.lists.EMP_TYPE} disabled={ro} />
        <Inp label="Joining date" k="hire" f={f} type="date" disabled={ro} />
        <Inp label="Leaving date" k="end" f={f} type="date" disabled={ro} />
        <Inp label="Base city" k="city" f={f} disabled={ro} />
        <Inp label="Reports to" k="mgr" f={f} disabled={ro} />
        <Inp label="Mobile" k="phone" f={f} disabled={ro} />
        <Inp label="Email" k="email" f={f} type="email" disabled={ro} />
        <Inp label="Emergency contact" k="emg" f={f} disabled={ro} />
        <Inp label="Emergency phone" k="emgp" f={f} disabled={ro} />
        <Inp label="Personnel file location" k="file" f={f} full placeholder="e.g. HR cabinet 1, folder EMP-01, and drive path" disabled={ro} />
      </div>
      <div className="sect">
        <h4>Contract</h4>
        <div className="fg">
          <Inp label="Contract No." k="cno" f={f} disabled={ro} />
          <Inp label="Offer date" k="offerDate" f={f} type="date" disabled={ro} />
          <Inp label="Contract start" k="cstart" f={f} type="date" disabled={ro} />
          <Inp label="Contract end (fixed term)" k="cend" f={f} type="date" disabled={ro} />
          <Inp label="Probation ends" k="probEnd" f={f} type="date" disabled={ro} />
          <Inp label="Nationality" k="nat" f={f} disabled={ro} />
          {state.role !== "manager" && <Inp label="Social insurance No." k="sin" f={f} disabled={ro} />}
          <Inp label="Highest qualification" k="edu" f={f} disabled={ro} />
        </div>
        <div className="sub" style={{ marginTop: 6 }}>
          National ID and bank account numbers are not stored here (policy). Keep them on the signed paper file.
        </div>
      </div>
      {pay && (
        <div className="sect">
          <h4>Monthly pay (EGP, from the signed offer)</h4>
          <div className="fg">
            <Inp label="Basic gross salary" k="basic" f={f} type="number" disabled={ro} />
            <Inp label="Transportation allowance" k="transport" f={f} type="number" disabled={ro} />
            <Inp label="Incentive monthly payout" k="incentive" f={f} type="number" disabled={ro} />
            <Inp label="Performance commission (at 100% target)" k="commission" f={f} type="number" disabled={ro} />
            <Inp label="Other fixed allowances" k="other" f={f} type="number" disabled={ro} />
            <Sel label="Payment method" k="paym" f={f} opts={state.lists.PAY_METHODS} disabled={ro} />
            <Chk label="Registered for social insurance" k="insured" f={f} />
            <Inp label="Insurable wage override" k="insBase" f={f} type="number" placeholder="Blank = rule in Settings" disabled={ro} />
            <div className="full sub">
              Total fixed: <b className="mono">{fmt(grossOf(f.v))}</b> a month, plus commission <span className="mono">{fmt(f.v.commission || 0)}</span> when the target is met.
            </div>
          </div>
        </div>
      )}
      {id && t && (
        <div className="sect">
          <h4>{mLabel(state.month)} at a glance</h4>
          <div className="rowline">
            <span>Timesheet</span>
            <b className="mono">
              {t.approval ? <Pill c="good">Approved</Pill> : <Pill c="warn">{t.t.unrec ? `${t.t.unrec} days not recorded` : "Open"}</Pill>} {t.t.present} days present
            </b>
          </div>
          <div className="rowline">
            <span>Overtime</span>
            <b className="mono">
              {r1(t.otHours)} h{row ? ` = ${fmt(row.otPay)}` : ""}
            </b>
          </div>
          <div className="rowline">
            <span>Field visits</span>
            <b className="mono">
              {vs.length}
              {row ? ` = ${fmt(row.site)} allowance` : ""}
            </b>
          </div>
          {row && (
            <>
              <div className="rowline">
                <span>Commission</span>
                <b className="mono">{row.tgt == null ? "target not entered" : `${row.tgt}% = ${fmt(row.comm)}`}</b>
              </div>
              <div className="rowline">
                <span>Net payout</span>
                <b className="mono">{fmt(row.net)}</b>
              </div>
            </>
          )}
          <div className="row2" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => go("ts", { emp: id })}>
              Open timesheet
            </button>
            {edit && (
              <>
                <button className="btn sm" onClick={() => open({ type: "vis", empId: id })}>
                  Log a visit
                </button>
                <button className="btn sm" onClick={() => open({ type: "exp", empId: id })}>
                  Add expense claim
                </button>
              </>
            )}
            {pay && (
              <button className="btn sm" onClick={() => open({ type: "pay", id })}>
                Payslip
              </button>
            )}
          </div>
        </div>
      )}
      {id && edit && (
        <div className="sect">
          <h4>Training and certifications</h4>
          <div className="acts">
            {state.cfg.req.map((rq, i) => {
              const s = state.trnStatus[id]?.[i]?.s || "miss";
              if (s === "na") return null;
              return (
                <button key={i} onClick={() => open({ type: "trn", empId: id, course: rq.n })} style={{ borderColor: `var(--${({ ok: "good", soon: "warn", exp: "bad", miss: "bad" } as Record<string, string>)[s] || "line"})` }}>
                  {rq.n}: {SL[s][0]}
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
                    {x.kind || "Training course"}
                    {x.provider ? `, ${x.provider}` : ""}
                  </span>
                </span>
                <span className="mono sub">
                  {x.date}
                  {x.exp ? ` to ${x.exp}` : ""}
                </span>
              </div>
            ))
          ) : (
            <div className="sub">No courses or certificates logged yet.</div>
          )}
        </div>
      )}
      {id && edit && (
        <div className="sect">
          <h4>Company assets held</h4>
          {ast.length ? (
            ast.map((a) => (
              <div className="rowline" key={a._id}>
                <span>
                  <button className="lnk" onClick={() => open({ type: "ast", id: a._id })}>
                    {a.type}
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
            <div className="sub">Nothing issued. Use the belongings sheet when handing over a laptop, phone or SIM.</div>
          )}
          <div className="row2" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => open({ type: "ast", empId: id })}>
              Issue an asset
            </button>
          </div>
        </div>
      )}
      <div className="row2">
        {edit && (
          <button className="btn primary" data-testid="hr-save-emp" onClick={save}>
            Save
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton
              onConfirm={() =>
                call("DELETE", `employees/${id}`)
                  .then(() => {
                    toast("Employee deleted");
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

/* ===================== Org chart ===================== */
export function Org() {
  const { state, download } = useHr();
  const { open } = useModal();
  if (!state) return null;
  const E = state.employees.filter((e) => e.status !== "Left");
  if (!E.length)
    return (
      <>
        <Top title="Org chart" />
        <Empty title="No employees yet" text='Add people with a "Reports to" name and the chart builds itself.' />
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
  const top = roots.filter((e) => String(e.mgr || "").trim().toLowerCase() === String(md).trim().toLowerCase() || !e.mgr);
  const other = roots.filter((e) => !top.includes(e));
  const byDept: Record<string, number> = {};
  E.forEach((e) => (byDept[e.dept || "Other"] = (byDept[e.dept || "Other"] || 0) + 1));
  return (
    <>
      <Top title="Org chart">
        {canEdit(state.role) && (
          <button className="btn" onClick={() => download(`exports/org.csv?month=${state.month}`)}>
            Export CSV
          </button>
        )}
      </Top>
      <div className="kpis">
        <Kpi label="Headcount" value={E.length} sub={`${Object.keys(byDept).length} departments`} />
        <Kpi label="Managers" value={Object.keys(kids).length} sub="with direct reports" />
        <Kpi label="Largest team" value={Math.max(0, ...Object.values(kids).map((k) => k.length))} sub="direct reports" />
      </div>
      <Panel title="Reporting lines">
        <ul className="tree">
          <li>
            <div className="node">
              <b>{md}</b>
              <small>Managing Director</small>
            </div>
            <ul>{top.map((e) => node(e, 1))}</ul>
          </li>
          {other.map((e) => node(e, 1))}
        </ul>
        {other.length > 0 && <div className="sub" style={{ marginTop: 8 }}>People whose "Reports to" does not match an employee name are shown at the top level. Fix the spelling in their record.</div>}
      </Panel>
      <Panel title="By department">
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
  const { open } = useModal();
  const [dq, setDq] = useState("");
  if (!state) return null;
  const E = state.employees.filter((e) => e.status !== "Left").sort(empSort);
  if (!E.length)
    return (
      <>
        <Top title="Documents" />
        <Empty title="No employees yet" text="Add people first, then track each document here." />
      </>
    );
  const idx: { e: Employee; d: (typeof state.lists.DOCS)[number]; r: { date?: string; exp?: string; loc?: string } }[] = [];
  E.forEach((e) => state.lists.DOCS.forEach((d) => e.docs?.[d.k]?.st === "ok" && idx.push({ e, d, r: e.docs[d.k] })));
  const shown = idx.filter((x) => !dq || `${x.e.name} ${x.d.n} ${x.r.loc || ""}`.toLowerCase().includes(dq.toLowerCase()));
  return (
    <>
      <Top title="Documents">
        <button className="btn" onClick={() => download(`exports/personnel.csv?month=${state.month}`)}>
          Export checklist
        </button>
      </Top>
      <div className="legend">
        {["ok", "soon", "exp", "miss", "na"].map((k) => (
          <span key={k}>
            <span className={`dc ${k} s`}>{SL_ICON[k]}</span> {SL[k][0]} &nbsp;{" "}
          </span>
        ))}
        <span className="sub">Select a cell to record the document, its expiry and where it is kept.</span>
      </div>
      <div className="tablewrap">
        <table className="matrix">
          <thead>
            <tr>
              <th>Employee</th>
              {state.lists.DOCS.map((d) => (
                <th className="vh" title={d.n} key={d.k}>
                  {d.s}
                </th>
              ))}
              <th className="num">Done</th>
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
                      <button className={`dc ${s}`} title={`${d.n}: ${SL[s][0]}`} aria-label={`${e.name}, ${d.n}, ${SL[s][0]}`} data-testid={`doc-${e.code}-${d.k}`} onClick={() => open({ type: "doc", id: e._id, k: d.k })}>
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
      <Panel title="Storage index" small={`${idx.length} documents on file`}>
        <div className="filters" style={{ marginBottom: 10 }}>
          <input placeholder="Find a document, person or location" value={dq} onChange={(e) => setDq(e.target.value)} />
        </div>
        {shown.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Document</th>
                  <th>Kept at</th>
                  <th>Received</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={`${x.e._id}-${x.d.k}`} onClick={() => open({ type: "doc", id: x.e._id, k: x.d.k })}>
                    <td>{x.e.name}</td>
                    <td>{x.d.n}</td>
                    <td>{x.r.loc || <span className="warnline">Add a location</span>}</td>
                    <td className="mono">{x.r.date}</td>
                    <td className="mono">{x.r.exp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sub">No documents recorded as received yet.</div>
        )}
      </Panel>
    </>
  );
}

export function DocModal({ id, k }: { id: string; k: string }) {
  const { state, call, toast } = useHr();
  const { close } = useModal();
  const e = useEmp()[id];
  const d = state?.lists.DOCS.find((x) => x.k === k);
  const r = e?.docs?.[k] || { st: "pending" };
  const f = useFormVals({ st: r.st || "pending", date: r.date || state?.today, exp: r.exp || "", loc: r.loc || "" });
  if (!state || !e || !d) return null;
  return (
    <Modal title={`${e.name}: ${d.n}`} onClose={close}>
      <div className="fg">
        <Sel label="Status" k="st" f={f} opts={[["pending", "Not received"], ["ok", "Received and filed"], ["na", "Not applicable"]]} />
        <Inp label="Date received" k="date" f={f} type="date" />
        {d.exp && <Inp label="Expiry date" k="exp" f={f} type="date" />}
        <Inp label="Where it is kept" k="loc" f={f} full placeholder="e.g. HR cabinet 1, folder EMP-01 / Drive: HR/Personnel/EMP-01" />
      </div>
      <div className="row2">
        {canEdit(state.role) && (
          <button className="btn primary" data-testid="hr-save-doc" onClick={() => call("PUT", `employees/${id}/documents/${k}`, f.v).then(() => (toast("Saved"), close()))}>
            Save
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
  const { open } = useModal();
  if (!state) return null;
  const cs = state.candidates;
  return (
    <>
      <Top title="Hiring">
        <button className="btn primary" onClick={() => open({ type: "cand" })}>
          Add candidate
        </button>
      </Top>
      {!cs.length ? (
        <Empty title="No candidates yet" text="Track each applicant from first contact to signed documents, then convert them into an employee record in one step." />
      ) : (
        <>
          <div className="board">
            {state.lists.STAGES.filter((s) => s !== "Rejected").map((s) => {
              const L = cs.filter((c) => c.stage === s);
              return (
                <div className="col" key={s}>
                  <h3>
                    <i style={{ ["--c" as string]: `var(--${STAGE_COLOR[s]})` }} />
                    {s}
                    <span>{L.length}</span>
                  </h3>
                  {L.map((c) => (
                    <div className="card" key={c._id} tabIndex={0} role="button" onClick={() => open({ type: "cand", id: c._id })} style={{ ["--c" as string]: `var(--${STAGE_COLOR[s]})` }}>
                      <b>
                        {c.name} {c.example && <Pill c="info">Example</Pill>}
                      </b>
                      <div className="row">
                        <span>{c.role}</span>
                        {c.start && <span className="mono">{c.start}</span>}
                      </div>
                      {c.offer ? <div className="row mono">Offer {fmt(c.offer)}</div> : null}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {cs.some((c) => c.stage === "Rejected") && (
            <div className="sub">
              Not progressed:{" "}
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
  const { close, open } = useModal();
  const c = id ? state?.candidates.find((x) => x._id === id) : null;
  const f = useFormVals(c ? { ...c } : { stage: "Applied", dept: "Sales" });
  if (!state || (id && !c)) return null;
  const save = () => call(id ? "PATCH" : "POST", id ? `records/candidates/${id}` : "records/candidates", f.v).then(() => (toast("Saved"), close()));
  return (
    <Modal title={id ? c?.name || "" : "New candidate"} onClose={close}>
      <div className="fg">
        <Inp label="Full name" k="name" f={f} />
        <Inp label="Role applied for" k="role" f={f} />
        <Sel label="Department" k="dept" f={f} opts={state.lists.DEPTS} />
        <Sel label="Stage" k="stage" f={f} opts={state.lists.STAGES} />
        <Inp label="Source" k="src" f={f} placeholder="LinkedIn, referral, Wuzzuf" />
        <Inp label="Mobile" k="phone" f={f} />
        <Inp label="Email" k="email" f={f} type="email" />
        <Inp label="Offered monthly basic (EGP)" k="offer" f={f} type="number" />
        <Inp label="Planned start date" k="start" f={f} type="date" />
        <Txt label="Notes" k="notes" f={f} />
      </div>
      <div className="row2">
        <button className="btn primary" onClick={save}>
          Save
        </button>
        {id && c?.stage !== "Hired" && (
          <button
            className="btn"
            onClick={() =>
              call("POST", `candidates/${id}/hire`).then((res) => {
                toast("Employee record created. Complete the pay details.");
                open({ type: "emp", id: res.data._id });
              })
            }
          >
            Convert to employee
          </button>
        )}
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton onConfirm={() => call("DELETE", `records/candidates/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Assets ===================== */
export function Assets() {
  const { state, openPdf } = useHr();
  const { open } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const A = [...state.assets].sort((a, b) => String(b.issued || "").localeCompare(String(a.issued || "")));
  const out = A.filter((a) => !a.returned);
  return (
    <>
      <Top title="Assets">
        <button className="btn primary" onClick={() => open({ type: "ast" })}>
          Issue an asset
        </button>
      </Top>
      <div className="kpis">
        <Kpi label="Items issued" value={out.length} sub={`${A.length - out.length} returned`} />
        <Kpi label="Laptops out" value={out.filter((a) => a.type === "Laptop").length} />
        <Kpi label="Phones and SIM lines" value={out.filter((a) => a.type === "Mobile phone" || a.type === "SIM line").length} />
        <Kpi label="Vehicles" value={out.filter((a) => a.type === "Vehicle").length} />
      </div>
      {!A.length ? (
        <Empty title="No assets recorded" text="Record each laptop, phone, SIM line, vehicle and PPE set against the person who holds it. Print the belongings sheet at handover and again at return." />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Serial or number</th>
                <th>Held by</th>
                <th>Issued</th>
                <th>Returned</th>
                <th>Condition</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {A.map((a) => (
                <tr key={a._id} onClick={() => open({ type: "ast", id: a._id })}>
                  <td>{a.type}</td>
                  <td>
                    {a.desc} {a.example && <Pill c="info">Example</Pill>}
                  </td>
                  <td className="mono">{a.serial}</td>
                  <td>{byId[a.employee]?.name || "(removed)"}</td>
                  <td className="mono">{a.issued}</td>
                  <td className="mono">{a.returned || <Pill c="good">In use</Pill>}</td>
                  <td className="sub">{a.cond}</td>
                  <td>
                    <button
                      className="btn sm"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openPdf(`sheets/belongings?empId=${a.employee}`);
                      }}
                    >
                      Belongings sheet
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sub">Use the signed belongings sheet (mobile, line, laptop) for the handover and keep it in the personnel file. Exit clearance in Forms checks these items are back.</div>
    </>
  );
}

export function AssetModal({ id, empId }: { id?: string; empId?: string }) {
  const { state, call, toast } = useHr();
  const { close } = useModal();
  const a = id ? state?.assets.find((x) => x._id === id) : null;
  const f = useFormVals(a ? { ...a, empId: a.employee } : { type: "Laptop", issued: state?.today, empId: empId || "", cond: "New" });
  if (!state || (id && !a)) return null;
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  return (
    <Modal title={id ? "Asset" : "Issue an asset"} onClose={close}>
      <div className="fg">
        <Sel label="Held by" k="empId" f={f} opts={[["", "Choose"], ...emps]} />
        <Sel label="Type" k="type" f={f} opts={state.lists.ASSET_TYPES} />
        <Inp label="Description (make, model, number)" k="desc" f={f} />
        <Inp label="Serial or IMEI" k="serial" f={f} />
        <Inp label="Issued on" k="issued" f={f} type="date" />
        <Inp label="Returned on" k="returned" f={f} type="date" />
        <Inp label="Condition" k="cond" f={f} />
        <Inp label="Value (EGP, optional)" k="value" f={f} type="number" />
        <Txt label="Notes" k="note" f={f} />
      </div>
      <div className="row2">
        <button className="btn primary" onClick={() => call(id ? "PATCH" : "POST", id ? `records/assets/${id}` : "records/assets", f.v).then(() => (toast("Saved"), close()))}>
          Save
        </button>
        {id && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton onConfirm={() => call("DELETE", `records/assets/${id}`).then(close)} />
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
