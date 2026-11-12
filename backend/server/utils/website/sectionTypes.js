// Website Management - the controlled section-type registry. The single source of truth for which
// `WebsiteSection.type` values exist, what fields each type's `content` has, how each field is
// edited (its control kind, options, limits, group) and how it is validated. The dashboard reads
// this registry from GET /api/v1/website/section-types, so the editor and this validator can never
// diverge; the public website renders each type with its own component (src/cms/sections).
//
// Field kinds:
//   text / richtext   plain text (richtext = multi-line). ALWAYS rendered as React children on the
//                     website, never as HTML.
//   image             { url, publicId?, alt? } chosen from the Media Library
//   video             an https URL (YouTube, Vimeo or a direct .mp4/.webm) or a Media Library video
//   url               a link: https://..., /path, #anchor, mailto:, tel:
//   select            one of `options`
//   number            numeric, `min`/`max`
//   boolean           true/false
//   color             #rgb / #rrggbb
//   list              an array of items shaped by `itemFields` (`maxItems`)
//   html              raw HTML - ONLY the 'customHtml' type, ONLY writable with the 'code.manage'
//                     capability (website admin), audited like custom code.
// Bilingual fields carry `pairKey` (the Arabic twin of an English field) - both are optional
// independently except where `required` (the English/primary field) is set.

const T = (key, pairKey, opts = {}) => ({ key, pairKey, kind: 'text', ...opts });
const RT = (key, pairKey, opts = {}) => ({ key, pairKey, kind: 'richtext', ...opts });
const IMG = (key, opts = {}) => ({ key, kind: 'image', ...opts });
const URL_ = (key, opts = {}) => ({ key, kind: 'url', ...opts });
const SEL = (key, options, opts = {}) => ({ key, kind: 'select', options, ...opts });

const BUTTON_STYLES = ['primary', 'secondary', 'outline', 'whatsapp'];
const button = prefix => [
  T(`${prefix}LabelEn`, `${prefix}LabelAr`, { maxLength: 40, group: 'buttons', labelEn: 'Button label' }),
  URL_(`${prefix}Href`, { group: 'buttons', labelEn: 'Button link' }),
  SEL(`${prefix}Style`, BUTTON_STYLES, { group: 'buttons', labelEn: 'Button style', default: 'primary' }),
];
const heading = (required = false) => [
  T('eyebrowEn', 'eyebrowAr', { maxLength: 60, labelEn: 'Small label above the heading' }),
  T('headingEn', 'headingAr', { maxLength: 140, required, labelEn: 'Heading' }),
  RT('descriptionEn', 'descriptionAr', { maxLength: 600, labelEn: 'Description' }),
];
const columns = (def = 3) => ({ key: 'columns', kind: 'number', min: 1, max: 6, default: def, group: 'layout', labelEn: 'Columns (desktop)' });

