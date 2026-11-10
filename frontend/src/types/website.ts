// Website Management - mirrors backend/server/utils/systemsRegistry.js's WEBSITE.roles exactly.
export type WebsiteRole = "admin" | "editor" | "viewer";

export type WebsiteCapability = "view" | "edit" | "publish" | "media.manage" | "seo.manage" | "integrations.manage" | "settings.manage";

// Mirrors backend/server/middleware/websiteAccess.js's CAPABILITIES_BY_ROLE exactly - kept here
// too so the frontend can show/hide UI without waiting on a round trip for every check (the
// backend re-checks the same role from the user's own stored systemMemberships on every request,
// never from anything the client sends - this is a UI convenience only, not the real authority).
export const WEBSITE_CAPABILITIES_BY_ROLE: Record<WebsiteRole, WebsiteCapability[]> = {
  admin: ["view", "edit", "publish", "media.manage", "seo.manage", "integrations.manage", "settings.manage"],
  editor: ["view", "edit", "media.manage", "seo.manage"],
  viewer: ["view"],
};

export function hasWebsiteCapability(role: WebsiteRole | null | undefined, capability: WebsiteCapability): boolean {
  if (!role) return false;
  return WEBSITE_CAPABILITIES_BY_ROLE[role]?.includes(capability) ?? false;
}

// Mirrors backend/server/utils/website/sectionTypes.js's SECTION_TYPES exactly - the controlled
// registry a section's `type` must be one of. Deliberately excludes 'footer'/'header' - those are
// site-wide, not per-page (see WebsiteNavigation/WebsiteSettings below).
export const SECTION_TYPES = ["hero", "about", "services", "projects", "benefits", "statistics", "testimonials", "partners", "contact", "cta", "faq"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export type SectionFieldKind = "text" | "richtext" | "image" | "url" | "list";
export type SectionField = {
  key: string;
  pairKey?: string;
  kind: SectionFieldKind;
  required?: boolean;
  maxLength?: number;
  itemFields?: SectionField[];
};

// Mirrors backend/server/utils/website/sectionTypes.js's SECTION_TYPE_FIELDS exactly - the single
// source of truth for what fields each section type's `content` has, driving the Visual Editor's
// generic property form (one form for every type, not 11 hand-written ones).
export const SECTION_TYPE_FIELDS: Record<SectionType, { fields: SectionField[] }> = {
  hero: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", required: true, maxLength: 120 },
      { key: "subheadingEn", pairKey: "subheadingAr", kind: "text", maxLength: 200 },
      { key: "bodyEn", pairKey: "bodyAr", kind: "richtext", maxLength: 500 },
      { key: "image", kind: "image" },
      { key: "ctaLabelEn", pairKey: "ctaLabelAr", kind: "text", maxLength: 40 },
      { key: "ctaHref", kind: "url" },
    ],
  },
  about: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", required: true, maxLength: 120 },
      { key: "bodyEn", pairKey: "bodyAr", kind: "richtext", required: true, maxLength: 2000 },
      { key: "image", kind: "image" },
    ],
  },
  services: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", maxLength: 120 },
      {
        key: "items",
        kind: "list",
        itemFields: [
          { key: "titleEn", pairKey: "titleAr", kind: "text", required: true, maxLength: 80 },
          { key: "descriptionEn", pairKey: "descriptionAr", kind: "richtext", maxLength: 400 },
          { key: "image", kind: "image" },
          { key: "linkHref", kind: "url" },
        ],
      },
    ],
  },
  projects: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", maxLength: 120 },
      {
        key: "items",
        kind: "list",
        itemFields: [
          { key: "titleEn", pairKey: "titleAr", kind: "text", required: true, maxLength: 120 },
          { key: "descriptionEn", pairKey: "descriptionAr", kind: "richtext", maxLength: 400 },
          { key: "image", kind: "image" },
        ],
      },
    ],
  },
  benefits: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", maxLength: 120 },
      {
        key: "items",
        kind: "list",
        itemFields: [
          { key: "titleEn", pairKey: "titleAr", kind: "text", required: true, maxLength: 80 },
          { key: "descriptionEn", pairKey: "descriptionAr", kind: "richtext", maxLength: 300 },
        ],
      },
    ],
  },
  statistics: {
    fields: [
      {
        key: "items",
        kind: "list",
        itemFields: [
          { key: "valueEn", pairKey: "valueAr", kind: "text", required: true, maxLength: 40 },
          { key: "labelEn", pairKey: "labelAr", kind: "text", required: true, maxLength: 80 },
        ],
      },
    ],
  },
  testimonials: {
    fields: [
      {
        key: "items",
        kind: "list",
        itemFields: [
          { key: "quoteEn", pairKey: "quoteAr", kind: "richtext", required: true, maxLength: 500 },
          { key: "authorEn", pairKey: "authorAr", kind: "text", maxLength: 80 },
          { key: "image", kind: "image" },
        ],
      },
    ],
  },
  partners: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", maxLength: 120 },
      { key: "items", kind: "list", itemFields: [{ key: "image", kind: "image", required: true }, { key: "nameEn", pairKey: "nameAr", kind: "text", maxLength: 80 }] },
    ],
  },
  contact: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", maxLength: 120 },
      { key: "bodyEn", pairKey: "bodyAr", kind: "richtext", maxLength: 500 },
    ],
  },
  cta: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", required: true, maxLength: 120 },
      { key: "ctaLabelEn", pairKey: "ctaLabelAr", kind: "text", maxLength: 40 },
      { key: "ctaHref", kind: "url" },
    ],
  },
  faq: {
    fields: [
      { key: "headingEn", pairKey: "headingAr", kind: "text", maxLength: 120 },
      {
        key: "items",
        kind: "list",
        itemFields: [
          { key: "questionEn", pairKey: "questionAr", kind: "text", required: true, maxLength: 200 },
          { key: "answerEn", pairKey: "answerAr", kind: "richtext", required: true, maxLength: 1000 },
        ],
      },
    ],
  },
};

