import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { ATT, ATTN, canDecideHr, canEdit, DayRec, DN, dAdd, fmt, mLabel, pad, r1, sum, useHr, canActOn } from "./hr-context";
import RecordFiles from "./record-files";
import { ArmedButton, Chk, Empty, Inp, Kpi, Modal, MonthBar, Panel, Pill, Sel, statusPill, Top, Txt, useFormVals, useModal } from "./ui";
import { useEmp } from "./views-people";

// Reservia HR Portal - Attendance (daily sheet and month grid), Timesheets, Leave balances, Site
// visits and Expense claims: the reference prototype's vAtt, vTs, vLeave, vVisit and vExp.

type Translate = (en: string, ar: string) => string;

// Display-only Arabic labels for the attendance type codes (hr-context's ATT/ATTN); the single
// letter code itself is the actual stored value and stays unchanged everywhere.
const ATT_AR: Record<string, string> = { P: "حاضر", V: "زيارة ميدانية", A: "غائب (بدون أجر)", L: "إجازة سنوية", S: "إجازة مرضية", U: "إجازة بدون مرتب", W: "عمل في يوم راحة", H: "عمل في عطلة رسمية" };
const attLabel = (k: string, translate: Translate) => translate(ATTN[k]?.n || k, ATT_AR[k] || k);
const VISIT_STATUS_AR: Record<string, string> = { Planned: "مخطط لها", Done: "تمت", Cancelled: "أُلغيت" };

function otText(d: DayRec, translate: Translate) {
  const p: string[] = [];
  if (d.ot - d.otN > 0) p.push(translate(`${r1(d.ot - d.otN)}h day`, `${r1(d.ot - d.otN)}س نهار`));
  if (d.otN > 0) p.push(translate(`${r1(d.otN)}h night`, `${r1(d.otN)}س ليل`));
  if (d.sp > 0) p.push(translate(`${r1(d.sp)}h ${d.spT === "hol" ? "holiday" : d.spT === "fri" ? "Friday" : "Saturday"}`, `${r1(d.sp)}س ${d.spT === "hol" ? "عطلة" : d.spT === "fri" ? "جمعة" : "سبت"}`));
  return p.join(", ");
}
const dayTag = (d: DayRec, translate: Translate) => (d.hol ? <Pill c="info">{translate("Public holiday", "عطلة رسمية")}</Pill> : d.rest ? <Pill>{translate("Rest day", "يوم راحة")}</Pill> : null);

function StatusSelect({ value, onChange, disabled, testid }: { value: string; onChange: (v: string) => void; disabled?: boolean; testid?: string }) {
  const { translate } = useLanguage();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid={testid}>
      <option value="">&nbsp;</option>
      {ATT.map((a) => (
        <option key={a.k} value={a.k}>
          {a.k} {attLabel(a.k, translate)}
        </option>
      ))}
    </select>
  );
}

const lockedBanner = (st: string, translate: Translate) =>
  st === "closed"
    ? translate("This month is closed in Payroll. Reopen it there to change attendance.", "هذا الشهر مغلق في الرواتب. أعد فتحه من هناك لتغيير الحضور.")
    : st === "review" || st === "approved"
    ? translate("This month's payroll is under review. Send it back to HR to change attendance.", "رواتب هذا الشهر قيد المراجعة. أعدها إلى الموارد البشرية لتغيير الحضور.")
    : "";

