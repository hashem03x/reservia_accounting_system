import { useEffect, useState } from "react";
import { ATT, ATTN, canEdit, DayRec, DN, dAdd, fmt, mLabel, pad, r1, sum, useHr } from "./hr-context";
import { ArmedButton, Chk, Empty, Inp, Kpi, Modal, MonthBar, Panel, Pill, Sel, statusPill, Top, Txt, useFormVals, useModal } from "./ui";
import { useEmp } from "./views-people";

// Reservia HR Portal - Attendance (daily sheet and month grid), Timesheets, Leave balances, Site
// visits and Expense claims: the reference prototype's vAtt, vTs, vLeave, vVisit and vExp.

function otText(d: DayRec) {
  const p: string[] = [];
  if (d.ot - d.otN > 0) p.push(`${r1(d.ot - d.otN)}h day`);
  if (d.otN > 0) p.push(`${r1(d.otN)}h night`);
  if (d.sp > 0) p.push(`${r1(d.sp)}h ${d.spT === "hol" ? "holiday" : d.spT === "fri" ? "Friday" : "Saturday"}`);
  return p.join(", ");
}
const dayTag = (d: DayRec) => (d.hol ? <Pill c="info">Public holiday</Pill> : d.rest ? <Pill>Rest day</Pill> : null);

function StatusSelect({ value, onChange, disabled, testid }: { value: string; onChange: (v: string) => void; disabled?: boolean; testid?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={testid}>
      <option value="">&nbsp;</option>
      {ATT.map((a) => (
        <option key={a.k} value={a.k}>
          {a.k} {a.n}
        </option>
      ))}
    </select>
  );
}

const lockedBanner = (st: string) =>
  st === "closed" ? "This month is closed in Payroll. Reopen it there to change attendance." : st === "review" || st === "approved" ? "This month's payroll is under review. Send it back to HR to change attendance." : "";

