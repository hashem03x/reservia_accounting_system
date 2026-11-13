import { useEffect, useState } from "react";
import { canEdit, daysIn, fmt, mLabel, PayRow, r1, r2, sum, useHr } from "./hr-context";
import { Drawer, Empty, Inp, Kpi, MonthBar, Panel, Pill, Sel, Top, useFormVals, useModal } from "./ui";

// Reservia HR Portal - Payroll (approval flow, register, payslip drawer with targets and
// adjustments), ERP link and Reports: the reference prototype's vPay, payDrawer, vErp and vReports.
// Every figure comes from the server engine; this file only shows it and sends decisions.

const STEPS: [string, string][] = [["draft", "1. HR prepares"], ["review", "2. Review"], ["approved", "3. MD approved"], ["closed", "4. Closed and paid"]];
const LOG_LABEL: Record<string, string> = { draft: "Sent back to HR", review: "Submitted for review", approved: "Approved", closed: "Closed and locked", reopen: "Reopened" };

export function Payroll() {
  const { state, month, call, toast, openPdf, download } = useHr();
  const { open, go } = useModal();
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  if (!state) return null;
  const head = (
    <Top title="Payroll">
      <MonthBar />
    </Top>
  );
  if (!state.canSeePay)
    return (
      <>
        {head}
        <Empty title="Pay is not shown to your role" text="Line managers approve forms, claims and timesheets for their team. Payroll is prepared by HR, approved by the MD and read by Finance." />
      </>
    );
  const rows = state.payroll.rows;
  if (!rows.length)
    return (
      <>
        {head}
        <Empty title={`No employees on the payroll in ${mLabel(month)}`} />
      </>
    );
  const st = state.payroll.status;
  const si = STEPS.findIndex((s) => s[0] === st);
  const role = state.role;
  const act = (path: string, body: Record<string, unknown> = {}, msg = "Done") =>
    call("POST", `payroll/${month}/${path}`, body)
      .then(() => {
        toast(msg);
        setNote("");
        setOverride(false);
      })
      .catch(() => undefined);
  const unrec = sum(Object.values(state.time), (t) => t.t.unrec);
  return (
    <>
      {head}
      <Panel title="Approval flow">
        <div className="flow" data-testid="pay-flow">
          {STEPS.map((x, i) => (
            <span key={x[0]} className={i < si ? "ok" : i === si ? "on" : ""}>
              {x[1]}
            </span>
          ))}
        </div>
        <div className="row2" style={{ marginTop: 10 }}>
          {st !== "closed" && (role === "md" || role === "hr" || role === "finance") && (
            <input style={{ flex: "1 1 220px" }} placeholder={st === "draft" ? "Note (needed for an override)" : "Note or reason"} value={note} onChange={(e) => setNote(e.target.value)} data-testid="pay-note" />
          )}
          {st === "closed" && role === "md" && <input style={{ flex: "1 1 220px" }} placeholder="Reason for reopening" value={note} onChange={(e) => setNote(e.target.value)} data-testid="pay-note" />}
          {st === "draft" && canEdit(role) && (
            <>
              {unrec > 0 && (
                <label className="chk">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} data-testid="pay-override" /> Submit with {unrec} blank days
                </label>
              )}
              <button className="btn primary" data-testid="pay-submit" onClick={() => act("submit", { override, note }, "Submitted for review")}>
                Submit for review
              </button>
            </>
          )}
          {st === "review" && role === "md" && (
            <button className="btn primary" data-testid="pay-approve" onClick={() => act("approve", { note }, "Approved")}>
              Approve as MD
            </button>
          )}
          {(st === "review" || st === "approved") && (role === "md" || role === "finance") && (
            <button className="btn" data-testid="pay-sendback" onClick={() => act("send-back", { note }, "Sent back to HR")}>
              Send back to HR
            </button>
          )}
          {st === "approved" && canEdit(role) && (
            <button className="btn primary" data-testid="pay-close" onClick={() => act("close", { note }, "Month closed")}>
              Close and lock month
            </button>
          )}
          {st === "closed" && role === "md" && (
            <button className="btn" data-testid="pay-reopen" onClick={() => act("reopen", { note }, "Month reopened")}>
              Reopen month
            </button>
          )}
          <span style={{ marginLeft: "auto" }} className="row2">
            {canEdit(role) && (
              <button className="btn" onClick={() => download(`payroll/${month}/register.csv`)}>
                Register CSV
              </button>
            )}
            <button className="btn" data-testid="pay-register" onClick={() => openPdf(`payroll/${month}/register.pdf`)}>
              Print register
            </button>
            <button className="btn" onClick={() => download(`payroll/${month}/journal.json`)}>
              ERP journal
            </button>
            {st === "closed" && canEdit(role) && (
              <button className="btn" data-testid="pay-email-all" onClick={() => call("POST", `payroll/${month}/email`, {}).then((r) => toast(emailSummary(r.data))).catch(() => undefined)}>
                Email all payslips
              </button>
            )}
          </span>
        </div>
        {state.payroll.log.length ? (
          <div className="tl" style={{ marginTop: 10 }} data-testid="pay-log">
            {state.payroll.log.slice(-6).map((l, i) => (
              <div key={i}>
                <time>{String(l.at).slice(0, 10)}</time>
                <span>
                  {LOG_LABEL[l.s] || l.s} by {l.byName}
                  {l.note ? `: ${l.note}` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="sub" style={{ marginTop: 8 }}>
            Each step is stamped with your name and the date.
          </div>
        )}
      </Panel>
      {state.payroll.issues.length > 0 && (
        <Panel title="Before you close">
          <div className="todo">
            {state.payroll.issues.map((i, n) => (
              <button key={n} onClick={() => go(i.view)}>
                <Pill c={i.level}>{i.level === "warn" ? "Fix" : "Check"}</Pill>
                <span className="who">{i.text}</span>
              </button>
            ))}
          </div>
        </Panel>
      )}
      <div className="kpis">
        <Kpi label="Net payout" value={fmt(sum(rows, (r) => r.net))} sub="EGP to employees" />
        <Kpi label="Employer cost" value={fmt(sum(rows, (r) => r.cost))} sub={`incl. insurance ${fmt(sum(rows, (r) => r.insEr))}`} />
        <Kpi label="Overtime" value={fmt(sum(rows, (r) => r.otPay))} sub={`${r1(sum(rows, (r) => r.otHours))} hours`} />
        <Kpi label="Commission" value={fmt(sum(rows, (r) => r.comm))} sub={`targets entered for ${rows.filter((r) => r.tgt != null).length} of ${rows.filter((r) => r.commBase).length} eligible`} />
        <Kpi label="Site and travel" value={fmt(sum(rows, (r) => r.site) + sum(rows, (r) => r.reimb))} sub={`${sum(rows, (r) => r.nVisits)} visits, ${sum(rows, (r) => r.nExp)} claims`} />
        <Kpi label="Insurance and tax withheld" value={fmt(sum(rows, (r) => r.insEmp) + sum(rows, (r) => r.tax))} sub="for the authorities" />
      </div>
      <div className="tablewrap">
        <table data-testid="pay-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="num">Fixed pay</th>
              <th className="num">Commission</th>
              <th className="num">Absence</th>
              <th className="num">Overtime</th>
              <th className="num">Site</th>
              <th className="num">Reimb.</th>
              <th className="num">Adjust.</th>
              <th className="num">Insurance</th>
              <th className="num">Tax</th>
              <th className="num">Net</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => open({ type: "pay", id: r.id })} data-testid={`pay-row-${r.code}`}>
                <td>
                  <b>{r.name}</b>
                  <div className="sub">
                    {r.role} · {r.t.present} days, {r1(r.otHours)} OT h
                  </div>
                </td>
                <td className="num">{fmt(r.fixed)}</td>
                <td className="num">{r.comm ? fmt(r.comm) : r.tgt == null && r.commBase ? <span className="warnline">target?</span> : ""}</td>
                <td className="num">{r.absDed + r.lateDed ? `-${fmt(r.absDed + r.lateDed)}` : ""}</td>
                <td className="num">{r.otPay ? fmt(r.otPay) : ""}</td>
                <td className="num">{r.site ? fmt(r.site) : ""}</td>
                <td className="num">{r.reimb ? fmt(r.reimb) : ""}</td>
                <td className="num">{r.addTx + r.addNo - r.ded ? fmt(r.addTx + r.addNo - r.ded) : ""}</td>
                <td className="num">-{fmt(r.insEmp)}</td>
                <td className="num">-{fmt(r.tax)}</td>
                <td className="num">
                  <b>{fmt(r.net)}</b>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" onClick={() => openPdf(`payroll/${month}/payslips/${r.id}.pdf`)}>
                    Payslip
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <b>Total</b>
              </td>
              <td className="num">{fmt(sum(rows, (r) => r.fixed))}</td>
              <td className="num">{fmt(sum(rows, (r) => r.comm))}</td>
              <td className="num">-{fmt(sum(rows, (r) => r.absDed + r.lateDed))}</td>
              <td className="num">{fmt(sum(rows, (r) => r.otPay))}</td>
              <td className="num">{fmt(sum(rows, (r) => r.site))}</td>
              <td className="num">{fmt(sum(rows, (r) => r.reimb))}</td>
              <td className="num">{fmt(sum(rows, (r) => r.addTx + r.addNo - r.ded))}</td>
              <td className="num">-{fmt(sum(rows, (r) => r.insEmp))}</td>
              <td className="num">-{fmt(sum(rows, (r) => r.tax))}</td>
              <td className="num">
                <b data-testid="pay-total-net">{fmt(sum(rows, (r) => r.net))}</b>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="sub">
        Month convention: 30 days. Fixed pay = basic gross + transport + incentive monthly payout + other, from each contract. Commission is paid {state.cfg.commPro ? "pro rata to the target achieved" : "in full when the target reaches 100%"}. Overtime hourly rate = monthly {state.cfg.otBase === "gross" ? "total wage" : "basic pay"} / 30 / {state.cfg.stdHours}. Reimbursements (transport, accommodation, meals on receipts) are {state.cfg.reimbTaxable ? "taxed" : "not taxed"}. Rates for overtime, insurance and tax are in Settings and should be confirmed with your accountant before the first run.
      </div>
    </>
  );
}

function emailSummary(results: { status: string; name?: string; error?: string }[]) {
  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status !== "sent");
  return `${sent} payslip${sent === 1 ? "" : "s"} emailed${failed.length ? `; failed: ${failed.map((f) => `${f.name} (${f.error})`).join(", ")}` : ""}`;
}

export function PayDrawer({ id }: { id: string }) {
  const { state, month, call, toast, openPdf } = useHr();
  const { close } = useModal();
  const r = state?.payroll.rows.find((x) => x.id === id);
  const [pct, setPct] = useState<string>(r?.tgt == null ? "" : String(r.tgt));
  useEffect(() => setPct(r?.tgt == null ? "" : String(r?.tgt)), [r?.tgt]);
  const adj = useFormVals({ label: "", type: "add", amount: "", taxable: true });
  if (!state || !r) return null;
  const c = state.cfg;
  const open = state.payroll.status === "draft" && canEdit(state.role);
  const e = state.employees.find((x) => x._id === id);
  const ad = state.adjustments.filter((a) => a.empId === id);
  const vs = state.visits.filter((v) => v.employee === id && v.status === "Done" && v.date.slice(0, 7) === month);
  const ex = state.expenses.filter((x) => x.employee === id && x.status === "Approved" && String(x.payMonth || x.date).slice(0, 7) === month);
  const L = (a: string, b: string, cls?: string) => (
    <tr className={cls} key={a + b}>
      <td>{a}</td>
      <td className="num">{b}</td>
    </tr>
  );
  const ot = (h: number, m: number, label: string) => (h ? L(`${label}: ${r1(h)} h x ${r2(r.hr * m)}`, fmt(r.hr * h * m)) : null);
  return (
    <Drawer title={r.name} sub={`${mLabel(month)} · ${state.payroll.status}`} onClose={close}>
      <div className="sub">
        Present {r.t.present} days · absent {r.t.absent + r.t.uleave} · leave {r.t.leave} · sick {r.t.sick} · overtime {r1(r.otHours)} h · site visits {r.nVisits}
      </div>
      <table className="stmt" data-testid="pay-stmt">
        <tbody>
          {L(`Basic gross salary${r.t.emp < daysIn(month) ? " (part month)" : ""}`, fmt(r.basic))}
          {L("Transportation allowance", fmt(r.transport))}
          {r.incentive ? L("Incentive monthly payout", fmt(r.incentive)) : null}
          {r.other ? L("Other fixed allowances", fmt(r.other)) : null}
          {r.comm ? L(`Performance commission (${r.tgt}% of target)`, fmt(r.comm)) : null}
          {ot(r.otD, c.otDay, "Overtime, day")}
          {ot(r.otN, c.otNight, "Overtime, night")}
          {ot(r.otF, c.otFri, "Friday work")}
          {ot(r.otS, c.otSat, "Saturday work")}
          {ot(r.otH, c.otHol, "Public holiday work")}
          {vs.map((v) => [L(`Site visit ${v.date}, ${v.city} (${v.days || 1} d, ${v.nights || 0} n): allowance${v.pay?.pd ? " and per diem" : ""}`, fmt((v.pay?.allow || 0) + (v.pay?.pd || 0))), v.pay?.reimb ? L("  reimbursed", fmt(v.pay.reimb)) : null])}
          {ex.map((x) => L(`Expense claim ${x.date}: ${x.type}${x.desc ? `, ${x.desc}` : ""}`, fmt(x.amount)))}
          {ad.filter((a) => a.type === "add").map((a) => L(`${a.label}${a.taxable ? "" : " (not taxed)"}`, fmt(a.amount)))}
          {L("Total earnings", fmt(r.earn), "tot")}
          {r.absDed ? L(`Absence: ${r.unpaidDays} day${r.unpaidDays > 1 ? "s" : ""} unpaid`, `-${fmt(r.absDed)}`) : null}
          {r.lateDed ? L(`Late arrival: ${r.t.late} min (after the free grace arrivals)`, `-${fmt(r.lateDed)}`) : null}
          {ad.filter((a) => a.type !== "add").map((a) => L(a.label, `-${fmt(a.amount)}`))}
          {L(`Social insurance, employee ${c.insEmp}% on ${fmt(r.insBase)}`, `-${fmt(r.insEmp)}`)}
          {L("Income tax", `-${fmt(r.tax)}`)}
          {L("Net payout", fmt(r.net), "net")}
        </tbody>
      </table>
      <div className="sub">
        Employer cost this month: {fmt(r.cost)} EGP including employer insurance of {fmt(r.insEr)}.
      </div>
      {open && (
        <div className="sect">
          <h4>Performance target for {mLabel(month)}</h4>
          <div className="fg">
            <label>
              Target achieved (%)
              <input type="number" min={0} max={200} value={pct} placeholder="Enter to release commission" onChange={(ev) => setPct(ev.target.value)} data-testid="pay-tgt" />
            </label>
            <label>
              Contract commission (EGP)
              <input value={fmt(e?.commission || 0)} disabled />
            </label>
          </div>
          <div className="row2">
            <button className="btn" data-testid="pay-tgt-save" onClick={() => call("PUT", `targets/${id}/${month}`, { pct: pct === "" ? null : +pct }).then(() => toast("Target saved"))}>
              Save target
            </button>
            <span className="sub">{c.commPro ? "Paid pro rata to the percentage." : "Paid in full at 100% or more, nothing below."}</span>
          </div>
        </div>
      )}
      {open && (
        <div className="sect">
          <h4>Adjustments for {mLabel(month)}</h4>
          {ad.map((a) => (
            <div className="row2" key={a._id}>
              <span>
                {a.type === "add" ? "+" : "-"}
                {fmt(a.amount)} {a.label}
              </span>
              <button className="btn sm" onClick={() => call("DELETE", `adjustments/${a._id}`)}>
                Remove
              </button>
            </div>
          ))}
          <div className="fg">
            <Inp label="Description" k="label" f={adj} placeholder="Bonus, advance, penalty" />
            <Sel label="Type" k="type" f={adj} opts={[["add", "Addition"], ["ded", "Deduction"]]} />
            <Inp label="Amount (EGP)" k="amount" f={adj} type="number" />
            <label className="chk">
              <input type="checkbox" checked={!!adj.v.taxable} onChange={(ev) => adj.set("taxable", ev.target.checked)} /> Taxable
            </label>
          </div>
          <div>
            <button className="btn" data-testid="pay-adj-add" onClick={() => call("POST", "adjustments", { empId: id, month, ...adj.v }).then(() => adj.setV({ label: "", type: "add", amount: "", taxable: true }))}>
              Add adjustment
            </button>
          </div>
        </div>
      )}
      <div className="row2">
        <button className="btn primary" onClick={() => openPdf(`payroll/${month}/payslips/${id}.pdf`)}>
          Print payslip
        </button>
        {state.payroll.status === "closed" && canEdit(state.role) && (
          <button className="btn" disabled={!e?.email} title={e?.email ? "" : "No email on file"} onClick={() => call("POST", `payroll/${month}/email`, { empIds: [id] }).then((res) => toast(emailSummary(res.data)))}>
            Email payslip
          </button>
        )}
      </div>
    </Drawer>
  );
}

/* ===================== ERP link ===================== */
export function Erp() {
  const { state, month, call, toast, download } = useHr();
  const c = state?.cfg;
  const f = useFormVals({ erpName: c?.erpName || "", erpCo: c?.erpCo || "", erpUrl: c?.erpUrl || "", erpAuto: !!c?.erpAuto, ...(c?.gl || {}) });
  if (!state || !c) return null;
  if (!state.canSeePay)
    return (
      <>
        <Top title="ERP link" />
        <Empty title="Not available to your role" />
      </>
    );
  const rows = state.payroll.rows;
  const g = c.gl;
  const lines: { account: string; memo: string; debit: number; credit: number }[] = [];
  const add = (account: string, debit: number, credit: number, memo: string) => (Math.round(debit) || Math.round(credit)) && lines.push({ account, debit, credit, memo });
  add(g.sal, sum(rows, (r) => r.basic), 0, "Basic salaries");
  add(g.allow, sum(rows, (r) => r.transport + r.incentive + r.other + r.comm + r.addTx + r.addNo), 0, "Allowances, incentives, commission, adjustments");
  add(g.ot, sum(rows, (r) => r.otPay), 0, "Overtime");
  add(g.site, sum(rows, (r) => r.site), 0, "Site and travel allowances");
  add(g.reimb, sum(rows, (r) => r.reimb), 0, "Travel reimbursements");
  add(g.insEr, sum(rows, (r) => r.insEr), 0, "Employer social insurance");
  add(g.sal, 0, sum(rows, (r) => r.absDed + r.lateDed + r.ded), "Absence, late and other deductions");
  add(g.insPay, 0, sum(rows, (r) => r.insEmp + r.insEr), "Social insurance payable");
  add(g.taxPay, 0, sum(rows, (r) => r.tax), "Income tax payable");
  add(g.net, 0, sum(rows, (r) => r.net), "Net salaries payable");
  const GL_LABEL: Record<string, string> = { sal: "Salaries and wages", allow: "Allowances, incentive, commission", ot: "Overtime", site: "Site and travel allowances", reimb: "Reimbursements", insEr: "Employer social insurance", insPay: "Social insurance payable", taxPay: "Income tax payable", net: "Net salaries payable" };
  const canSet = state.role === "md" || state.role === "hr" || state.role === "finance";
  const save = () => {
    const gl: Record<string, string> = {};
    Object.keys(g).forEach((k) => (gl[k] = f.v[k]));
    return call("POST", "settings", { effectiveMonth: month, values: { erpName: f.v.erpName, erpCo: f.v.erpCo, erpUrl: f.v.erpUrl, erpAuto: !!f.v.erpAuto, gl } }).then(() => toast("ERP link saved"));
  };
  const st = state.payroll.status;
  const erp = state.payroll.erp;
  return (
    <>
      <Top title="ERP link">
        <MonthBar />
      </Top>
      <Panel title="Connection">
        <div className="fg">
          <Inp label="ERP system name" k="erpName" f={f} placeholder="Odoo, Dynamics 365, SAP B1" />
          <Inp label="Company code in the ERP" k="erpCo" f={f} />
          <Inp label="Endpoint for posting the payroll journal (https)" k="erpUrl" f={f} full placeholder="https://erp.example.com/api/payroll/journal" />
          <label className="chk full">
            <input type="checkbox" checked={!!f.v.erpAuto} onChange={(e) => f.set("erpAuto", e.target.checked)} /> Post the journal automatically when a month is closed
          </label>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          The server sends one JSON document per month: the journal lines below plus a per-employee breakdown, with the bearer token configured on the server (HR_ERP_API_TOKEN). The ERP must answer with its journal reference. Phase 1: download the file and import it.
        </div>
      </Panel>
      <Panel title="Account mapping">
        <div className="fg">
          {Object.keys(g).map((k) => (
            <Inp key={k} label={GL_LABEL[k] || k} k={k} f={f} />
          ))}
        </div>
        {canSet && (
          <div className="row2" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={save}>
              Save ERP link
            </button>
            <span className="sub">Applies from {mLabel(month)}; earlier months keep the mapping of their time.</span>
          </div>
        )}
      </Panel>
      <Panel title={`Journal for ${mLabel(month)}`} small={`${st}${erp ? (erp.ok ? ` · posted, reference ${erp.reference}` : ` · last attempt failed: ${erp.error}`) : ""}`}>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Memo</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.account}</td>
                  <td className="sub">{l.memo}</td>
                  <td className="num">{l.debit ? fmt(l.debit) : ""}</td>
                  <td className="num">{l.credit ? fmt(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <b>Total</b>
                </td>
                <td className="num">{fmt(sum(lines, (l) => l.debit))}</td>
                <td className="num">{fmt(sum(lines, (l) => l.credit))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="row2" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={st === "draft" || st === "review"} title={st === "draft" || st === "review" ? "Approve the month first" : ""} onClick={() => call("POST", `payroll/${month}/erp`).then((r) => toast(r.data.ok ? `Posted to the ERP, reference ${r.data.reference}` : `The ERP did not accept it: ${r.data.error}`)).catch(() => undefined)}>
            {erp && !erp.ok ? "Retry post to ERP" : "Post to ERP"}
          </button>
          <button className="btn" onClick={() => download(`payroll/${month}/journal.json`)}>
            Download JSON
          </button>
          <button className="btn" onClick={() => download(`payroll/${month}/journal.csv`)}>
            Download CSV
          </button>
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          Posting is allowed once the MD has approved the month, once per closed version. Debits and credits balance by construction; the accountant maps the accounts above to the ERP chart.
        </div>
      </Panel>
    </>
  );
}

/* ===================== Reports ===================== */
export function Reports() {
  const { state, wantHistory } = useHr();
  useEffect(() => {
    wantHistory(true);
    return () => wantHistory(false);
  }, [wantHistory]);
  if (!state) return null;
  if (!state.canSeePay)
    return (
      <>
        <Top title="Reports" />
        <Empty title="Not available to your role" />
      </>
    );
  const series = state.history;
  const mx = Math.max(1, ...series.map((s) => s.cost));
  const E = state.employees.filter((e) => e.status !== "Left");
  const byD: Record<string, { n: number; g: number }> = {};
  E.forEach((e) => {
    const d = e.dept || "Other";
    byD[d] = byD[d] || { n: 0, g: 0 };
    byD[d].n++;
    byD[d].g += (e.basic || 0) + (e.transport || 0) + (e.incentive || 0) + (e.other || 0) + (e.commission || 0);
  });
  const cur: PayRow[] = state.payroll.rows;
  const cost = sum(cur, (r) => r.cost);
  const today = state.today;
  const diff = (a: string) => Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 864e5);
  return (
    <>
      <Top title="Reports" />
      <Panel title="Employer cost, last 12 months">
        {!series.length ? (
          <div className="sub">Loading...</div>
        ) : (
          <div className="bars">
            {series.map((s) => (
              <div className="bar" key={s.month}>
                <span>
                  {mLabel(s.month).slice(0, 3)} {s.month.slice(2, 4)}
                  {!s.closed && <span className="sub"> draft</span>}
                </span>
                <div className="t">
                  <i style={{ width: `${(s.cost / mx) * 100}%`, background: "var(--primary)" }} title={`Net ${fmt(s.net)}`} />
                </div>
                <span className="v">{fmt(s.cost)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="sub" style={{ marginTop: 6 }}>
          Closed months use the locked register; open months use the live calculation. Hover a bar for the net payout.
        </div>
      </Panel>
      <div className="grid2">
        <Panel title="Fixed pay bill by department">
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Department</th>
                  <th className="num">People</th>
                  <th className="num">Monthly fixed + commission</th>
                  <th className="num">Average</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(byD)
                  .sort((a, b) => byD[b].g - byD[a].g)
                  .map((k) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="num">{byD[k].n}</td>
                      <td className="num">{fmt(byD[k].g)}</td>
                      <td className="num">{fmt(byD[k].g / byD[k].n)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="This month">
          <div className="kpis">
            <Kpi label="Overtime bill" value={fmt(sum(cur, (r) => r.otPay))} sub={mLabel(state.month)} />
            <Kpi label="Travel and site" value={fmt(sum(cur, (r) => r.site + r.reimb))} sub="allowances and reimbursements" />
            <Kpi label="Cost per head" value={cur.length ? fmt(cost / cur.length) : "0"} sub="employer cost" />
            <Kpi label="Turnover" value={state.employees.filter((e) => e.status === "Left" && String(e.end || "").slice(0, 4) === state.month.slice(0, 4)).length} sub="left this year" />
          </div>
        </Panel>
      </div>
      <Panel title="Compliance snapshot">
        <div className="todo2">
          {[
            "Training compliance and document expiries are on the Overview.",
            `Employees without social insurance registration recorded: ${E.filter((e) => e.insured !== false && !(e.docs?.si && e.docs.si.st === "ok")).length}.`,
            `Fixed-term contracts ending within 60 days: ${E.filter((e) => e.cend && diff(e.cend) >= 0 && diff(e.cend) <= 60).length} (renew in writing before expiry or the contract becomes indefinite under Law 14 of 2025).`,
            `Headcount is ${E.length}. At 10 or more, the internal work regulation must be filed with the labour office (Art. 137).`,
          ].map((x) => (
            <div className="sub" key={x}>
              &bull; {x}
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
