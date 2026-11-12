'use strict';

const ApiError = require('../apiError');

// Website Management - validation of a Visual Editor configuration (mirrors the website's
// src/editor/visual.ts, which applies it). Everything is normalised: unknown keys are dropped,
// CSS property names come from a fixed list, values cannot break out of a declaration or load
// scripts, links/media are safe URLs, text is plain text. Parts that change the site globally or
// can execute (design tokens and global component styles: `design.manage`; custom CSS and Custom
// HTML elements: `code.manage`) are only accepted from users holding that capability - checked by
// comparing them with the current draft, so an editor can save everything else.

const MAX_JSON = 1.5 * 1024 * 1024;
const LANGS = ['en', 'ar'];
const DEVICES = ['desktop', 'tablet', 'mobile'];
const BUCKETS = ['all', 'desktop', 'tablet', 'mobile', 'hover'];
const STYLE_PROPS = new Set([
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration', 'textTransform', 'whiteSpace',
  'width', 'maxWidth', 'minWidth', 'height', 'maxHeight', 'minHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf', 'gap', 'rowGap', 'columnGap', 'gridTemplateColumns', 'order', 'flexGrow',
  'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'overflow',
  'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat',
  'borderWidth', 'borderStyle', 'borderColor', 'borderRadius', 'borderTopWidth', 'borderBottomWidth',
  'boxShadow', 'opacity', 'transform', 'transition', 'objectFit', 'objectPosition', 'aspectRatio', 'filter',
]);
const GLOBAL_TARGETS = new Set(['body', 'headings', 'h1', 'h2', 'h3', 'text', 'links', 'buttons', 'buttonPrimary', 'buttonSecondary', 'buttonWhatsapp', 'cards', 'header', 'headerLinks', 'footer', 'footerLinks', 'forms', 'container', 'sections']);
const NODE_TYPES = new Set(['heading', 'text', 'image', 'video', 'button', 'icon', 'box', 'spacer', 'divider', 'list', 'faq', 'html']);
const BOX_VARIANTS = new Set(['container', 'columns', 'grid', 'card', 'cta', 'stack', 'section']);
const ICONS = new Set(['sun', 'bolt', 'leaf', 'check', 'phone', 'mail', 'star', 'arrow', 'water', 'factory']);

const ID_OK = /^[A-Za-z0-9_./:@~*-]{1,400}$/;
const NODE_ID = /^[a-z0-9]{4,24}$/i;
const ROUTE_OK = /^(\*|\/[a-z0-9\-/]{0,200})$/;
const TOKEN_NAME = /^(dark:)?--[a-z0-9-]{1,60}$/i;
const SAFE_LINK = /^(https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*|#[A-Za-z0-9_-]*|mailto:[^\s"'<>]+|tel:\+?[0-9 ()-]+)$/i;
const devMedia = () => process.env.NODE_ENV !== 'production';
const SAFE_MEDIA = u => typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/(?!\/)[^\s"'<>]*$/.test(u) || (devMedia() && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s"'<>]*$/i.test(u)));

const fail = (path, msg) => {
  throw new ApiError(`${path}: ${msg}`, 400);
};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max, path) => {
  if (typeof v !== 'string') fail(path, 'must be text.');
  if (v.length > max) fail(path, `is longer than ${max} characters.`);
  return v;
};

function cssValue(v, path) {
  const s = str(v, 600, path).trim();
  if (/[;{}<>\\]|\/\*|expression\s*\(|javascript:|@import/i.test(s)) fail(path, 'is not an allowed CSS value.');
  const urls = [...s.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)];
  if (/url\(/i.test(s) && !urls.length) fail(path, 'has a malformed url().');
  for (const m of urls) if (!SAFE_MEDIA(m[2])) fail(path, 'images must be https URLs from the Media Library.');
  return s;
}

function styleMap(raw, path) {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) fail(path, 'must be an object.');
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!STYLE_PROPS.has(k)) fail(`${path}.${k}`, 'is not an editable style property.');
    if (v === '' || v === null || v === undefined) continue;
    out[k] = cssValue(v, `${path}.${k}`);
  }
  return Object.keys(out).length ? out : undefined;
}

function buckets(raw, path) {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) fail(path, 'must be an object.');
  const out = {};
  for (const b of BUCKETS) {
    const m = styleMap(raw[b], `${path}.${b}`);
    if (m) out[b] = m;
  }
  return Object.keys(out).length ? out : undefined;
}

function langText(raw, max, path) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return { en: str(raw, max, path) };
  if (!isObj(raw)) fail(path, 'must be text per language.');
  const out = {};
  for (const l of LANGS) if (raw[l] !== undefined && raw[l] !== null) out[l] = str(raw[l], max, `${path}.${l}`);
  return out;
}