export type WebsiteImageRef = { url: string; publicId: string } | null;

export type WebsiteLocale = "ar" | "en";
export const WEBSITE_LOCALES: WebsiteLocale[] = ["ar", "en"];

// Mirrors backend websitePageModel.js#seo. Every field is optional; empty = "use the generated
// default" (or, for a legacy page, "keep the website's own text") - seoResolver.js.
export interface WebsiteSeo {
  titleEn?: string;
  titleAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  ogImage?: WebsiteImageRef | { url: string | null; publicId: string | null };
  noindex?: boolean;
  nofollow?: boolean;
  canonicalEn?: string;
  canonicalAr?: string;
  ogTitleEn?: string;
  ogTitleAr?: string;
  ogDescriptionEn?: string;
  ogDescriptionAr?: string;
  twitterCard?: "" | "summary" | "summary_large_image";
  breadcrumbLabelEn?: string;
  breadcrumbLabelAr?: string;
  showBreadcrumbs?: boolean;
}

// Mirrors backend utils/validators/website/pageValidators.js#SEO_TEXT_LIMITS (hard limits) and
// seoResolver.js's recommended lengths (soft - a warning, not an error).
export const SEO_LIMITS = { title: 70, description: 160, canonical: 500, ogTitle: 95, ogDescription: 200, breadcrumbLabel: 60 } as const;
export const SEO_RECOMMENDED = { titleMax: 60, descriptionMin: 50, descriptionMax: 160 } as const;

export type SeoSource = "custom" | "content" | "site_default" | "website" | "none";
export type SeoWarning =
  | "missing_title"
  | "title_generated"
  | "title_too_long"
  | "missing_description"
  | "description_generated"
  | "description_too_long"
  | "description_too_short"
  | "canonical_overridden"
  | "noindex"
  | "duplicate_title"
  | "duplicate_description";

/** One page in one language, exactly as the website will render it (seoResolver.js#resolvePageLocale). */
export interface ResolvedSeo {
  locale: WebsiteLocale;
  url: string;
  title: string;
  titleSource: SeoSource;
  description: string;
  descriptionSource: SeoSource;
  canonical: string;
  robots: string;
  indexable: boolean;
  alternates: { hreflang: string; href: string }[];
  openGraph: { type: string; title: string; description: string; image: string | null; url: string; locale: string; siteName: string };
  twitter: { card: string; title: string; description: string; image: string | null; site: string | null };
  breadcrumbs: { name: string; url: string }[];
  warnings: SeoWarning[];
}

export interface SeoPreview {
  origin: string;
  slug: string;
  locales: WebsiteLocale[];
  seo: Partial<Record<WebsiteLocale, ResolvedSeo>>;
  problems: string[];
}

export interface SeoAuditEntry {
  pageId: string;
  slug: string;
  locales: WebsiteLocale[];
  warnings: Partial<Record<WebsiteLocale, SeoWarning[]>>;
  problems: string[];
}

export interface WebsiteSettings {
  siteNameEn: string;
  siteNameAr: string;
  taglineEn: string;
  taglineAr: string;
  logo?: { url: string | null; publicId: string | null };
  defaultOgImage?: { url: string | null; publicId: string | null };
  publicSiteUrl: string;
  defaultLocale: WebsiteLocale;
  enabledLocales: WebsiteLocale[];
  titleTemplateEn: string;
  titleTemplateAr: string;
  defaultDescriptionEn: string;
  defaultDescriptionAr: string;
  twitterHandle: string;
  organization: {
    schemaType: "Organization" | "LocalBusiness" | "ProfessionalService" | "HomeAndConstructionBusiness";
    legalName: string;
    descriptionEn: string;
    descriptionAr: string;
    foundingDate: string;
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
    priceRange: string;
  };
  updatedAt?: string;
}

export type WebsitePageStatus = "never_published" | "published" | "unpublished";
export type WebsitePageType = "managed" | "legacy";

export interface WebsitePage {
  _id: string;
  slug: string;
  path: string;
  isHomePage: boolean;
  pageType: WebsitePageType;
  parentSlug: string | null;
  sortOrder: number;
  locales: WebsiteLocale[];
  seo: WebsiteSeo;
  status: WebsitePageStatus;
  publishedAt: string | null;
  publishedBy?: { _id: string; name: string } | string | null;
  publishedRevision: string | null;
  hasPendingChanges?: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebsiteSection {
  _id: string;
  page: string;
  type: SectionType;
  sortOrder: number;
  isVisible: boolean;
  // Keyed by each type's own field keys (SECTION_TYPE_FIELDS) - deliberately loose here since the
  // real shape varies per type; the property form/backend validator are the source of truth.
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WebsiteRevision {
  _id: string;
  page: string;
  label: string | null;
  publishedBy: { _id: string; name: string } | string;
  publishedAt: string;
}

export interface WebsiteMedia {
  _id: string;
  url: string;
  publicId: string;
  format: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  altEn: string;
  altAr: string;
  folder: string;
  uploadedBy: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