const SECTION_TYPE_FIELDS = {
  hero: {
    labelEn: 'Hero / Banner', labelAr: 'الواجهة الرئيسية', category: 'Intro',
    fields: [
      T('eyebrowEn', 'eyebrowAr', { maxLength: 60, labelEn: 'Small label above the heading' }),
      T('headingEn', 'headingAr', { required: true, maxLength: 140, labelEn: 'Heading' }),
      T('subheadingEn', 'subheadingAr', { maxLength: 200, labelEn: 'Subtitle' }),
      RT('bodyEn', 'bodyAr', { maxLength: 600, labelEn: 'Description' }),
      IMG('image', { group: 'media', labelEn: 'Background image' }),
      { key: 'video', kind: 'video', group: 'media', labelEn: 'Background video (optional, plays muted)' },
      { key: 'overlay', kind: 'number', min: 0, max: 90, default: 40, group: 'media', labelEn: 'Dark overlay (%)' },
      ...button('cta'),
      ...button('cta2').map(f => ({ ...f, labelEn: `Second ${f.labelEn.toLowerCase()}` })),
      SEL('align', ['start', 'center', 'end'], { group: 'layout', default: 'start', labelEn: 'Text alignment' }),
      SEL('height', ['auto', 'medium', 'large', 'full'], { group: 'layout', default: 'large', labelEn: 'Height' }),
      { key: 'textColor', kind: 'color', group: 'layout', labelEn: 'Text color (optional)' },
    ],
  },
  imageText: {
    labelEn: 'Image with text', labelAr: 'صورة مع نص', category: 'Content',
    fields: [
      ...heading(true),
      RT('bodyEn', 'bodyAr', { maxLength: 3000, labelEn: 'Body text' }),
      IMG('image', { required: true, group: 'media', labelEn: 'Image' }),
      SEL('imagePosition', ['start', 'end'], { group: 'layout', default: 'end', labelEn: 'Image side' }),
      { key: 'bullets', kind: 'list', maxItems: 12, labelEn: 'Bullet points', itemFields: [T('textEn', 'textAr', { required: true, maxLength: 160, labelEn: 'Point' })] },
      ...button('cta'),
    ],
  },
  text: {
    labelEn: 'Text content', labelAr: 'محتوى نصي', category: 'Content',
    fields: [...heading(false), RT('bodyEn', 'bodyAr', { required: true, maxLength: 8000, labelEn: 'Text' }), SEL('width', ['narrow', 'normal', 'wide'], { group: 'layout', default: 'normal', labelEn: 'Text width' })],
  },
  services: {
    labelEn: 'Services grid', labelAr: 'شبكة الخدمات', category: 'Grids',
    fields: [
      ...heading(false),
      columns(3),
      {
        key: 'items', kind: 'list', maxItems: 24, labelEn: 'Service cards',
        itemFields: [IMG('image', { labelEn: 'Card image' }), T('titleEn', 'titleAr', { required: true, maxLength: 80, labelEn: 'Title' }), RT('descriptionEn', 'descriptionAr', { maxLength: 400, labelEn: 'Description' }), URL_('linkHref', { labelEn: 'Link' }), T('linkLabelEn', 'linkLabelAr', { maxLength: 40, labelEn: 'Link label' })],
      },
    ],
  },
  solutions: {
    labelEn: 'Solutions grid', labelAr: 'شبكة الحلول', category: 'Grids',
    fields: [
      ...heading(false),
      columns(4),
      {
        key: 'items', kind: 'list', maxItems: 12, labelEn: 'Solutions',
        itemFields: [IMG('image', { labelEn: 'Image or icon' }), T('titleEn', 'titleAr', { required: true, maxLength: 80, labelEn: 'Title' }), RT('descriptionEn', 'descriptionAr', { maxLength: 300, labelEn: 'Description' }), URL_('linkHref', { labelEn: 'Link' })],
      },
    ],
  },
  features: {
    labelEn: 'Features', labelAr: 'المزايا', category: 'Grids',
    fields: [
      ...heading(false),
      columns(3),
      { key: 'items', kind: 'list', maxItems: 24, labelEn: 'Features', itemFields: [IMG('icon', { labelEn: 'Icon (optional)' }), T('titleEn', 'titleAr', { required: true, maxLength: 80, labelEn: 'Title' }), RT('descriptionEn', 'descriptionAr', { maxLength: 300, labelEn: 'Description' })] },
    ],
  },
  statistics: {
    labelEn: 'Statistics / counters', labelAr: 'إحصائيات', category: 'Proof',
    fields: [
      ...heading(false),
      { key: 'animate', kind: 'boolean', default: true, group: 'layout', labelEn: 'Count up when scrolled into view' },
      {
        key: 'items', kind: 'list', maxItems: 8, labelEn: 'Statistics',
        itemFields: [{ key: 'value', kind: 'number', required: true, min: -1e12, max: 1e12, labelEn: 'Number' }, T('prefix', undefined, { maxLength: 8, labelEn: 'Prefix (e.g. +)' }), T('suffixEn', 'suffixAr', { maxLength: 16, labelEn: 'Suffix (e.g. MW, %)' }), T('labelEn', 'labelAr', { required: true, maxLength: 80, labelEn: 'Label' }), T('descriptionEn', 'descriptionAr', { maxLength: 160, labelEn: 'Description' })],
      },
    ],
  },
  testimonials: {
    labelEn: 'Testimonials', labelAr: 'آراء العملاء', category: 'Proof',
    fields: [...heading(false), { key: 'items', kind: 'list', maxItems: 20, labelEn: 'Testimonials', itemFields: [RT('quoteEn', 'quoteAr', { required: true, maxLength: 600, labelEn: 'Quote' }), T('authorEn', 'authorAr', { maxLength: 80, labelEn: 'Name' }), T('roleEn', 'roleAr', { maxLength: 100, labelEn: 'Role / company' }), IMG('image', { labelEn: 'Photo' }), { key: 'rating', kind: 'number', min: 0, max: 5, labelEn: 'Rating (0-5)' }] }],
  },
  partners: {
    labelEn: 'Partners / clients', labelAr: 'الشركاء والعملاء', category: 'Proof',
    fields: [...heading(false), SEL('style', ['grid', 'carousel'], { group: 'layout', default: 'grid', labelEn: 'Display' }), { key: 'items', kind: 'list', maxItems: 40, labelEn: 'Logos', itemFields: [IMG('image', { required: true, labelEn: 'Logo' }), T('nameEn', 'nameAr', { maxLength: 80, labelEn: 'Name' }), URL_('linkHref', { labelEn: 'Website' })] }],
  },
  gallery: {
    labelEn: 'Image gallery', labelAr: 'معرض الصور', category: 'Media',
    fields: [...heading(false), columns(3), { key: 'items', kind: 'list', maxItems: 48, labelEn: 'Images', itemFields: [IMG('image', { required: true, labelEn: 'Image' }), T('captionEn', 'captionAr', { maxLength: 140, labelEn: 'Caption' })] }],
  },
  video: {
    labelEn: 'Video', labelAr: 'فيديو', category: 'Media',
    fields: [...heading(false), { key: 'video', kind: 'video', required: true, group: 'media', labelEn: 'Video (YouTube, Vimeo or a file)' }, IMG('poster', { group: 'media', labelEn: 'Poster image (file videos)' }), { key: 'autoplay', kind: 'boolean', default: false, group: 'media', labelEn: 'Autoplay muted' }],
  },
  cta: {
    labelEn: 'Call to action banner', labelAr: 'شريط دعوة لإجراء', category: 'Conversion',
    fields: [
      T('headingEn', 'headingAr', { required: true, maxLength: 140, labelEn: 'Heading' }),
      RT('descriptionEn', 'descriptionAr', { maxLength: 400, labelEn: 'Description' }),
      ...button('cta'),
      ...button('cta2').map(f => ({ ...f, labelEn: `Second ${f.labelEn.toLowerCase()}` })),
    ],
  },
  faq: {
    labelEn: 'FAQ', labelAr: 'الأسئلة الشائعة', category: 'Content',
    fields: [...heading(false), { key: 'emitSchema', kind: 'boolean', default: true, group: 'layout', labelEn: 'Publish as FAQ structured data' }, { key: 'items', kind: 'list', maxItems: 40, labelEn: 'Questions', itemFields: [T('questionEn', 'questionAr', { required: true, maxLength: 200, labelEn: 'Question' }), RT('answerEn', 'answerAr', { required: true, maxLength: 1500, labelEn: 'Answer' })] }],
  },
  process: {
    labelEn: 'Process / steps', labelAr: 'خطوات العمل', category: 'Content',
    fields: [...heading(false), { key: 'items', kind: 'list', maxItems: 12, labelEn: 'Steps', itemFields: [T('titleEn', 'titleAr', { required: true, maxLength: 80, labelEn: 'Step title' }), RT('descriptionEn', 'descriptionAr', { maxLength: 400, labelEn: 'Description' }), IMG('image', { labelEn: 'Image (optional)' })] }],
  },
  team: {
    labelEn: 'Team', labelAr: 'الفريق', category: 'Content',
    fields: [...heading(false), columns(4), { key: 'items', kind: 'list', maxItems: 40, labelEn: 'People', itemFields: [IMG('image', { labelEn: 'Photo' }), T('nameEn', 'nameAr', { required: true, maxLength: 80, labelEn: 'Name' }), T('roleEn', 'roleAr', { maxLength: 100, labelEn: 'Role' }), RT('bioEn', 'bioAr', { maxLength: 400, labelEn: 'Short bio' }), URL_('linkedin', { labelEn: 'LinkedIn URL' })] }],
  },
  contactInfo: {
    labelEn: 'Contact information', labelAr: 'معلومات التواصل', category: 'Conversion',
    fields: [
      ...heading(false),
      { key: 'useSiteContacts', kind: 'boolean', default: true, labelEn: 'Show the phone, email, WhatsApp and address from Website Settings' },
      { key: 'items', kind: 'list', maxItems: 12, labelEn: 'Extra contact lines', itemFields: [SEL('kind', ['phone', 'email', 'whatsapp', 'address', 'hours', 'other'], { required: true, labelEn: 'Type' }), T('labelEn', 'labelAr', { maxLength: 60, labelEn: 'Label' }), T('valueEn', 'valueAr', { required: true, maxLength: 200, labelEn: 'Value' })] },
      { key: 'showQuoteForm', kind: 'boolean', default: false, labelEn: 'Show the quote request form next to it' },
    ],
  },
  map: {
    labelEn: 'Map / location', labelAr: 'الخريطة والموقع', category: 'Conversion',
    fields: [...heading(false), URL_('embedUrl', { labelEn: 'Google Maps embed URL (blank = the one in Website Settings)' }), T('addressEn', 'addressAr', { maxLength: 200, labelEn: 'Address shown under the map' }), SEL('height', ['small', 'medium', 'large'], { group: 'layout', default: 'medium', labelEn: 'Map height' })],
  },
  customHtml: {
    labelEn: 'Custom HTML', labelAr: 'كود HTML مخصص', category: 'Advanced', restricted: 'code.manage',
    fields: [T('labelEn', undefined, { maxLength: 80, labelEn: 'Internal name (not shown)' }), { key: 'html', kind: 'html', required: true, maxLength: 50000, labelEn: 'HTML' }],
  },

  // ---- Earlier types, kept so sections created before the full registry still edit and render ----
  about: { labelEn: 'About (simple)', labelAr: 'نبذة', category: 'Content', legacy: true, fields: [T('headingEn', 'headingAr', { required: true, maxLength: 120 }), RT('bodyEn', 'bodyAr', { required: true, maxLength: 2000 }), IMG('image')] },
  projects: { labelEn: 'Projects', labelAr: 'المشاريع', category: 'Grids', legacy: true, fields: [T('headingEn', 'headingAr', { maxLength: 120 }), { key: 'items', kind: 'list', itemFields: [T('titleEn', 'titleAr', { required: true, maxLength: 120 }), RT('descriptionEn', 'descriptionAr', { maxLength: 400 }), IMG('image')] }] },
  benefits: { labelEn: 'Benefits', labelAr: 'الفوائد', category: 'Grids', legacy: true, fields: [T('headingEn', 'headingAr', { maxLength: 120 }), { key: 'items', kind: 'list', itemFields: [T('titleEn', 'titleAr', { required: true, maxLength: 80 }), RT('descriptionEn', 'descriptionAr', { maxLength: 300 })] }] },
  contact: { labelEn: 'Contact (simple)', labelAr: 'تواصل', category: 'Conversion', legacy: true, fields: [T('headingEn', 'headingAr', { maxLength: 120 }), RT('bodyEn', 'bodyAr', { maxLength: 500 })] },
};