function elOverride(raw, path) {
  if (!isObj(raw)) fail(path, 'must be an object.');
  const out = {};
  if (raw.label !== undefined) out.label = str(raw.label, 80, `${path}.label`);
  if (raw.text !== undefined) out.text = langText(raw.text, 5000, `${path}.text`);
  if (raw.attrs !== undefined) {
    if (!isObj(raw.attrs)) fail(`${path}.attrs`, 'must be an object.');
    const a = {};
    if (raw.attrs.src) {
      if (!SAFE_MEDIA(raw.attrs.src)) fail(`${path}.attrs.src`, 'must be an https image or video URL.');
      a.src = raw.attrs.src;
    }
    if (raw.attrs.mobileSrc) {
      if (!SAFE_MEDIA(raw.attrs.mobileSrc)) fail(`${path}.attrs.mobileSrc`, 'must be an https image URL.');
      a.mobileSrc = raw.attrs.mobileSrc;
    }
    if (raw.attrs.alt !== undefined) a.alt = langText(raw.attrs.alt, 300, `${path}.attrs.alt`);
    if (raw.attrs.href) {
      if (!SAFE_LINK.test(String(raw.attrs.href).trim())) fail(`${path}.attrs.href`, 'must be https://..., /path, #anchor, mailto: or tel:.');
      a.href = String(raw.attrs.href).trim();
    }
    if (raw.attrs.target) a.target = raw.attrs.target === '_blank' ? '_blank' : '_self';
    if (Object.keys(a).length) out.attrs = a;
  }
  const st = buckets(raw.styles, `${path}.styles`);
  if (st) out.styles = st;
  if (raw.hidden !== undefined) {
    if (!isObj(raw.hidden)) fail(`${path}.hidden`, 'must be per device.');
    const h = {};
    for (const d of DEVICES) if (raw.hidden[d]) h[d] = true;
    if (Object.keys(h).length) out.hidden = h;
  }
  if (raw.deleted) out.deleted = true;
  if (raw.order !== undefined) {
    if (!Array.isArray(raw.order) || raw.order.length > 200 || !raw.order.every(x => typeof x === 'string' && ID_OK.test(x))) fail(`${path}.order`, 'must be a list of element ids.');
    out.order = raw.order;
  }
  if (raw.flexify) out.flexify = true;
  if (raw.insert !== undefined) {
    if (!Array.isArray(raw.insert) || raw.insert.length > 100 || !raw.insert.every(x => typeof x === 'string' && NODE_ID.test(x))) fail(`${path}.insert`, 'must be a list of added element ids.');
    out.insert = raw.insert;
  }
  return out;
}

