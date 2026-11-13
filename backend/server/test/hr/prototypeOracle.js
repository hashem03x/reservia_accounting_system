'use strict';

// Loads the HR Portal prototype (Reservia_HR_Portal.html, the spec's acceptance reference) into a
// sandbox and exposes its own calculation functions, so tests can compare the server engine with
// the prototype figure for figure. The prototype is a client document kept outside the repository
// (`reports & requirments/`, git-ignored); when it is not on disk, load() returns null and the tests
// fall back to the committed register snapshot (fixtures/prototype-register-2026-11.json).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_PATH = path.join(__dirname, '..', '..', '..', '..', 'reports & requirments', 'Reservia_HR_Portal.html');

function prototypePath() {
  return process.env.HR_PROTOTYPE_PATH || DEFAULT_PATH;
}

let source = null;
function scriptSource() {
  if (source !== null) return source;
  const file = prototypePath();
  if (!fs.existsSync(file)) {
    source = false;
    return source;
  }
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  let js = html.slice(start + '<script>'.length, end);
  if (!js.includes('var TODAY=ymd(Date.now());')) throw new Error('Prototype layout changed: TODAY not found');
  js = js.replace('var TODAY=ymd(Date.now());', 'var TODAY=__TODAY;');
  const tail = /boot\(\);\s*\}\)\(\);\s*$/;
  if (!tail.test(js)) throw new Error('Prototype layout changed: boot() not found');
  js = js.replace(
    tail,
    'globalThis.__P={D:D,C:C,calcPay:calcPay,empsIn:empsIn,visitParts:visitParts,erpJournal:erpJournal,docSt:docSt,trnStatus:trnStatus,leaveEnt:leaveEnt,leaveUsed:leaveUsed,casualUsed:casualUsed,dayInfo:dayInfo,seedExamples:seedExamples,saveCfg:saveCfg,DOCS:DOCS,wdList:wdList,taxAnnual:taxAnnual};})();'
  );
  source = js;
  return source;
}

/** A fresh prototype instance for `today` (YYYY-MM-DD), or null when the prototype is unavailable. */
function load(today) {
  const js = scriptSource();
  if (!js) return null;
  const dummy = { hidden: false, textContent: '', innerHTML: '', value: '', classList: { add() {}, remove() {} }, dataset: {} };
  const document = {
    addEventListener() {},
    querySelector: () => dummy,
    querySelectorAll: () => [],
    getElementById: () => null,
    activeElement: null,
    body: dummy,
  };
  const sandbox = { __TODAY: today, document, window: {}, setTimeout: () => 0, clearTimeout() {}, console, Promise, Date, Math, JSON, Object, Array, String, Number, isNaN, parseFloat };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: 'Reservia_HR_Portal.html' });
  return sandbox.__P;
}

/** The prototype's data store converted to the engine's input shape. */
function engineData(P, today) {
  const arr = col => Object.keys(P.D[col]).map(k => Object.assign({}, P.D[col][k], { id: k }));
  const targets = {};
  Object.keys(P.D.tgt).forEach(k => {
    if (P.D.tgt[k] && P.D.tgt[k].pct != null) targets[k] = P.D.tgt[k].pct;
  });
  return {
    cfg: P.D.cfg.main || {},
    today,
    employees: arr('emp'),
    attendance: JSON.parse(JSON.stringify(P.D.att)),
    targets,
    visits: arr('vis'),
    expenses: arr('exp'),
    adjustments: arr('adj'),
    forms: arr('frm'),
    trainings: arr('trn'),
  };
}

module.exports = { load, engineData, prototypePath };