/* ===================== Attendance ===================== */
export function Attendance() {
  const { state, month, setMonth, call, toast } = useHr();
  const { go } = useModal();
  const [mode, setMode] = useState<"day" | "grid">("day");
  const [day, setDay] = useState(() => (state && state.today.slice(0, 7) === month ? state.today : `${month}-01`));
  const [rows, setRows] = useState<Record<string, { s: string; in: string; out: string; n: string }>>({});
  useEffect(() => {
    if (day.slice(0, 7) !== month) setDay(state && state.today.slice(0, 7) === month ? state.today : `${month}-01`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
  const di = +day.slice(8) - 1;
  useEffect(() => {
    if (!state) return;
    const o: typeof rows = {};
    state.inMonth.forEach((id) => {
      const d = state.time[id]?.days[di];
      if (d) o[id] = { s: d.s, in: d.in, out: d.out, n: d.n };
    });
    setRows(o);
  }, [state, di]);
  if (!state) return null;
  const edit = canEdit(state.role);
  const st = state.payroll.status;
  const lk = st !== "draft";
  const byId = Object.fromEntries(state.employees.map((e) => [e._id, e]));
  const head = (
    <Top title="Attendance">
      <div className="seg">
        <button className="btn sm" aria-pressed={mode === "day"} onClick={() => setMode("day")}>
          Daily sheet
        </button>
        <button className="btn sm" aria-pressed={mode === "grid"} onClick={() => setMode("grid")}>
          Month grid
        </button>
      </div>
    </Top>
  );
  if (!state.employees.length)
    return (
      <>
        {head}
        <Empty title="No employees yet" text="Add people first, then record attendance here." />
      </>
    );
  if (mode === "grid") {
    const dim = Object.values(state.time)[0]?.days.length || 30;
    const firstDays = Object.values(state.time)[0]?.days || [];
    return (
      <>
        {head}
        <div className="row2">
          <MonthBar />
        </div>
        <div className="legend">
          {ATT.map((a) => (
            <span key={a.k}>
              <span className={`ga ${a.c} s`}>{a.k}</span> {a.n} &nbsp;{" "}
            </span>
          ))}
          <span className="ga miss s">?</span> Not recorded
        </div>
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Employee</th>
                {Array.from({ length: dim }, (_, i) => (
                  <th key={i} className={`dn${firstDays[i]?.rest ? " off" : ""}`} title={DN[firstDays[i]?.dow ?? 0]}>
                    {i + 1}
                  </th>
                ))}
                <th className="num">Pres.</th>
                <th className="num">Abs.</th>
                <th className="num">OT h</th>
              </tr>
            </thead>
            <tbody>
              {state.inMonth.map((id) => {
                const t = state.time[id];
                const ab = t.days.filter((d) => d.s === "A" || d.s === "U").length;
                return (
                  <tr key={id}>
                    <td>
                      <b>{byId[id]?.name}</b>
                    </td>
                    {t.days.map((d) => (
                      <td key={d.date} className={`gc${d.rest || d.hol ? " off" : ""}`}>
                        {!d.emp ? null : d.s ? (
                          <button className={`ga ${ATTN[d.s].c}`} title={ATTN[d.s].n} onClick={() => (setDay(d.date), setMode("day"))}>
                            {d.s}
                          </button>
                        ) : d.unrec ? (
                          <button className="ga miss" title="Not recorded" onClick={() => (setDay(d.date), setMode("day"))}>
                            ?
                          </button>
                        ) : null}
                      </td>
                    ))}
                    <td className="num">{t.t.present}</td>
                    <td className="num">{ab}</td>
                    <td className="num">{r1(t.otHours)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  const dow = new Date(`${day}T00:00:00`).getDay();
  const anyDay = state.inMonth.map((id) => state.time[id]?.days[di]).find(Boolean);
  const off = anyDay ? anyDay.rest || anyDay.hol : false;
  const E2 = state.inMonth.filter((id) => state.time[id]?.days[di]?.emp);
  const move = (k: number) => {
    const nd = dAdd(day, k);
    setDay(nd);
    if (nd.slice(0, 7) !== month) setMonth(nd.slice(0, 7));
  };
  const saveDay = async () => {
    const changed = E2.filter((id) => {
      const d = state.time[id].days[di];
      const r = rows[id];
      return r && (r.s !== d.s || r.in !== d.in || r.out !== d.out || r.n !== d.n);
    }).map((id) => ({ empId: id, ...rows[id] }));
    if (!changed.length) return toast("Nothing changed");
    await call("POST", "attendance/day", { date: day, rows: changed });
    toast(`Saved ${changed.length} row${changed.length > 1 ? "s" : ""}`);
  };
  const fillDay = () => {
    if (off) return;
    const s = state.cfg.shiftStart || "09:00";
    const [h, m] = s.split(":").map(Number);
    const endMin = h * 60 + m + (state.cfg.stdHours + state.cfg.breakH) * 60;
    const end = `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`;
    setRows((o) => {
      const n = { ...o };
      E2.forEach((id) => {
        if (!n[id]?.s) n[id] = { s: "P", in: s, out: end, n: n[id]?.n || "" };
      });
      return n;
    });
    toast("Review and press Save day");
  };
  return (
    <>
      {head}
      <div className="row2">
        <button className="btn sm" aria-label="Previous day" onClick={() => move(-1)}>
          &lsaquo;
        </button>
        <input type="date" value={day} onChange={(e) => e.target.value && (setDay(e.target.value), e.target.value.slice(0, 7) !== month && setMonth(e.target.value.slice(0, 7)))} data-testid="att-day" />
        <button className="btn sm" aria-label="Next day" onClick={() => move(1)}>
          &rsaquo;
        </button>
        <b>{DN[dow]}</b>
        {anyDay?.hol ? <Pill c="info">Public holiday</Pill> : off ? <Pill>Rest day</Pill> : null}
        {day === state.today && <Pill c="good">Today</Pill>}
        {edit && (
          <span style={{ marginLeft: "auto" }} className="row2">
            <button className="btn" onClick={fillDay} disabled={lk}>
              Mark blanks present
            </button>
            <button className="btn primary" onClick={saveDay} disabled={lk} data-testid="att-save-day">
              Save day
            </button>
          </span>
        )}
      </div>
      {lk && <div className="banner">{lockedBanner(st)}</div>}
      {!E2.length ? (
        <Empty title="Nobody on the payroll for this date" />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>In</th>
                <th>Out</th>
                <th>Hours</th>
                <th>Overtime</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {E2.map((id) => {
                const d = state.time[id].days[di];
                const r = rows[id] || { s: "", in: "", out: "", n: "" };
                const dis = lk || !edit || !!state.time[id].approval;
                const set = (k: string, v: string) => setRows((o) => ({ ...o, [id]: { ...r, [k]: v } }));
                return (
                  <tr key={id}>
                    <td>
                      <b>{byId[id]?.name}</b>
                      <div className="sub">
                        {byId[id]?.role}
                        {state.time[id].approval ? " · timesheet approved" : ""}
                      </div>
                    </td>
                    <td>
                      <StatusSelect value={r.s} onChange={(v) => set("s", v)} disabled={dis} testid={`att-s-${byId[id]?.code}`} />
                    </td>
                    <td>
                      <input type="time" value={r.in} onChange={(e) => set("in", e.target.value)} disabled={dis} />
                    </td>
                    <td>
                      <input type="time" value={r.out} onChange={(e) => set("out", e.target.value)} disabled={dis} />
                    </td>
                    <td className="mono">{d.worked ? r1(d.worked) : ""}</td>
                    <td className="sub">
                      {otText(d)}
                      {d.late ? <span className="warnline"> Late {d.late} min</span> : null}
                    </td>
                    <td>
                      <input type="text" value={r.n} placeholder="Optional" onChange={(e) => set("n", e.target.value)} disabled={dis} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="sub">
        <button className="lnk" onClick={() => go("ts")}>
          Timesheets
        </button>{" "}
        approve each person's month; approval locks it until reopened.
      </div>
    </>
  );
}

/* ===================== Timesheets ===================== */
export function Timesheets({ initialEmp }: { initialEmp?: string }) {
  const { state, month, call, toast } = useHr();
  const [emp, setEmp] = useState(initialEmp || "");
  if (!state) return null;
  const byId = Object.fromEntries(state.employees.map((e) => [e._id, e]));
  const E = state.inMonth;
  const head = (
    <Top title="Timesheets">
      <MonthBar />
    </Top>
  );
  if (!E.length)
    return (
      <>
        {head}
        <Empty title="No employees on the payroll this month" />
      </>
    );
  const id = emp && E.includes(emp) ? emp : E[0];
  const t = state.time[id];
  const st = state.payroll.status;
  const lk = st !== "draft";
  const ap = t.approval;
  const edit = canEdit(state.role);
  const canDecide = edit || state.role === "manager";
  const dis = lk || !!ap || !edit;
  const change = async (d: DayRec, k: "s" | "in" | "out", v: string) => {
    const rec = { s: d.s, in: d.in, out: d.out, n: d.n, [k]: v };
    if (k === "s" && ["A", "L", "S", "U"].includes(v)) {
      rec.in = "";
      rec.out = "";
    }
    if (k !== "s" && !rec.s && (rec.in || rec.out)) rec.s = "P";
    await call("PUT", `attendance/${id}/${month}`, { days: { [d.date]: rec } });
  };
  return (
    <>
      {head}
      <div className="row2">
        <label className="lbl" style={{ minWidth: 220 }}>
          Employee
          <select value={id} onChange={(e) => setEmp(e.target.value)} data-testid="ts-emp">
            {E.map((x) => (
              <option key={x} value={x}>
                {byId[x]?.name}
              </option>
            ))}
          </select>
        </label>
        <span style={{ marginLeft: "auto" }} className="row2">
          {ap ? (
            <>
              <Pill c="good">Approved {String(ap.at).slice(0, 10)}</Pill>
              {canDecide && (
                <button className="btn" disabled={st === "closed"} onClick={() => call("POST", `timesheets/${id}/${month}/reopen`).then(() => toast("Timesheet reopened"))}>
                  Reopen
                </button>
              )}
            </>
          ) : (
            <>
              {edit && (
                <button className="btn" disabled={lk} onClick={() => call("POST", `attendance/${id}/${month}/fill`).then((r) => toast(r.data.filled ? `Marked ${r.data.filled} days present` : "No blank working days"))}>
                  Mark blank working days present
                </button>
              )}
              {canDecide && (
                <button className="btn primary" disabled={lk} data-testid="ts-approve" onClick={() => call("POST", `timesheets/${id}/${month}/approve`).then(() => toast("Timesheet approved"))}>
                  Approve timesheet
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {lk && <div className="banner">{lockedBanner(st)}</div>}
      <div className="kpis">
        <Kpi label="Days present" value={t.t.present} sub={`of ${t.t.emp} calendar days`} />
        <Kpi label="Absent or unpaid" value={t.t.absent + t.t.uleave} sub={`${t.t.leave} annual, ${t.t.sick} sick leave days`} />
        <Kpi label="Overtime hours" value={r1(t.otHours)} sub={`${r1(t.otD)} day, ${r1(t.otN)} night, ${r1(t.otR + t.otH)} rest or holiday`} />
        <Kpi label="Late minutes" value={t.t.late} sub={state.cfg.lateDeduct ? "Deducted" : "Tracked, not deducted"} />
        <Kpi label="Not recorded" value={t.t.unrec} sub="working days" alert={!!t.t.unrec} />
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th></th>
              <th>Status</th>
              <th>In</th>
              <th>Out</th>
              <th className="num">Hours</th>
              <th>Overtime</th>
            </tr>
          </thead>
          <tbody>
            {t.days.map((d, i) =>
              !d.emp ? (
                <tr className="dim" key={d.date}>
                  <td className="mono">
                    {pad(i + 1)} {DN[d.dow]}
                  </td>
                  <td colSpan={6} className="sub">
                    Not employed
                  </td>
                </tr>
              ) : (
                <tr key={d.date} className={d.rest || d.hol ? "off" : ""}>
                  <td className="mono">
                    {pad(i + 1)} {DN[d.dow]}
                  </td>
                  <td>{dayTag(d)}</td>
                  <td>
                    <StatusSelect value={d.s} onChange={(v) => change(d, "s", v)} disabled={dis} />
                  </td>
                  <td>
                    <input type="time" defaultValue={d.in} key={`${d.date}-in-${d.in}`} onBlur={(e) => e.target.value !== d.in && change(d, "in", e.target.value)} disabled={dis} />
                  </td>
                  <td>
                    <input type="time" defaultValue={d.out} key={`${d.date}-out-${d.out}`} onBlur={(e) => e.target.value !== d.out && change(d, "out", e.target.value)} disabled={dis} />
                  </td>
                  <td className="mono num">{d.worked ? r1(d.worked) : ""}</td>
                  <td className="sub">
                    {otText(d)}
                    {d.late ? <span className="warnline"> Late {d.late}</span> : null}
                    {d.unrec ? <span className="warnline">Not recorded</span> : null}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ===================== Leave balances ===================== */
export function Leave() {
  const { state, download } = useHr();
  const { open } = useModal();
  if (!state) return null;
  const yr = state.month.slice(0, 4);
  const byId = Object.fromEntries(state.employees.map((e) => [e._id, e]));
  const rows = state.leave.filter((r) => byId[r.empId]);
  return (
    <>
      <Top title={`Leave balances ${yr}`}>
        <MonthBar />
        {canEdit(state.role) && (
          <button className="btn" onClick={() => download(`exports/leave.csv?month=${state.month}`)}>
            Export CSV
          </button>
        )}
      </Top>
      {!rows.length ? (
        <Empty title="No employees yet" />
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Entitlement" value={sum(rows, (r) => r.ent)} sub="working days, all staff" />
            <Kpi label="Taken" value={sum(rows, (r) => r.used)} sub="annual and casual" />
            <Kpi label="Pending requests" value={sum(rows, (r) => r.pend)} sub="days" />
            <Kpi label="Sick days" value={sum(rows, (r) => r.sick)} sub="recorded in attendance" />
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Entitlement</th>
                  <th className="num">Taken</th>
                  <th className="num">of which casual</th>
                  <th className="num">Pending</th>
                  <th className="num">Remaining</th>
                  <th className="num">Sick</th>
                  <th className="num">Unpaid or absent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const e = byId[r.empId];
                  return (
                    <tr key={r.empId}>
                      <td>
                        <button className="lnk" onClick={() => open({ type: "emp", id: e._id })}>
                          {e.name}
                        </button>
                        <div className="sub">
                          {e.role}
                          {e.hire > `${yr}-01-01` ? ` · joined ${e.hire}, pro rata` : ""}
                        </div>
                      </td>
                      <td className="num">{r.ent}</td>
                      <td className="num">{r.used}</td>
                      <td className="num">
                        {r.cas}
                        {r.cas > 7 && <span className="warnline"> over 7</span>}
                      </td>
                      <td className="num">{r.pend || ""}</td>
                      <td className="num">
                        <b>{r.left}</b>
                      </td>
                      <td className="num">{r.sick || ""}</td>
                      <td className="num">{r.unp || ""}</td>
                      <td>
                        {canEdit(state.role) && (
                          <button className="btn sm" onClick={() => open({ type: "frm", ft: "leave", empId: e._id })}>
                            Request leave
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="sub">
        Entitlement is {state.cfg.annualDays} working days a year, pro rata in the joining year. Law 14 of 2025 gives 15 days in year one and 21 from year two; the company term is more generous and counts from the approved HR-F01 forms. Casual leave is capped at 7 days a year, 2 at a time.
      </div>
    </>
  );
}

/* ===================== Site visits ===================== */
export function Visits() {
  const { state } = useHr();
  const { open } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const V = state.visits.filter((v) => v.date.slice(0, 7) === state.month).sort((a, b) => a.date.localeCompare(b.date));
  const done = V.filter((v) => v.status === "Done");
  const cairo = done.filter((v) => v.gc).length;
  const total = (v: (typeof V)[number]) => v.pay?.total || 0;
  const byC: Record<string, number> = {};
  done.forEach((v) => (byC[v.city] = (byC[v.city] || 0) + total(v)));
  const mx = Math.max(1, ...Object.values(byC));
  return (
    <>
      <Top title="Site visits">
        <MonthBar />
        {canEdit(state.role) && (
          <button className="btn primary" data-testid="hr-new-visit" onClick={() => open({ type: "vis" })}>
            Log a visit
          </button>
        )}
      </Top>
      <div className="kpis">
        <Kpi label="Visits done" value={done.length} sub={`${V.filter((v) => v.status === "Planned").length} planned`} />
        <Kpi label="Greater Cairo" value={cairo} sub="visits" />
        <Kpi label="Other cities" value={done.length - cairo} sub="visits" />
        <Kpi label="Site-days" value={sum(done, (v) => v.days || 1)} sub={`${sum(done, (v) => v.nights || 0)} nights away`} />
        {state.canSeePay && <Kpi label="Allowances" value={fmt(sum(done, total))} sub="EGP, paid with payroll" />}
      </div>
      {!V.length ? (
        <Empty title={`No visits logged for ${mLabel(state.month)}`} text="Log each visit with the city, client site, days and nights. Allowances follow the city rates in Settings and flow into the monthly payout." />
      ) : (
        <>
          {state.canSeePay && (
            <div className="grid2">
              <Panel title="Allowance by city">
                <div className="bars">
                  {Object.keys(byC)
                    .sort((a, b) => byC[b] - byC[a])
                    .map((k) => (
                      <div className="bar" key={k}>
                        <span>{k}</span>
                        <div className="t">
                          <i style={{ width: `${(byC[k] / mx) * 100}%`, background: "var(--amber)" }} />
                        </div>
                        <span className="v">{fmt(byC[k])}</span>
                      </div>
                    ))}
                </div>
              </Panel>
            </div>
          )}
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>City</th>
                  <th>Client or site</th>
                  <th>Purpose</th>
                  <th className="num">Days</th>
                  <th className="num">Nights</th>
                  {state.canSeePay && <th className="num">Allowance</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {V.map((v) => (
                  <tr key={v._id} onClick={() => open({ type: "vis", id: v._id })}>
                    <td className="mono">{v.date}</td>
                    <td>{byId[v.employee]?.name || "(removed)"}</td>
                    <td>
                      {v.city}
                      <div className="sub">{v.zone}</div>
                    </td>
                    <td>
                      {v.site} {v.example && <Pill c="info">Example</Pill>}
                    </td>
                    <td>{v.purpose}</td>
                    <td className="num">{v.days || 1}</td>
                    <td className="num">{v.nights || 0}</td>
                    {state.canSeePay && <td className="num">{v.status === "Done" ? fmt(total(v)) : <span className="sub">{fmt(total(v))}</span>}</td>}
                    <td>
                      <Pill c={v.status === "Done" ? "good" : v.status === "Planned" ? "info" : ""}>{v.status}</Pill>
                      {v.status === "Done" && !v.report && (
                        <>
                          {" "}
                          <Pill c="warn">Report due</Pill>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function VisitModal({ id, empId }: { id?: string; empId?: string }) {
  const { state, call, toast, openPdf } = useHr();
  const { close } = useModal();
  const v = id ? state?.visits.find((x) => x._id === id) : null;
  const f = useFormVals(v ? { ...v, empId: v.employee } : { date: state?.today, city: "Cairo", days: 1, nights: 0, status: "Planned", purpose: "Site survey", empId: empId || "" });
  if (!state || (id && !v)) return null;
  const edit = canEdit(state.role);
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, e.name] as [string, string]);
  const save = () =>
    call(id ? "PATCH" : "POST", id ? `visits/${id}` : "visits", f.v).then((r) => {
      toast(r.data.attendanceDays ? `Saved. ${r.data.attendanceDays} days recorded as Site visit in Attendance` : "Saved");
      close();
    });
  return (
    <Modal title={id ? "Site visit" : "Log a site visit"} onClose={close}>
      <div className="fg">
        <Sel label="Employee" k="empId" f={f} opts={[["", "Choose"], ...emps]} />
        <Inp label="First day" k="date" f={f} type="date" />
        <Sel label="City" k="city" f={f} opts={state.cfg.cities.map((c) => [c.n, `${c.n} (${c.z})`] as [string, string])} />
        <Inp label="Client or site" k="site" f={f} />
        <Sel label="Purpose" k="purpose" f={f} opts={state.lists.PURPOSES} />
        <Sel label="Status" k="status" f={f} opts={state.lists.VISIT_STATUS} />
        <Inp label="Days on site" k="days" f={f} type="number" min={1} />
        <Inp label="Nights away" k="nights" f={f} type="number" min={0} />
        <Inp label="Transport paid by employee (EGP, on receipts)" k="transport" f={f} type="number" />
        <Inp label="Accommodation paid by employee (EGP, on receipts)" k="accom" f={f} type="number" />
        <Inp label="Meals paid by employee (EGP, on receipts)" k="meals" f={f} type="number" />
        <Inp label="CRM lead or project reference" k="ref" f={f} />
        <Chk label="Client or hotel provides all meals (no per diem)" k="mealsProvided" f={f} full />
        <Txt label="Notes" k="notes" f={f} />
        <Txt label="Visit report (HR-F04, due within 24 hours of return)" k="report" f={f} placeholder="What was done, findings, photos taken, next steps" />
      </div>
      {v?.pay && (
        <div className="sub">
          This visit pays {fmt(v.pay.allow + v.pay.pd)} EGP allowance{v.pay.pd ? " and per diem" : ""} ({v.gc ? "Greater Cairo day" : "outside Greater Cairo"}) plus {fmt(v.pay.reimb)} reimbursed.
        </div>
      )}
      <div className="sub">Only visits marked Done are paid. Marking a visit Done also records the working days as Site visit in Attendance.</div>
      <div className="row2">
        {edit && (
          <button className="btn primary" data-testid="hr-save-visit" onClick={save}>
            Save
          </button>
        )}
        {id && (
          <button className="btn" onClick={() => openPdf(`sheets/report?id=${id}`)}>
            Print visit report
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton onConfirm={() => call("DELETE", `visits/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Expense claims ===================== */
export function Expenses() {
  const { state } = useHr();
  const { open } = useModal();
  const byId = useEmp();
  if (!state) return null;
  const X = state.expenses.filter((x) => String(x.payMonth || x.date).slice(0, 7) === state.month).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const ap = X.filter((x) => x.status === "Approved");
  const pd = X.filter((x) => x.status === "Pending");
  const byT: Record<string, number> = {};
  ap.forEach((x) => (byT[x.type] = (byT[x.type] || 0) + x.amount));
  const mx = Math.max(1, ...Object.values(byT));
  return (
    <>
      <Top title="Expense claims">
        <MonthBar />
        {canEdit(state.role) && (
          <button className="btn primary" data-testid="hr-new-exp" onClick={() => open({ type: "exp" })}>
            New claim
          </button>
        )}
      </Top>
      <div className="kpis">
        <Kpi label="Approved" value={fmt(sum(ap, (x) => x.amount))} sub={`${ap.length} claims, paid with ${mLabel(state.month)} payroll`} />
        <Kpi label="Waiting" value={fmt(sum(pd, (x) => x.amount))} sub={`${pd.length} claims`} alert={!!pd.length} />
        <Kpi label="No receipt" value={X.filter((x) => !x.receipt).length} sub="claims to chase" />
      </div>
      {!X.length ? (
        <Empty title={`No claims for ${mLabel(state.month)}`} text="Taxi, fuel, accommodation, meals or materials paid by an employee. Approved claims are reimbursed in the monthly payout and are not taxed." />
      ) : (
        <>
          <div className="grid2">
            <Panel title="Approved by type">
              <div className="bars">
                {Object.keys(byT)
                  .sort((a, b) => byT[b] - byT[a])
                  .map((k) => (
                    <div className="bar" key={k}>
                      <span>{k.split(" (")[0]}</span>
                      <div className="t">
                        <i style={{ width: `${(byT[k] / mx) * 100}%`, background: "var(--amber)" }} />
                      </div>
                      <span className="v">{fmt(byT[k])}</span>
                    </div>
                  ))}
              </div>
            </Panel>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Employee</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th>Receipt</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {X.map((x) => (
                  <tr key={x._id} onClick={() => open({ type: "exp", id: x._id })}>
                    <td className="mono">{x.date}</td>
                    <td>{byId[x.employee]?.name || "(removed)"}</td>
                    <td>{x.type}</td>
                    <td className="sub">
                      {x.desc} {x.example && <Pill c="info">Example</Pill>}
                    </td>
                    <td className="num">{fmt(x.amount)}</td>
                    <td>{x.receipt ? <Pill c="good">Yes</Pill> : x.receiptOverride ? <Pill c="info">MD override</Pill> : <Pill c="warn">No</Pill>}</td>
                    <td>{statusPill(x.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function ExpenseModal({ id, empId }: { id?: string; empId?: string }) {
  const { state, call, toast } = useHr();
  const { close } = useModal();
  const x = id ? state?.expenses.find((e) => e._id === id) : null;
  const f = useFormVals(x ? { ...x, empId: x.employee, receiptOverride: !!x.receiptOverride } : { date: state?.today, type: state?.lists.EXPENSE_TYPES[0], status: "Pending", receipt: true, payMonth: state?.month, empId: empId || "" });
  if (!state || (id && !x)) return null;
  const edit = canEdit(state.role);
  const canDecide = edit || state.role === "manager";
  const emps = state.employees.filter((e) => e.status !== "Left").map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  const save = async () => {
    if (edit && (!id || x?.status === "Pending" || state.role === "md")) await call(id ? "PATCH" : "POST", id ? `expenses/${id}` : "expenses", f.v);
    if (id && canDecide && f.v.status !== x?.status) await call("POST", `expenses/${id}/decide`, { status: f.v.status, by: f.v.by, note: f.v.note, payMonth: f.v.payMonth, receiptOverride: !!f.v.receiptOverride });
    toast("Saved");
    close();
  };
  return (
    <Modal title={id ? "Expense claim" : "New expense claim"} onClose={close}>
      <div className="fg">
        <Sel label="Employee" k="empId" f={f} opts={[["", "Choose"], ...emps]} disabled={!edit} />
        <Inp label="Date paid" k="date" f={f} type="date" disabled={!edit} />
        <Sel label="Type" k="type" f={f} opts={state.lists.EXPENSE_TYPES} disabled={!edit} />
        <Inp label="Amount (EGP)" k="amount" f={f} type="number" disabled={!edit} />
        <Inp label="Reimburse with payroll of" k="payMonth" f={f} type="month" />
        <Inp label="Project or client" k="ref" f={f} disabled={!edit} />
        <Inp label="Description" k="desc" f={f} full disabled={!edit} />
        <Chk label="Receipt attached to the claim file" k="receipt" f={f} full />
      </div>
      {id && canDecide && (
        <div className="sect">
          <h4>Decision</h4>
          <div className="fg">
            <Sel label="Status" k="status" f={f} opts={state.lists.EXPENSE_TYPES ? ["Pending", "Approved", "Rejected"] : []} />
            <Inp label="Decided by" k="by" f={f} />
            <Inp label="Note" k="note" f={f} full />
            {state.role === "md" && !f.v.receipt && <Chk label="Approve without a receipt (MD override)" k="receiptOverride" f={f} full />}
          </div>
        </div>
      )}
      <div className="row2">
        {(edit || canDecide) && (
          <button className="btn primary" data-testid="hr-save-exp" onClick={() => save().catch(() => undefined)}>
            {id ? "Save" : "Submit claim"}
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton onConfirm={() => call("DELETE", `expenses/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}