function node(raw, path) {
  if (!isObj(raw) || !NODE_TYPES.has(raw.type)) fail(path, 'is not a known element type.');
  const p = isObj(raw.props) ? raw.props : {};
  const props = {};
  switch (raw.type) {
    case 'heading':
      props.level = Math.min(6, Math.max(2, Number(p.level) || 2));
      props.text = langText(p.text, 500, `${path}.text`) || {};
      break;
    case 'text':
      props.text = langText(p.text, 5000, `${path}.text`) || {};
      break;
    case 'image':
      if (p.src && !SAFE_MEDIA(p.src)) fail(`${path}.src`, 'must be an https image URL.');
      props.src = p.src || '';
      props.alt = langText(p.alt, 300, `${path}.alt`) || {};
      break;
    case 'video':
      if (p.url && !/^https:\/\/[^\s"'<>]+$/i.test(p.url) && !SAFE_MEDIA(p.url)) fail(`${path}.url`, 'must be an https video URL.');
      props.url = p.url || '';
      break;
    case 'button':
      if (p.href && !SAFE_LINK.test(String(p.href))) fail(`${path}.href`, 'must be https://..., /path, #anchor, mailto: or tel:.');
      props.href = p.href || '';
      props.label = langText(p.label, 80, `${path}.label`) || {};
      props.style = ['primary', 'secondary', 'whatsapp'].includes(p.style) ? p.style : 'primary';
      props.target = p.target === '_blank' ? '_blank' : '_self';
      break;
    case 'icon':
      props.name = ICONS.has(p.name) ? p.name : 'star';
      break;
    case 'box':
      props.variant = BOX_VARIANTS.has(p.variant) ? p.variant : 'stack';
      props.columns = Math.min(6, Math.max(1, Number(p.columns) || 2));
      break;
    case 'spacer':
      props.height = cssValue(String(p.height || '40px'), `${path}.height`);
      break;
    case 'list':
      if (!Array.isArray(p.items) || p.items.length > 50) fail(`${path}.items`, 'must be a list.');
      props.items = p.items.map((it, i) => langText(it, 400, `${path}.items[${i}]`) || {});
      break;
    case 'faq':
      if (!Array.isArray(p.items) || p.items.length > 40) fail(`${path}.items`, 'must be a list.');
      props.items = p.items.map((it, i) => ({ q: langText(it && it.q, 300, `${path}.items[${i}].q`) || {}, a: langText(it && it.a, 2000, `${path}.items[${i}].a`) || {} }));
      break;
    case 'html':
      props.html = str(p.html || '', 50000, `${path}.html`);
      break;
    default:
      break;
  }
  const out = { type: raw.type, props };
  if (raw.type === 'box') {
    const kids = Array.isArray(raw.children) ? raw.children : [];
    if (kids.length > 60 || !kids.every(k => typeof k === 'string' && NODE_ID.test(k))) fail(`${path}.children`, 'must be a list of added element ids.');
    out.children = kids;
  }
  return out;
}

function customCss(v, path) {
  if (v === undefined || v === null || v === '') return '';
  const s = str(v, 100000, path);
  if (/<\/?style|<script|@import|javascript:|expression\s*\(/i.test(s)) fail(path, 'cannot contain </style>, <script>, @import, javascript: or expression().');
  let depth = 0;
  for (const ch of s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) fail(path, 'has unbalanced { } braces.');
  return s;
}

/** Normalises a configuration. Throws ApiError(400) with the first problem found. */
function normalizeVisual(raw) {
  if (!isObj(raw)) fail('config', 'must be an object.');
  if (JSON.stringify(raw).length > MAX_JSON) fail('config', 'is too large.');
  const out = { v: 1, tokens: {}, rules: {}, css: '', routes: {}, nodes: {} };
  for (const [k, v] of Object.entries(isObj(raw.tokens) ? raw.tokens : {})) {
    if (!TOKEN_NAME.test(k)) fail(`tokens.${k}`, 'is not a design token name.');
    if (v === '' || v === null) continue;
    out.tokens[k] = cssValue(v, `tokens.${k}`);
  }
  for (const [k, v] of Object.entries(isObj(raw.rules) ? raw.rules : {})) {
    if (!GLOBAL_TARGETS.has(k)) fail(`rules.${k}`, 'is not a global style target.');
    const b = buckets(v, `rules.${k}`);
    if (b) out.rules[k] = b;
  }
  out.css = customCss(raw.css, 'css');
  for (const [route, rc] of Object.entries(isObj(raw.routes) ? raw.routes : {})) {
    if (!ROUTE_OK.test(route)) fail(`routes.${route}`, 'is not a page path.');
    const el = {};
    for (const [id, ov] of Object.entries(isObj(rc && rc.el) ? rc.el : {})) {
      if (!ID_OK.test(id)) fail(`routes.${route}.${id}`, 'is not an element id.');
      const o = elOverride(ov, `${route} › ${id}`);
      if (Object.keys(o).length) el[id] = o;
    }
    const css = customCss(rc && rc.css, `routes.${route}.css`);
    if (Object.keys(el).length || css) out.routes[route] = { el, css };
  }
  for (const [id, n] of Object.entries(isObj(raw.nodes) ? raw.nodes : {})) {
    if (!NODE_ID.test(id)) fail(`nodes.${id}`, 'is not an element id.');
    out.nodes[id] = node(n, `nodes.${id}`);
  }
  return out;
}

const restrictedDesign = c => JSON.stringify([c.tokens || {}, c.rules || {}]);
const restrictedCode = c =>
  JSON.stringify([
    c.css || '',
    Object.entries(c.routes || {}).map(([r, rc]) => [r, rc.css || '']).filter(([, css]) => css),
    Object.entries(c.nodes || {}).filter(([, n]) => n.type === 'html').map(([id, n]) => [id, n.props.html]),
  ]);

/** Refuses changes to global design or executable parts without the capability (compared with `current`). */
function assertAllowedChanges(next, current, capabilities) {
  const caps = capabilities || [];
  if (!caps.includes('design.manage') && restrictedDesign(next) !== restrictedDesign(current || {})) {
    throw new ApiError('Only a website administrator can change the global design (colors, fonts and global component styles).', 403);
  }
  if (!caps.includes('code.manage') && restrictedCode(next) !== restrictedCode(current || {})) {
    throw new ApiError('Only a website administrator can change custom CSS or Custom HTML elements.', 403);
  }
}

module.exports = { normalizeVisual, assertAllowedChanges, EMPTY: () => ({ v: 1, tokens: {}, rules: {}, css: '', routes: {}, nodes: {} }) };