/* ===================== Attendance ===================== */
export function Attendance() {
  const { state, month, setMonth, call, toast } = useHr();
  const { translate } = useLanguage();
  const { go } = useModal();
  const [mode, setMode] = useState<"day" | "grid">("day");
  const [day, setDay] = useState(() => (state && state.today.slice(0, 7) === month ? state.today : `${month}-01`));
  const [rows, setRows] = useState<Record<string, { s: string; in: string; out: string; n: string }>>({});
  // HR Portal D12: bulk "mark present" for a date range and selected employees.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFrom, setBulkFrom] = useState("");
  const [bulkTo, setBulkTo] = useState("");
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
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
    <Top title={translate("Attendance", "الحضور")}>
      <div className="seg">
        <button className="btn sm" aria-pressed={mode === "day"} onClick={() => setMode("day")}>
          {translate("Daily sheet", "كشف يومي")}
        </button>
        <button className="btn sm" aria-pressed={mode === "grid"} onClick={() => setMode("grid")}>
          {translate("Month grid", "شبكة الشهر")}
        </button>
      </div>
    </Top>
  );
  if (!state.employees.length)
    return (
      <>
        {head}
        <Empty title={translate("No employees yet", "لا يوجد موظفون بعد")} text={translate("Add people first, then record attendance here.", "أضف الموظفين أولاً، ثم سجّل الحضور هنا.")} />
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
              <span className={`ga ${a.c} s`}>{a.k}</span> {attLabel(a.k, translate)} &nbsp;{" "}
            </span>
          ))}
          <span className="ga miss s">?</span> {translate("Not recorded", "غير مسجَّل")}
        </div>
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>{translate("Employee", "الموظف")}</th>
                {Array.from({ length: dim }, (_, i) => (
                  <th key={i} className={`dn${firstDays[i]?.rest ? " off" : ""}`} title={DN[firstDays[i]?.dow ?? 0]}>
                    {i + 1}
                  </th>
                ))}
                <th className="num">{translate("Pres.", "حضور")}</th>
                <th className="num">{translate("Abs.", "غياب")}</th>
                <th className="num">{translate("OT h", "س إضافي")}</th>
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
                          <button className={`ga ${ATTN[d.s].c}`} title={attLabel(d.s, translate)} onClick={() => (setDay(d.date), setMode("day"))}>
                            {d.s}
                          </button>
                        ) : d.unrec ? (
                          <button className="ga miss" title={translate("Not recorded", "غير مسجَّل")} onClick={() => (setDay(d.date), setMode("day"))}>
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
    if (!changed.length) return toast(translate("Nothing changed", "لم يتغير شيء"));
    await call("POST", "attendance/day", { date: day, rows: changed });
    toast(translate(`Saved ${changed.length} row${changed.length > 1 ? "s" : ""}`, `تم حفظ ${changed.length} صف`));
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
    toast(translate("Review and press Save day", "راجع ثم اضغط حفظ اليوم"));
  };
  return (
    <>
      {head}
      <div className="row2">
        <button className="btn sm" aria-label={translate("Previous day", "اليوم السابق")} onClick={() => move(-1)}>
          &lsaquo;
        </button>
        <input type="date" value={day} onChange={(e) => e.target.value && (setDay(e.target.value), e.target.value.slice(0, 7) !== month && setMonth(e.target.value.slice(0, 7)))} data-testid="att-day" />
        <button className="btn sm" aria-label={translate("Next day", "اليوم التالي")} onClick={() => move(1)}>
          &rsaquo;
        </button>
        <b>{DN[dow]}</b>
        {anyDay?.hol ? <Pill c="info">{translate("Public holiday", "عطلة رسمية")}</Pill> : off ? <Pill>{translate("Rest day", "يوم راحة")}</Pill> : null}
        {day === state.today && <Pill c="good">{translate("Today", "اليوم")}</Pill>}
        {edit && (
          <span style={{ marginLeft: "auto" }} className="row2">
            <button className="btn" onClick={fillDay} disabled={lk}>
              {translate("Mark blanks present", "تعليم الفراغات كحضور")}
            </button>
            <button className="btn" onClick={() => setBulkOpen((o) => !o)} disabled={lk} data-testid="att-bulk-toggle">
              {translate("Bulk mark present…", "تعليم جماعي كحضور…")}
            </button>
            <button className="btn primary" onClick={saveDay} disabled={lk} data-testid="att-save-day">
              {translate("Save day", "حفظ اليوم")}
            </button>
          </span>
        )}
      </div>
      {lk && <div className="banner">{lockedBanner(st, translate)}</div>}
      {edit && bulkOpen && (
        <div className="sect" data-testid="att-bulk-panel">
          <h4>{translate("Bulk mark present", "تعليم جماعي كحضور")}</h4>
          <div className="sub">{translate("Marks every genuinely blank working day present, for the people chosen below, across the date range. Weekends, holidays, already-recorded days and approved timesheets are skipped automatically.", "يُعلِّم كل يوم عمل فارغ فعليًا كحضور، للأشخاص المحددين أدناه، خلال الفترة الزمنية. يتم تجاوز عطلات نهاية الأسبوع والعطلات الرسمية والأيام المسجَّلة سابقًا وسجلات الدوام المعتمدة تلقائيًا.")}</div>
          <div className="row2" style={{ marginTop: 6 }}>
            <label>
              {translate("From", "من")}
              <input type="date" value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} />
            </label>
            <label>
              {translate("To", "إلى")}
              <input type="date" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} />
            </label>
          </div>
          <div className="fg" style={{ marginTop: 6 }}>
            {state.employees
              .filter((e) => e.status !== "Left")
              .map((e) => (
                <label key={e._id} className="chk">
                  <input
                    type="checkbox"
                    checked={bulkIds.includes(e._id)}
                    onChange={(ev) => setBulkIds((o) => (ev.target.checked ? [...o, e._id] : o.filter((x) => x !== e._id)))}
                  />{" "}
                  {e.name}
                </label>
              ))}
          </div>
          <div className="row2" style={{ marginTop: 6 }}>
            <button
              className="btn"
              onClick={() => setBulkIds(state.employees.filter((e) => e.status !== "Left").map((e) => e._id))}
            >
              {translate("Select all", "تحديد الكل")}
            </button>
            <button
              className="btn primary"
              disabled={bulkRunning || !bulkFrom || !bulkTo || !bulkIds.length}
              onClick={async () => {
                setBulkRunning(true);
                try {
                  const r = await call("POST", "attendance/bulk-fill", { employeeIds: bulkIds, from: bulkFrom, to: bulkTo });
                  const { filled, skipped } = r.data as { filled: number; skipped: { employeeId: string; month: string; reason: string }[] };
                  toast(
                    skipped.length
                      ? translate(
                          `Marked ${filled} day(s) present. Skipped ${skipped.length}: ${skipped
                            .slice(0, 3)
                            .map((s) => `${byId[s.employeeId]?.name || s.employeeId} (${s.reason})`)
                            .join("; ")}${skipped.length > 3 ? "…" : ""}`,
                          `تم تعليم ${filled} يوم كحضور. تم تجاوز ${skipped.length}: ${skipped
                            .slice(0, 3)
                            .map((s) => `${byId[s.employeeId]?.name || s.employeeId} (${s.reason})`)
                            .join("؛ ")}${skipped.length > 3 ? "…" : ""}`
                        )
                      : translate(`Marked ${filled} day(s) present. Nothing skipped.`, `تم تعليم ${filled} يوم كحضور. لم يتم تجاوز أي يوم.`)
                  );
                  setBulkOpen(false);
                } finally {
                  setBulkRunning(false);
                }
              }}
            >
              {translate("Run", "تشغيل")}
            </button>
          </div>
        </div>
      )}
      {!E2.length ? (
        <Empty title={translate("Nobody on the payroll for this date", "لا يوجد أحد في كشف الرواتب لهذا التاريخ")} />
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>{translate("Employee", "الموظف")}</th>
                <th>{translate("Status", "الحالة")}</th>
                <th>{translate("In", "دخول")}</th>
                <th>{translate("Out", "خروج")}</th>
                <th>{translate("Hours", "الساعات")}</th>
                <th>{translate("Overtime", "العمل الإضافي")}</th>
                <th>{translate("Note", "ملاحظة")}</th>
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
                        {state.time[id].approval ? translate(" · timesheet approved", " · سجل الدوام معتمد") : ""}
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
                      {otText(d, translate)}
                      {d.late ? <span className="warnline"> {translate(`Late ${d.late} min`, `تأخير ${d.late} دقيقة`)}</span> : null}
                    </td>
                    <td>
                      <input type="text" value={r.n} placeholder={translate("Optional", "اختياري")} onChange={(e) => set("n", e.target.value)} disabled={dis} />
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
          {translate("Timesheets", "سجلات الدوام")}
        </button>{" "}
        {translate("approve each person's month; approval locks it until reopened.", "اعتماد شهر كل شخص؛ الاعتماد يقفله حتى تتم إعادة فتحه.")}
      </div>
    </>
  );
}

