'use strict';

const ApiError = require('../apiError');
const { fieldsForType, SECTION_SETTINGS_SCHEMA, DEFAULT_SECTION_SETTINGS } = require('./sectionTypes');

// Website Management - server-side validation of a section's `content` (against its type's field
// list in sectionTypes.js) and its layout `settings`. Every link and media reference is checked
// for a safe scheme - `javascript:`/`data:` URLs can never be saved, whatever the dashboard sends.

const SAFE_LINK = /^(https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*|#[A-Za-z0-9_-]*|mailto:[^\s"'<>]+|tel:\+?[0-9 ()-]+)$/i;
const SAFE_MEDIA = /^(https:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i;
// Local development only (WEBSITE_MEDIA_DRIVER=local serves uploads from http://localhost).
const DEV_MEDIA = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s"'<>]*$/i;
const isSafeMediaUrl = url => typeof url === 'string' && (SAFE_MEDIA.test(url) || (process.env.NODE_ENV !== 'production' && DEV_MEDIA.test(url)));
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const ANCHOR = /^[a-z][a-z0-9-]{0,40}$/;

function fail(path, message) {
  throw new ApiError(`${path}: ${message}`, 400);
}

const isBlank = v => v === undefined || v === null || v === '';

function checkImage(path, raw, required) {
  if (isBlank(raw)) {
    if (required) fail(path, 'an image is required.');
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) fail(path, 'must be an image reference.');
  if (isBlank(raw.url)) {
    if (required) fail(path, 'an image is required.');
    return null;
  }
  if (!isSafeMediaUrl(raw.url)) fail(path, 'has an invalid image URL (https only).');
  const out = { url: raw.url };
  if (raw.publicId != null) out.publicId = String(raw.publicId).slice(0, 300);
  if (raw.mediaId != null) out.mediaId = String(raw.mediaId).slice(0, 40);
  if (raw.altEn != null) out.altEn = String(raw.altEn).slice(0, 200);
  if (raw.altAr != null) out.altAr = String(raw.altAr).slice(0, 200);
  if (raw.width != null && Number.isFinite(Number(raw.width))) out.width = Number(raw.width);
  if (raw.height != null && Number.isFinite(Number(raw.height))) out.height = Number(raw.height);
  return out;
}

/** A video is a YouTube/Vimeo/direct https URL, or a Media Library video ({url}). */
function checkVideo(path, raw, required) {
  const url = raw && typeof raw === 'object' ? raw.url : raw;
  if (isBlank(url)) {
    if (required) fail(path, 'a video is required.');
    return null;
  }
  if (typeof url !== 'string' || !(/^https:\/\/[^\s"'<>]+$/i.test(url) || (process.env.NODE_ENV !== 'production' && DEV_MEDIA.test(url)))) fail(path, 'must be an https video URL.');
  return raw && typeof raw === 'object' ? { url, publicId: raw.publicId ? String(raw.publicId).slice(0, 300) : undefined } : url;
}

function checkText(path, raw, field) {
  if (isBlank(raw)) {
    if (field.required) fail(path, 'is required.');
    return raw === undefined ? undefined : '';
  }
  if (typeof raw !== 'string') fail(path, 'must be text.');
  if (field.maxLength && raw.length > field.maxLength) fail(path, `exceeds ${field.maxLength} characters.`);
  return raw;
}

function validateFields(fields, value, pathPrefix, { allowHtml }) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const field of fields) {
    const path = `${pathPrefix}${field.key}`;
    const raw = src[field.key];
    switch (field.kind) {
      case 'text':
      case 'richtext': {
        const v = checkText(path, raw, field);
        if (v !== undefined) out[field.key] = v;
        if (field.pairKey) {
          const pv = checkText(`${pathPrefix}${field.pairKey}`, src[field.pairKey], { ...field, required: false });
          if (pv !== undefined) out[field.pairKey] = pv;
        }
        break;
      }
      case 'html': {
        if (!allowHtml && !isBlank(raw)) throw new ApiError('Only a website administrator can edit custom HTML.', 403);
        const v = checkText(path, raw, field);
        if (v !== undefined) out[field.key] = v;
        break;
      }
      case 'image': {
        const v = checkImage(path, raw, field.required);
        if (v) out[field.key] = v;
        break;
      }
      case 'video': {
        const v = checkVideo(path, raw, field.required);
        if (v) out[field.key] = v;
        break;
      }
      case 'url': {
        if (isBlank(raw)) {
          if (field.required) fail(path, 'a link is required.');
          break;
        }
        if (typeof raw !== 'string' || !SAFE_LINK.test(raw.trim())) fail(path, 'must be https://..., /path, #anchor, mailto: or tel:.');
        out[field.key] = raw.trim();
        break;
      }
      case 'select': {
        if (isBlank(raw)) {
          if (field.required) fail(path, 'is required.');
          break;
        }
        if (!field.options.includes(raw)) fail(path, `must be one of ${field.options.join(', ')}.`);
        out[field.key] = raw;
        break;
      }
      case 'number': {
        if (isBlank(raw)) {
          if (field.required) fail(path, 'is required.');
          break;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) fail(path, 'must be a number.');
        if (field.min != null && n < field.min) fail(path, `must be at least ${field.min}.`);
        if (field.max != null && n > field.max) fail(path, `must be at most ${field.max}.`);
        out[field.key] = n;
        break;
      }
      case 'boolean':
        if (raw !== undefined) out[field.key] = raw === true || raw === 'true';
        break;
      case 'color':
        if (isBlank(raw)) break;
        if (typeof raw !== 'string' || !HEX.test(raw)) fail(path, 'must be a #rrggbb color.');
        out[field.key] = raw;
        break;
      case 'list': {
        if (isBlank(raw)) {
          if (field.required) fail(path, 'needs at least one item.');
          out[field.key] = [];
          break;
        }
        if (!Array.isArray(raw)) fail(path, 'must be a list.');
        if (field.maxItems && raw.length > field.maxItems) fail(path, `has more than ${field.maxItems} items.`);
        out[field.key] = raw.map((item, i) => validateFields(field.itemFields || [], item, `${path}[${i + 1}].`, { allowHtml }));
        break;
      }
      default:
        fail(path, 'has an unknown field kind.');
    }
  }
  return out;
}

/**
 * Validates and NORMALIZES a section's content for `type` (unknown keys are dropped, numbers
 * coerced). Throws ApiError(400) on the first problem, ApiError(403) for HTML without permission.
 */
const withoutRequired = fields => fields.map(f => ({ ...f, required: false, itemFields: f.itemFields ? withoutRequired(f.itemFields) : f.itemFields }));

/**
 * Validates and normalizes a section's content for its type. `partial`: a brand-new section may
 * start empty (required fields are filled in the editor next); shape, limits and link/media safety
 * are still enforced. Saving an edit and publishing are always strict.
 */
function validateContent(type, content, { allowHtml = false, partial = false } = {}) {
  const fields = fieldsForType(type);
  if (!fields) throw new ApiError(`Unknown section type "${type}".`, 400);
  return validateFields(partial ? withoutRequired(fields) : fields, content, '', { allowHtml });
}

/** Normalizes a section's layout settings, filling defaults. */
function validateSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const d = DEFAULT_SECTION_SETTINGS;
  const out = {
    devices: { ...d.devices },
    background: { ...d.background },
    spacing: { ...d.spacing },
    align: d.align,
    container: d.container,
    anchorId: d.anchorId,
  };
  if (s.devices && typeof s.devices === 'object') {
    for (const k of SECTION_SETTINGS_SCHEMA.devices) if (s.devices[k] !== undefined) out.devices[k] = s.devices[k] !== false;
    if (!Object.values(out.devices).some(Boolean)) throw new ApiError('A section must be visible on at least one device (hide it instead).', 400);
  }
  if (s.background && typeof s.background === 'object') {
    const b = s.background;
    if (b.type !== undefined) {
      if (!SECTION_SETTINGS_SCHEMA.backgroundTypes.includes(b.type)) fail('settings.background.type', `must be one of ${SECTION_SETTINGS_SCHEMA.backgroundTypes.join(', ')}.`);
      out.background.type = b.type;
    }
    if (!isBlank(b.color)) {
      if (!HEX.test(b.color)) fail('settings.background.color', 'must be a #rrggbb color.');
      out.background.color = b.color;
    }
    if (b.image !== undefined) out.background.image = checkImage('settings.background.image', b.image, false);
    if (b.overlay !== undefined) {
      const o = Number(b.overlay);
      if (!Number.isFinite(o) || o < 0 || o > 90) fail('settings.background.overlay', 'must be between 0 and 90.');
      out.background.overlay = o;
    }
    if (out.background.type === 'color' && !out.background.color) fail('settings.background.color', 'is required for a color background.');
    if (out.background.type === 'image' && !out.background.image) fail('settings.background.image', 'is required for an image background.');
  }
  if (s.spacing && typeof s.spacing === 'object') {
    for (const k of ['top', 'bottom']) {
      if (s.spacing[k] === undefined) continue;
      if (!SECTION_SETTINGS_SCHEMA.spacing.includes(s.spacing[k])) fail(`settings.spacing.${k}`, `must be one of ${SECTION_SETTINGS_SCHEMA.spacing.join(', ')}.`);
      out.spacing[k] = s.spacing[k];
    }
  }
  if (s.align !== undefined) {
    if (!SECTION_SETTINGS_SCHEMA.align.includes(s.align)) fail('settings.align', `must be one of ${SECTION_SETTINGS_SCHEMA.align.join(', ')}.`);
    out.align = s.align;
  }
  if (s.container !== undefined) {
    if (!SECTION_SETTINGS_SCHEMA.containers.includes(s.container)) fail('settings.container', `must be one of ${SECTION_SETTINGS_SCHEMA.containers.join(', ')}.`);
    out.container = s.container;
  }
  if (!isBlank(s.anchorId)) {
    if (!ANCHOR.test(s.anchorId)) fail('settings.anchorId', 'must start with a letter and use only lowercase letters, numbers and hyphens.');
    out.anchorId = s.anchorId;
  }
  return out;
}

/** Every media URL referenced anywhere in a value (for "where is this image used"). */
function collectMediaUrls(value, out = new Set()) {
  if (!value) return out;
  if (Array.isArray(value)) {
    value.forEach(v => collectMediaUrls(v, out));
  } else if (typeof value === 'object') {
    if (typeof value.url === 'string') out.add(value.url);
    Object.values(value).forEach(v => collectMediaUrls(v, out));
  }
  return out;
}

module.exports = { validateContent, validateSettings, collectMediaUrls, isSafeMediaUrl, SAFE_LINK, SAFE_MEDIA };
