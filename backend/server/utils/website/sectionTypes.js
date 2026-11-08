// Website Management - the controlled section-type registry (plan doc "Website Management CMS",
// section 1). The single source of truth for which `WebsiteSection.type` values exist and what
// fields each one's `content` must have. Mirrored (not re-implemented) on the frontend as
// frontend/src/utils/constants/website-section-types.ts, so the property-editor form and this
// backend validator can never silently diverge on what a "hero" section looks like.
//
// Deliberately excludes 'footer'/'header' - those are site-wide, not per-page, and live on
// WebsiteNavigation/WebsiteSettings instead (see those models).
//
// Field `kind`s: 'text' (short, single-line), 'richtext' (longer, still plain text - rendered as a
// React child, never dangerouslySetInnerHTML), 'image' ({url, publicId} from the Media Library),
// 'url', 'list' (an array of objects, each shaped by `itemFields`).

const SECTION_TYPES = ['hero', 'about', 'services', 'projects', 'benefits', 'statistics', 'testimonials', 'partners', 'contact', 'cta', 'faq'];

const SECTION_TYPE_FIELDS = {
  hero: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', required: true, maxLength: 120 },
      { key: 'subheadingEn', pairKey: 'subheadingAr', kind: 'text', maxLength: 200 },
      { key: 'bodyEn', pairKey: 'bodyAr', kind: 'richtext', maxLength: 500 },
      { key: 'image', kind: 'image' },
      { key: 'ctaLabelEn', pairKey: 'ctaLabelAr', kind: 'text', maxLength: 40 },
      { key: 'ctaHref', kind: 'url' },
    ],
  },
  about: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', required: true, maxLength: 120 },
      { key: 'bodyEn', pairKey: 'bodyAr', kind: 'richtext', required: true, maxLength: 2000 },
      { key: 'image', kind: 'image' },
    ],
  },
  services: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', maxLength: 120 },
      {
        key: 'items',
        kind: 'list',
        itemFields: [
          { key: 'titleEn', pairKey: 'titleAr', kind: 'text', required: true, maxLength: 80 },
          { key: 'descriptionEn', pairKey: 'descriptionAr', kind: 'richtext', maxLength: 400 },
          { key: 'image', kind: 'image' },
          { key: 'linkHref', kind: 'url' },
        ],
      },
    ],
  },
  projects: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', maxLength: 120 },
      {
        key: 'items',
        kind: 'list',
        itemFields: [
          { key: 'titleEn', pairKey: 'titleAr', kind: 'text', required: true, maxLength: 120 },
          { key: 'descriptionEn', pairKey: 'descriptionAr', kind: 'richtext', maxLength: 400 },
          { key: 'image', kind: 'image' },
        ],
      },
    ],
  },
  benefits: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', maxLength: 120 },
      {
        key: 'items',
        kind: 'list',
        itemFields: [
          { key: 'titleEn', pairKey: 'titleAr', kind: 'text', required: true, maxLength: 80 },
          { key: 'descriptionEn', pairKey: 'descriptionAr', kind: 'richtext', maxLength: 300 },
        ],
      },
    ],
  },
  statistics: {
    fields: [
      {
        key: 'items',
        kind: 'list',
        itemFields: [
          { key: 'valueEn', pairKey: 'valueAr', kind: 'text', required: true, maxLength: 40 },
          { key: 'labelEn', pairKey: 'labelAr', kind: 'text', required: true, maxLength: 80 },
        ],
      },
    ],
  },
  testimonials: {
    fields: [
      {
        key: 'items',
        kind: 'list',
        itemFields: [
          { key: 'quoteEn', pairKey: 'quoteAr', kind: 'richtext', required: true, maxLength: 500 },
          { key: 'authorEn', pairKey: 'authorAr', kind: 'text', maxLength: 80 },
          { key: 'image', kind: 'image' },
        ],
      },
    ],
  },
  partners: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', maxLength: 120 },
      { key: 'items', kind: 'list', itemFields: [{ key: 'image', kind: 'image', required: true }, { key: 'nameEn', pairKey: 'nameAr', kind: 'text', maxLength: 80 }] },
    ],
  },
  contact: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', maxLength: 120 },
      { key: 'bodyEn', pairKey: 'bodyAr', kind: 'richtext', maxLength: 500 },
    ],
  },
  cta: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', required: true, maxLength: 120 },
      { key: 'ctaLabelEn', pairKey: 'ctaLabelAr', kind: 'text', maxLength: 40 },
      { key: 'ctaHref', kind: 'url' },
    ],
  },
  faq: {
    fields: [
      { key: 'headingEn', pairKey: 'headingAr', kind: 'text', maxLength: 120 },
      {
        key: 'items',
        kind: 'list',
        itemFields: [
          { key: 'questionEn', pairKey: 'questionAr', kind: 'text', required: true, maxLength: 200 },
          { key: 'answerEn', pairKey: 'answerAr', kind: 'richtext', required: true, maxLength: 1000 },
        ],
      },
    ],
  },
};

function isSectionType(type) {
  return SECTION_TYPES.includes(type);
}

function fieldsForType(type) {
  return SECTION_TYPE_FIELDS[type]?.fields || null;
}

module.exports = { SECTION_TYPES, SECTION_TYPE_FIELDS, isSectionType, fieldsForType };
