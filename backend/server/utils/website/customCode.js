'use strict';

const vm = require('vm');
const ApiError = require('../apiError');

// Website Management - custom code (header/body/footer HTML, CSS, JavaScript) validation.
// Custom code is injected into the PUBLIC website only (at build time, by the website's own
// build - never rendered or executed inside the dashboard). Writing it requires the admin-only
// `code.manage` capability. What this module guarantees:
//   - JavaScript is syntax-checked by COMPILING it (vm.Script) - it is never run;
//   - CSS cannot close its own <style> element, JS cannot close its <script> element;
//   - HTML snippets cannot open/close the document's own <html>/<head>/<body>, and every inline
//     <script> in them is syntax-checked too;
//   - size limits;
//   - non-blocking warnings for risky-but-legitimate patterns (eval, document.write, insecure
//     http:// URLs, third-party script hosts, tracking that duplicates a configured integration).

const MAX_BYTES = 64 * 1024;
const KINDS = ['html', 'css', 'js'];
const PLACEMENTS = ['head', 'body_start', 'body_end'];

function compileJs(code, label) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(code, { filename: label });
  } catch (err) {
    throw new ApiError(`${label}: JavaScript syntax error - ${err.message}`, 400);
  }
}

function cssBalanced(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function scriptHosts(code) {
  const hosts = new Set();
  const rx = /<script[^>]*\bsrc\s*=\s*["']?(https?:)?\/\/([^/"'\s>]+)/gi;
  let m;
  while ((m = rx.exec(code))) hosts.add(m[2].toLowerCase());
  return [...hosts];
}

/** Tracking ids present in a snippet - used to flag duplicates of the Integrations settings. */
function trackingIds(code) {
  return {
    gtm: [...new Set((code.match(/GTM-[A-Z0-9]{4,10}/g) || []))],
    ga4: [...new Set((code.match(/\bG-[A-Z0-9]{6,12}\b/g) || []))],
    metaPixel: [...new Set([...code.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g)].map(m => m[1]))],
    googleAds: [...new Set((code.match(/\bAW-\d{6,12}\b/g) || []))],
  };
}

/**
 * Validates a snippet. Returns { code, warnings }. Throws ApiError(400) when it is unusable.
 * `integrations` (optional) = the saved Integrations document, to flag duplicated tracking tags.
 */
function validateCustomCode({ kind = 'html', placement, code }, { integrations } = {}) {
  if (!KINDS.includes(kind)) throw new ApiError('Choose HTML, CSS or JavaScript.', 400);
  if (!PLACEMENTS.includes(placement)) throw new ApiError('Choose where the code goes: head, start of body or end of body.', 400);
  if (typeof code !== 'string' || !code.trim()) throw new ApiError('The code cannot be empty.', 400);
  if (Buffer.byteLength(code, 'utf8') > MAX_BYTES) throw new ApiError(`Custom code is limited to ${MAX_BYTES / 1024} KB per snippet.`, 400);
  if (/\u0000/.test(code)) throw new ApiError('The code contains a null character.', 400);
  const warnings = [];

  if (kind === 'css') {
    if (placement !== 'head') throw new ApiError('Stylesheets are placed in the page head.', 400);
    if (/<\/?style\b/i.test(code)) throw new ApiError('Enter the CSS rules only - without <style> tags.', 400);
    if (/<\/?[a-z][^>]*>/i.test(code)) throw new ApiError('CSS cannot contain HTML tags.', 400);
    if (!cssBalanced(code)) throw new ApiError('The CSS has unbalanced { } braces.', 400);
    if (/expression\s*\(|javascript:/i.test(code)) throw new ApiError('CSS expressions and javascript: URLs are not allowed.', 400);
    if (/@import\s+url\(\s*["']?http:/i.test(code)) warnings.push('An @import uses insecure http:// - browsers will block it on the https site.');
  }

  if (kind === 'js') {
    if (/<\/?script\b/i.test(code)) throw new ApiError('Enter the JavaScript only - without <script> tags.', 400);
    compileJs(code, 'Script');
  }

  if (kind === 'html') {
    if (/<\/?(html|head|body)\b/i.test(code)) throw new ApiError('A snippet cannot contain <html>, <head> or <body> tags - it is placed inside the page.', 400);
    const opens = (code.match(/<script\b/gi) || []).length;
    const closes = (code.match(/<\/script\s*>/gi) || []).length;
    if (opens !== closes) throw new ApiError('Every <script> tag in the snippet must be closed with </script>.', 400);
    const styleOpens = (code.match(/<style\b/gi) || []).length;
    const styleCloses = (code.match(/<\/style\s*>/gi) || []).length;
    if (styleOpens !== styleCloses) throw new ApiError('Every <style> tag in the snippet must be closed with </style>.', 400);
    // Syntax-check every inline script body (JavaScript type only).
    const rx = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let m;
    let n = 0;
    while ((m = rx.exec(code))) {
      n += 1;
      const attrs = m[1] || '';
      const typeMatch = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
      const type = typeMatch ? typeMatch[1].toLowerCase() : 'text/javascript';
      if (/\bsrc\s*=/i.test(attrs)) continue;
      if (!['text/javascript', 'application/javascript', 'module'].includes(type)) continue;
      if (type !== 'module' && m[2].trim()) compileJs(m[2], `Inline script ${n}`);
    }
    if (placement === 'head') {
      const bodyOnly = code.replace(/<(meta|link|script|style|noscript|base|title)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi, '').replace(/<!--[\s\S]*?-->/g, '').trim();
      if (/<[a-z]/i.test(bodyOnly)) warnings.push('The head should only contain <meta>, <link>, <script>, <style> or <noscript> tags - other elements will be moved into the body by browsers.');
    }
    const hosts = scriptHosts(code);
    if (hosts.length) warnings.push(`Loads scripts from: ${hosts.join(', ')}. Make sure you trust these providers - their code runs on every page it is added to.`);
  }

  if (/\beval\s*\(|new\s+Function\s*\(/.test(code)) warnings.push('Uses eval/new Function - avoid running dynamically built code where possible.');
  if (/document\.write\s*\(/.test(code)) warnings.push('Uses document.write, which slows the page down and is blocked in some browsers.');
  if (/(src|href)\s*=\s*["']?http:\/\//i.test(code)) warnings.push('References an insecure http:// address - browsers block mixed content on the https site.');

  if (integrations) {
    const ids = trackingIds(code);
    const dup = [];
    if (integrations.gtm?.enabled && ids.gtm.includes(integrations.gtm.id)) dup.push(`Google Tag Manager (${integrations.gtm.id})`);
    if (integrations.ga4?.enabled && ids.ga4.includes(integrations.ga4.id)) dup.push(`Google Analytics 4 (${integrations.ga4.id})`);
    if (integrations.metaPixel?.enabled && ids.metaPixel.includes(integrations.metaPixel.id)) dup.push(`Meta Pixel (${integrations.metaPixel.id})`);
    if (integrations.googleAds?.enabled && ids.googleAds.includes(integrations.googleAds.id)) dup.push(`Google Ads (${integrations.googleAds.id})`);
    if (dup.length) warnings.push(`This snippet also loads ${dup.join(', ')}, which is already enabled under Integrations - the tag would fire twice. Remove it here or disable the integration.`);
  }

  return { code, warnings };
}

module.exports = { validateCustomCode, trackingIds, MAX_BYTES, KINDS, PLACEMENTS };