const SECTION_TYPES = Object.keys(SECTION_TYPE_FIELDS);

// Layout settings every section has (devices, background, spacing, alignment) - separate from the
// type's own content so they work identically for every type.
const SPACING = ['none', 'sm', 'md', 'lg', 'xl'];
const SECTION_SETTINGS_SCHEMA = {
  devices: ['desktop', 'tablet', 'mobile'],
  backgroundTypes: ['none', 'light', 'brand', 'dark', 'color', 'image'],
  spacing: SPACING,
  align: ['start', 'center', 'end'],
  containers: ['normal', 'wide', 'full'],
};
const DEFAULT_SECTION_SETTINGS = {
  devices: { desktop: true, tablet: true, mobile: true },
  background: { type: 'none', color: '', image: null, overlay: 0 },
  spacing: { top: 'md', bottom: 'md' },
  align: 'start',
  container: 'normal',
  anchorId: '',
};

function isSectionType(type) {
  return SECTION_TYPES.includes(type);
}

function fieldsForType(type) {
  return SECTION_TYPE_FIELDS[type]?.fields || null;
}

/** The registry as the dashboard consumes it (no functions, plain JSON). */
function publicRegistry() {
  return {
    types: SECTION_TYPES.map(type => {
      const t = SECTION_TYPE_FIELDS[type];
      return { type, labelEn: t.labelEn, labelAr: t.labelAr, category: t.category, legacy: !!t.legacy, restricted: t.restricted || null, fields: t.fields };
    }),
    settings: SECTION_SETTINGS_SCHEMA,
    defaultSettings: DEFAULT_SECTION_SETTINGS,
  };
}

module.exports = { SECTION_TYPES, SECTION_TYPE_FIELDS, SECTION_SETTINGS_SCHEMA, DEFAULT_SECTION_SETTINGS, isSectionType, fieldsForType, publicRegistry };