/* ===================== Timesheets ===================== */
export function Timesheets({ initialEmp }: { initialEmp?: string }) {
  const { state, month, call, toast } = useHr();
  const { translate } = useLanguage();
  const [emp, setEmp] = useState(initialEmp || "");
  const [reopenReason, setReopenReason] = useState("");
  if (!state) return null;
  const byId = Object.fromEntries(state.employees.map((e) => [e._id, e]));
  const E = state.inMonth;
  const head = (
    <Top title={translate("Timesheets", "سجلات الدوام")}>
      <MonthBar />
    </Top>
  );
  if (!E.length)
    return (
      <>
        {head}
        <Empty title={translate("No employees on the payroll this month", "لا يوجد موظفون في كشف الرواتب هذا الشهر")} />
      </>
    );
  const id = emp && E.includes(emp) ? emp : E[0];
  const t = state.time[id];
  const st = state.payroll.status;
  const lk = st !== "draft";
  const ap = t.approval;
  const edit = canEdit(state.role);
  const canDecide = canDecideHr(state.role);
  const dis = lk || !!ap || !(edit || canActOn(state, id));
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
          {translate("Employee", "الموظف")}
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
              <Pill c="good">{translate(`Approved ${String(ap.at).slice(0, 10)}`, `معتمد بتاريخ ${String(ap.at).slice(0, 10)}`)}</Pill>
              {canDecide && (
                <>
                  <input placeholder={translate("Reason for reopening", "سبب إعادة الفتح")} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} style={{ width: 200 }} data-testid="ts-reopen-reason" />
                  <button
                    className="btn"
                    disabled={st === "closed" || !reopenReason.trim()}
                    onClick={() =>
                      call("POST", `timesheets/${id}/${month}/reopen`, { reason: reopenReason }).then(() => {
                        toast(translate("Timesheet reopened", "أُعيد فتح سجل الدوام"));
                        setReopenReason("");
                      })
                    }
                  >
                    {translate("Reopen", "إعادة فتح")}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {edit && (
                <button className="btn" disabled={lk} onClick={() => call("POST", `attendance/${id}/${month}/fill`).then((r) => toast(r.data.filled ? translate(`Marked ${r.data.filled} days present`, `تم تعليم ${r.data.filled} يوم كحضور`) : translate("No blank working days", "لا توجد أيام عمل فارغة")))}>
                  {translate("Mark blank working days present", "تعليم أيام العمل الفارغة كحضور")}
                </button>
              )}
              {canDecide && (
                <button className="btn primary" disabled={lk} data-testid="ts-approve" onClick={() => call("POST", `timesheets/${id}/${month}/approve`).then(() => toast(translate("Timesheet approved", "تم اعتماد سجل الدوام")))}>
                  {translate("Approve timesheet", "اعتماد سجل الدوام")}
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {lk && <div className="banner">{lockedBanner(st, translate)}</div>}
      {/* HR Portal D11: visible on the record itself, not only in the audit log. Shown whenever
          the timesheet is currently un-approved (waiting in Approvals) because of a reopen. */}
      {!ap && t.lastReopen && (
        <div className="banner info">
          {translate(`Reopened by ${t.lastReopen.byName} on ${String(t.lastReopen.at).slice(0, 10)}: ${t.lastReopen.reason}`, `أُعيد فتحه من قِبل ${t.lastReopen.byName} بتاريخ ${String(t.lastReopen.at).slice(0, 10)}: ${t.lastReopen.reason}`)}
        </div>
      )}
      <div className="kpis">
        <Kpi label={translate("Days present", "أيام الحضور")} value={t.t.present} sub={translate(`of ${t.t.emp} calendar days`, `من ${t.t.emp} يوم تقويمي`)} />
        <Kpi label={translate("Absent or unpaid", "غياب أو بدون أجر")} value={t.t.absent + t.t.uleave} sub={translate(`${t.t.leave} annual, ${t.t.sick} sick leave days`, `${t.t.leave} سنوية، ${t.t.sick} يوم إجازة مرضية`)} />
        <Kpi label={translate("Overtime hours", "ساعات العمل الإضافي")} value={r1(t.otHours)} sub={translate(`${r1(t.otD)} day, ${r1(t.otN)} night, ${r1(t.otR + t.otH)} rest or holiday`, `${r1(t.otD)} نهار، ${r1(t.otN)} ليل، ${r1(t.otR + t.otH)} راحة أو عطلة`)} />
        <Kpi label={translate("Late minutes", "دقائق التأخير")} value={t.t.late} sub={state.cfg.lateDeduct ? translate("Deducted", "مخصومة") : translate("Tracked, not deducted", "مُتتبَّعة، غير مخصومة")} />
        <Kpi label={translate("Not recorded", "غير مسجَّل")} value={t.t.unrec} sub={translate("working days", "يوم عمل")} alert={!!t.t.unrec} />
      </div>
      <Panel title={translate("Attendance documents", "مستندات الحضور")}>
        <RecordFiles
          key={`${id}-${month}`}
          listUrl={`attendance/${id}/${month}/files`}
          uploadUrl={`attendance/${id}/${month}/files`}
          canUpload={canActOn(state, id)}
          title={translate(`Sick notes, signed timesheets and other documents for ${mLabel(month)}`, `الإجازات المرضية وسجلات الدوام الموقعة ومستندات أخرى لشهر ${mLabel(month)}`)}
          emptyText={translate("No documents for this month.", "لا توجد مستندات لهذا الشهر.")}
          testId="attendance-files"
        />
      </Panel>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>{translate("Date", "التاريخ")}</th>
              <th></th>
              <th>{translate("Status", "الحالة")}</th>
              <th>{translate("In", "دخول")}</th>
              <th>{translate("Out", "خروج")}</th>
              <th className="num">{translate("Hours", "الساعات")}</th>
              <th>{translate("Overtime", "العمل الإضافي")}</th>
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
                    {translate("Not employed", "غير مُعيَّن بعد")}
                  </td>
                </tr>
              ) : (
                <tr key={d.date} className={d.rest || d.hol ? "off" : ""}>
                  <td className="mono">
                    {pad(i + 1)} {DN[d.dow]}
                  </td>
                  <td>{dayTag(d, translate)}</td>
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
                    {otText(d, translate)}
                    {d.late ? <span className="warnline"> {translate(`Late ${d.late}`, `تأخير ${d.late}`)}</span> : null}
                    {d.unrec ? <span className="warnline">{translate("Not recorded", "غير مسجَّل")}</span> : null}
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
  const { translate } = useLanguage();
  const { open } = useModal();
  if (!state) return null;
  const yr = state.month.slice(0, 4);
  const byId = Object.fromEntries(state.employees.map((e) => [e._id, e]));
  const rows = state.leave.filter((r) => byId[r.empId]);
  return (
    <>
      <Top title={translate(`Leave balances ${yr}`, `أرصدة الإجازات ${yr}`)}>
        <MonthBar />
        {canEdit(state.role) && (
          <button className="btn" onClick={() => download(`exports/leave.csv?month=${state.month}`)}>
            {translate("Export CSV", "تصدير CSV")}
          </button>
        )}
      </Top>
      {!rows.length ? (
        <Empty title={translate("No employees yet", "لا يوجد موظفون بعد")} />
      ) : (
        <>
          <div className="kpis">
            <Kpi label={translate("Entitlement", "المستحق")} value={sum(rows, (r) => r.ent)} sub={translate("working days, all staff", "يوم عمل، كل الموظفين")} />
            <Kpi label={translate("Taken", "المُستخدَم")} value={sum(rows, (r) => r.used)} sub={translate("annual and casual", "سنوية وعارضة")} />
            <Kpi label={translate("Pending requests", "طلبات في الانتظار")} value={sum(rows, (r) => r.pend)} sub={translate("days", "يوم")} />
            <Kpi label={translate("Sick days", "أيام مرضية")} value={sum(rows, (r) => r.sick)} sub={translate("recorded in attendance", "مسجَّلة في الحضور")} />
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{translate("Employee", "الموظف")}</th>
                  <th className="num">{translate("Entitlement", "المستحق")}</th>
                  <th className="num">{translate("Taken", "المُستخدَم")}</th>
                  <th className="num">{translate("of which casual", "منها عارضة")}</th>
                  <th className="num">{translate("Pending", "في الانتظار")}</th>
                  <th className="num">{translate("Remaining", "المتبقي")}</th>
                  <th className="num">{translate("Sick", "مرضية")}</th>
                  <th className="num">{translate("Unpaid or absent", "بدون أجر أو غياب")}</th>
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
                          {e.hire > `${yr}-01-01` ? translate(` · joined ${e.hire}, pro rata on the calendar days since joining`, ` · التحق في ${e.hire}، بالتناسب مع الأيام التقويمية منذ الالتحاق`) : ""}
                          {/* HR Portal D7: no separate probation leave rule exists yet (MD decision
                              needed) - a probationary employee accrues the same pro-rata entitlement
                              as anyone else until one is set, shown here rather than left silent. */}
                          {e.status === "Probation" ? translate(" · on probation, no separate leave rule yet", " · تحت الاختبار، لا توجد قاعدة إجازة مستقلة بعد") : ""}
                        </div>
                      </td>
                      <td className="num">{r.ent}</td>
                      <td className="num">{r.used}</td>
                      <td className="num">
                        {r.cas}
                        {r.cas > 7 && <span className="warnline"> {translate("over 7", "أكثر من 7")}</span>}
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
                            {translate("Request leave", "طلب إجازة")}
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
        {translate(
          `Entitlement is ${state.cfg.annualDays} working days a year, pro rata in the joining year. Law 14 of 2025 gives 15 days in year one and 21 from year two; the company term is more generous and counts from the approved HR-F01 forms. Casual leave is capped at 7 days a year, 2 at a time.`,
          `المستحق هو ${state.cfg.annualDays} يوم عمل سنويًا، بالتناسب في سنة الالتحاق. يمنح قانون 14 لسنة 2025 15 يومًا في السنة الأولى و21 من السنة الثانية؛ وشرط الشركة أكثر سخاءً ويُحسب من نماذج HR-F01 المعتمدة. تُحدَّد الإجازة العارضة بـ7 أيام سنويًا، يومين في المرة.`
        )}
      </div>
    </>
  );
}

/* ===================== Site visits ===================== */
export function Visits() {
  const { state } = useHr();
  const { translate } = useLanguage();
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
      <Top title={translate("Site visits", "الزيارات الميدانية")}>
        <MonthBar />
        {(canEdit(state.role) || !!state.me) && (
          <button className="btn primary" data-testid="hr-new-visit" onClick={() => open({ type: "vis", empId: canEdit(state.role) ? undefined : state.me || undefined })}>
            {translate("Log a visit", "تسجيل زيارة")}
          </button>
        )}
      </Top>
      <div className="kpis">
        <Kpi label={translate("Visits done", "زيارات مكتملة")} value={done.length} sub={translate(`${V.filter((v) => v.status === "Planned").length} planned`, `${V.filter((v) => v.status === "Planned").length} مخطط لها`)} />
        <Kpi label={translate("Greater Cairo", "القاهرة الكبرى")} value={cairo} sub={translate("visits", "زيارات")} />
        <Kpi label={translate("Other cities", "مدن أخرى")} value={done.length - cairo} sub={translate("visits", "زيارات")} />
        <Kpi label={translate("Site-days", "أيام الموقع")} value={sum(done, (v) => v.days || 1)} sub={translate(`${sum(done, (v) => v.nights || 0)} nights away`, `${sum(done, (v) => v.nights || 0)} ليلة خارج المقر`)} />
        {state.canSeePay && <Kpi label={translate("Allowances", "البدلات")} value={fmt(sum(done, total))} sub={translate("EGP, paid with payroll", "جنيه، تُدفع مع الرواتب")} />}
      </div>
      {!V.length ? (
        <Empty title={translate(`No visits logged for ${mLabel(state.month)}`, `لا توجد زيارات مسجَّلة لشهر ${mLabel(state.month)}`)} text={translate("Log each visit with the city, client site, days and nights. Allowances follow the city rates in Settings and flow into the monthly payout.", "سجّل كل زيارة بالمدينة وموقع العميل وعدد الأيام والليالي. تتبع البدلات معدلات المدن في الإعدادات وتدخل في المستحقات الشهرية.")} />
      ) : (
        <>
          {state.canSeePay && (
            <div className="grid2">
              <Panel title={translate("Allowance by city", "البدل حسب المدينة")}>
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
                  <th>{translate("Date", "التاريخ")}</th>
                  <th>{translate("Employee", "الموظف")}</th>
                  <th>{translate("City", "المدينة")}</th>
                  <th>{translate("Client or site", "العميل أو الموقع")}</th>
                  <th>{translate("Purpose", "الغرض")}</th>
                  <th className="num">{translate("Days", "الأيام")}</th>
                  <th className="num">{translate("Nights", "الليالي")}</th>
                  {state.canSeePay && <th className="num">{translate("Allowance", "البدل")}</th>}
                  <th>{translate("Status", "الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {V.map((v) => (
                  <tr key={v._id} onClick={() => open({ type: "vis", id: v._id })}>
                    <td className="mono">{v.date}</td>
                    <td>{byId[v.employee]?.name || translate("(removed)", "(محذوف)")}</td>
                    <td>
                      {v.city}
                      <div className="sub">{v.zone}</div>
                    </td>
                    <td>
                      {v.site} {v.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                    </td>
                    <td>{v.purpose}</td>
                    <td className="num">{v.days || 1}</td>
                    <td className="num">{v.nights || 0}</td>
                    {state.canSeePay && <td className="num">{v.status === "Done" ? fmt(total(v)) : <span className="sub">{fmt(total(v))}</span>}</td>}
                    <td>
                      <Pill c={v.status === "Done" ? "good" : v.status === "Planned" ? "info" : ""}>{translate(v.status, VISIT_STATUS_AR[v.status] || v.status)}</Pill>
                      {v.status === "Done" && !v.report && (
                        <>
                          {" "}
                          <Pill c="warn">{translate("Report due", "التقرير مستحق")}</Pill>
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
  const { translate } = useLanguage();
  const { close } = useModal();
  const v = id ? state?.visits.find((x) => x._id === id) : null;
  const f = useFormVals(v ? { ...v, empId: v.employee } : { date: state?.today, city: "Cairo", days: 1, nights: 0, status: "Planned", purpose: "Site survey", empId: empId || "" });
  if (!state || (id && !v)) return null;
  // MD/HR for anyone; any other role for their own visits only (the API enforces the same).
  const edit = canActOn(state, v ? v.employee : f.v.empId || state.me);
  const emps = state.employees.filter((e) => e.status !== "Left" && (canEdit(state.role) || e._id === state.me)).map((e) => [e._id, e.name] as [string, string]);
  const save = () =>
    call(id ? "PATCH" : "POST", id ? `visits/${id}` : "visits", { ...f.v, empId: canEdit(state.role) ? f.v.empId : state.me }).then((r) => {
      toast(r.data.attendanceDays ? translate(`Saved. ${r.data.attendanceDays} days recorded as Site visit in Attendance`, `تم الحفظ. تم تسجيل ${r.data.attendanceDays} يوم كزيارة ميدانية في الحضور`) : translate("Saved", "تم الحفظ"));
      close();
    });
  return (
    <Modal title={id ? translate("Site visit", "زيارة ميدانية") : translate("Log a site visit", "تسجيل زيارة ميدانية")} onClose={close}>
      <div className="fg">
        <Sel label={translate("Employee", "الموظف")} k="empId" f={f} opts={[["", translate("Choose", "اختر")], ...emps]} />
        <Inp label={translate("First day", "أول يوم")} k="date" f={f} type="date" />
        <Sel label={translate("City", "المدينة")} k="city" f={f} opts={state.cfg.cities.map((c) => [c.n, `${c.n} (${c.z})`] as [string, string])} />
        <Inp label={translate("Client or site", "العميل أو الموقع")} k="site" f={f} />
        <Sel label={translate("Purpose", "الغرض")} k="purpose" f={f} opts={state.lists.PURPOSES} />
        <Sel label={translate("Status", "الحالة")} k="status" f={f} opts={state.lists.VISIT_STATUS.map((s) => [s, translate(s, VISIT_STATUS_AR[s] || s)] as [string, string])} />
        <Inp label={translate("Days on site", "عدد الأيام بالموقع")} k="days" f={f} type="number" min={1} />
        <Inp label={translate("Nights away", "عدد الليالي خارج المقر")} k="nights" f={f} type="number" min={0} />
        <Inp label={translate("Transport paid by employee (EGP, on receipts)", "النقل الذي دفعه الموظف (جنيه، بإيصالات)")} k="transport" f={f} type="number" />
        <Inp label={translate("Accommodation paid by employee (EGP, on receipts)", "الإقامة التي دفعها الموظف (جنيه، بإيصالات)")} k="accom" f={f} type="number" />
        <Inp label={translate("Meals paid by employee (EGP, on receipts)", "الوجبات التي دفعها الموظف (جنيه، بإيصالات)")} k="meals" f={f} type="number" />
        <Inp label={translate("CRM lead or project reference", "رقم العميل المحتمل أو مرجع المشروع")} k="ref" f={f} />
        <Chk label={translate("Client or hotel provides all meals (no per diem)", "العميل أو الفندق يوفر كل الوجبات (بدون بدل يومي)")} k="mealsProvided" f={f} full />
        <Txt label={translate("Notes", "ملاحظات")} k="notes" f={f} />
        <Txt label={translate("Visit report (HR-F04, due within 24 hours of return)", "تقرير الزيارة (HR-F04، يُسلَّم خلال 24 ساعة من العودة)")} k="report" f={f} placeholder={translate("What was done, findings, photos taken, next steps", "ما تم تنفيذه، النتائج، الصور المأخوذة، الخطوات التالية")} />
      </div>
      {v?.pay && (
        <div className="sub">
          {translate(
            `This visit pays ${fmt(v.pay.allow + v.pay.pd)} EGP allowance${v.pay.pd ? " and per diem" : ""} (${v.gc ? "Greater Cairo day" : "outside Greater Cairo"}) plus ${fmt(v.pay.reimb)} reimbursed.`,
            `تدفع هذه الزيارة بدل ${fmt(v.pay.allow + v.pay.pd)} جنيه${v.pay.pd ? " وبدل يومي" : ""} (${v.gc ? "يوم داخل القاهرة الكبرى" : "خارج القاهرة الكبرى"}) بالإضافة إلى ${fmt(v.pay.reimb)} مُستردَّة.`
          )}
        </div>
      )}
      <div className="sub">{translate("Only visits marked Done are paid. Marking a visit Done also records the working days as Site visit in Attendance.", "تُدفع فقط الزيارات المُعلَّمة كمنتهية. تعليم زيارة كمنتهية يُسجِّل أيضًا أيام العمل كزيارة ميدانية في الحضور.")}</div>
      {id && v && (
        <RecordFiles
          listUrl={`files/visit/${id}`}
          uploadUrl={`files/visit/${id}`}
          canUpload={canActOn(state, v.employee)}
          title={translate("Visit documents (report, photos)", "مستندات الزيارة (التقرير، الصور)")}
          emptyText={translate("No documents on this visit yet.", "لا توجد مستندات لهذه الزيارة بعد.")}
          testId="visit-files"
        />
      )}
      <div className="row2">
        {edit && (
          <button className="btn primary" data-testid="hr-save-visit" onClick={save}>
            {translate("Save", "حفظ")}
          </button>
        )}
        {id && (
          <button className="btn" onClick={() => openPdf(`sheets/report?id=${id}`)}>
            {translate("Print visit report", "طباعة تقرير الزيارة")}
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton label={translate("Delete", "حذف")} armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")} onConfirm={() => call("DELETE", `visits/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}

/* ===================== Expense claims ===================== */
export function Expenses() {
  const { state } = useHr();
  const { translate } = useLanguage();
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
      <Top title={translate("Expense claims", "المصروفات")}>
        <MonthBar />
        {(canEdit(state.role) || !!state.me) && (
          <button className="btn primary" data-testid="hr-new-exp" onClick={() => open({ type: "exp", empId: canEdit(state.role) ? undefined : state.me || undefined })}>
            {translate("New claim", "مطالبة جديدة")}
          </button>
        )}
      </Top>
      <div className="kpis">
        <Kpi label={translate("Approved", "معتمدة")} value={fmt(sum(ap, (x) => x.amount))} sub={translate(`${ap.length} claims, paid with ${mLabel(state.month)} payroll`, `${ap.length} مطالبة، تُدفع مع رواتب ${mLabel(state.month)}`)} />
        <Kpi label={translate("Waiting", "في الانتظار")} value={fmt(sum(pd, (x) => x.amount))} sub={translate(`${pd.length} claims`, `${pd.length} مطالبة`)} alert={!!pd.length} />
        <Kpi label={translate("No receipt", "بدون إيصال")} value={X.filter((x) => !x.receipt).length} sub={translate("claims to chase", "مطالبات تحتاج متابعة")} />
      </div>
      {!X.length ? (
        <Empty title={translate(`No claims for ${mLabel(state.month)}`, `لا توجد مطالبات لشهر ${mLabel(state.month)}`)} text={translate("Taxi, fuel, accommodation, meals or materials paid by an employee. Approved claims are reimbursed in the monthly payout and are not taxed.", "تاكسي، وقود، إقامة، وجبات أو مواد دفعها موظف. تُسترد المطالبات المعتمدة ضمن المستحقات الشهرية ولا تخضع للضريبة.")} />
      ) : (
        <>
          <div className="grid2">
            <Panel title={translate("Approved by type", "المعتمد حسب النوع")}>
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
                  <th>{translate("Date", "التاريخ")}</th>
                  <th>{translate("Employee", "الموظف")}</th>
                  <th>{translate("Type", "النوع")}</th>
                  <th>{translate("Description", "الوصف")}</th>
                  <th className="num">{translate("Amount", "المبلغ")}</th>
                  <th>{translate("Receipt", "الإيصال")}</th>
                  <th>{translate("Status", "الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {X.map((x) => (
                  <tr key={x._id} onClick={() => open({ type: "exp", id: x._id })}>
                    <td className="mono">{x.date}</td>
                    <td>{byId[x.employee]?.name || translate("(removed)", "(محذوف)")}</td>
                    <td>{x.type}</td>
                    <td className="sub">
                      {x.desc} {x.example && <Pill c="info">{translate("Example", "مثال")}</Pill>}
                    </td>
                    <td className="num">{fmt(x.amount)}</td>
                    <td>{x.receipt ? <Pill c="good">{translate("Yes", "نعم")}</Pill> : x.receiptOverride ? <Pill c="info">{translate("MD override", "تجاوز من المدير العام")}</Pill> : <Pill c="warn">{translate("No", "لا")}</Pill>}</td>
                    <td>{statusPill(x.status, translate)}</td>
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
  const { state, call, toast, reload } = useHr();
  const { translate } = useLanguage();
  const { close } = useModal();
  const x = id ? state?.expenses.find((e) => e._id === id) : null;
  const f = useFormVals(x ? { ...x, empId: x.employee, receiptOverride: !!x.receiptOverride } : { date: state?.today, type: state?.lists.EXPENSE_TYPES[0], status: "Pending", receipt: true, payMonth: state?.month, empId: empId || "" });
  if (!state || (id && !x)) return null;
  // MD/HR for anyone; any other role for their own claims only (the API enforces the same).
  const edit = canActOn(state, x ? x.employee : f.v.empId || state.me);
  const canDecide = canDecideHr(state.role) && (!x || x.employee !== state.me || canEdit(state.role));
  const emps = state.employees.filter((e) => e.status !== "Left" && (canEdit(state.role) || e._id === state.me)).map((e) => [e._id, `${e.name} (${e.code})`] as [string, string]);
  const save = async () => {
    // `receipt` is set by the server only when a file is uploaded - never sent from the form.
    const { receipt: _r, ...body } = f.v;
    void _r;
    if (edit && (!id || x?.status === "Pending" || state.role === "md")) await call(id ? "PATCH" : "POST", id ? `expenses/${id}` : "expenses", { ...body, empId: canEdit(state.role) ? body.empId : state.me });
    if (id && canDecide && f.v.status !== x?.status) await call("POST", `expenses/${id}/decide`, { status: f.v.status, note: f.v.note, payMonth: f.v.payMonth, receiptOverride: !!f.v.receiptOverride });
    toast(translate("Saved", "تم الحفظ"));
    close();
  };
  return (
    <Modal title={id ? translate("Expense claim", "مطالبة مصروفات") : translate("New expense claim", "مطالبة مصروفات جديدة")} onClose={close}>
      <div className="fg">
        <Sel label={translate("Employee", "الموظف")} k="empId" f={f} opts={[["", translate("Choose", "اختر")], ...emps]} disabled={!edit} />
        <Inp label={translate("Date paid", "تاريخ الدفع")} k="date" f={f} type="date" disabled={!edit} />
        <Sel label={translate("Type", "النوع")} k="type" f={f} opts={state.lists.EXPENSE_TYPES} disabled={!edit} />
        <Inp label={translate("Amount (EGP)", "المبلغ (جنيه)")} k="amount" f={f} type="number" disabled={!edit} />
        <Inp label={translate("Reimburse with payroll of", "يُرد مع رواتب شهر")} k="payMonth" f={f} type="month" />
        <Inp label={translate("Project or client", "المشروع أو العميل")} k="ref" f={f} disabled={!edit} />
        <Inp label={translate("Description", "الوصف")} k="desc" f={f} full disabled={!edit} />
      </div>
      {id && x ? (
        <RecordFiles
          listUrl={`files/expense/${id}`}
          uploadUrl={`files/expense/${id}`}
          canUpload={canActOn(state, x.employee) && x.status === "Pending"}
          title={translate("Receipts", "الإيصالات")}
          emptyText={translate("No receipt uploaded yet. A claim needs its receipt to be approved.", "لم يُرفع إيصال بعد. تحتاج المطالبة إلى إيصال لاعتمادها.")}
          onUploaded={reload}
          testId="expense-receipts"
        />
      ) : (
        <div className="sub">{translate("Submit the claim, then open it to upload the receipt (PDF or photo).", "أرسل المطالبة، ثم افتحها لرفع الإيصال (PDF أو صورة).")}</div>
      )}
      {id && canDecide && (
        <div className="sect">
          <h4>{translate("Decision", "القرار")}</h4>
          <div className="fg">
            <Sel
              label={translate("Status", "الحالة")}
              k="status"
              f={f}
              opts={
                state.lists.EXPENSE_TYPES
                  ? [
                      ["Pending", translate("Pending", "قيد الانتظار")],
                      ["Approved", translate("Approved", "مُعتمد")],
                      ["Rejected", translate("Rejected", "مرفوض")],
                    ]
                  : []
              }
            />
            <Inp label={translate("Decided by", "اعتمده")} k="by" f={f} />
            <Inp label={translate("Note", "ملاحظة")} k="note" f={f} full />
            {state.role === "md" && !x?.receipt && <Chk label={translate("Approve without a receipt (MD override)", "الموافقة بدون إيصال (تجاوز من المدير العام)")} k="receiptOverride" f={f} full />}
          </div>
        </div>
      )}
      <div className="row2">
        {(edit || canDecide) && (
          <button className="btn primary" data-testid="hr-save-exp" onClick={() => save().catch(() => undefined)}>
            {id ? translate("Save", "حفظ") : translate("Submit claim", "إرسال المطالبة")}
          </button>
        )}
        {id && edit && (
          <span style={{ marginLeft: "auto" }}>
            <ArmedButton label={translate("Delete", "حذف")} armed={translate("Click again to delete", "اضغط مرة أخرى للحذف")} onConfirm={() => call("DELETE", `expenses/${id}`).then(close)} />
          </span>
        )}
      </div>
    </Modal>
  );
}
