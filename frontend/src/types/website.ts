// Website Management - mirrors backend/server/utils/systemsRegistry.js's WEBSITE.roles exactly.
export type WebsiteRole = "admin" | "editor" | "viewer";

export type WebsiteCapability =
  | "view"
  | "edit"
  | "publish"
  | "media.manage"
  | "seo.manage"
  | "integrations.manage"
  | "settings.manage"
  | "navigation.manage"
  | "code.manage"
  | "design.manage";

// Mirrors backend/server/middleware/websiteAccess.js's CAPABILITIES_BY_ROLE exactly - kept here
// too so the frontend can show/hide UI without waiting on a round trip for every check (the
// backend re-checks the same role from the user's own stored systemMemberships on every request,
// never from anything the client sends - this is a UI convenience only, not the real authority).
export const WEBSITE_CAPABILITIES_BY_ROLE: Record<WebsiteRole, WebsiteCapability[]> = {
  admin: ["view", "edit", "publish", "media.manage", "seo.manage", "integrations.manage", "settings.manage", "navigation.manage", "code.manage", "design.manage"],
  editor: ["view", "edit", "media.manage", "seo.manage"],
  viewer: ["view"],
};

export function hasWebsiteCapability(role: WebsiteRole | null | undefined, capability: WebsiteCapability): boolean {
  if (!role) return false;
  return WEBSITE_CAPABILITIES_BY_ROLE[role]?.includes(capability) ?? false;
}

// Section types are NOT mirrored here: the dashboard reads the registry from the backend
// (GET /website/section-types - backend/server/utils/website/sectionTypes.js), so the editor
// forms and the server-side validator can never drift apart.
export type SectionType = string;
export type SectionFieldKind = "text" | "richtext" | "image" | "video" | "url" | "select" | "number" | "boolean" | "color" | "list" | "html";
export type SectionField = {
  key: string;
  pairKey?: string;
  kind: SectionFieldKind;
  required?: boolean;
  maxLength?: number;
  maxItems?: number;
  min?: number;
  max?: number;
  options?: string[];
  default?: unknown;
  group?: "content" | "media" | "buttons" | "layout";
  labelEn?: string;
  itemFields?: SectionField[];
};
export interface SectionTypeDef {
  type: SectionType;
  labelEn: string;
  labelAr: string;
  category: string;
  legacy: boolean;
  restricted: WebsiteCapability | null;
  fields: SectionField[];
}
export interface SectionSettings {
  devices: { desktop: boolean; tablet: boolean; mobile: boolean };
  background: { type: "none" | "light" | "brand" | "dark" | "color" | "image"; color: string; image: WebsiteImageRef; overlay: number };
  spacing: { top: Spacing; bottom: Spacing };
  align: "start" | "center" | "end";
  container: "normal" | "wide" | "full";
  anchorId: string;
}
export type Spacing = "none" | "sm" | "md" | "lg" | "xl";
export interface SectionRegistry {
  types: SectionTypeDef[];
  settings: { devices: string[]; backgroundTypes: string[]; spacing: Spacing[]; align: string[]; containers: string[] };
  defaultSettings: SectionSettings;
}

export type WebsiteImageRef = { url: string; publicId?: string; altEn?: string; altAr?: string } | null;

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
  twitter: { card: string; cardSource: "custom" | "auto"; title: string; description: string; image: string | null; site: string | null };
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
  favicon?: { url: string | null; publicId: string | null };
  logoDark?: { url: string | null; publicId: string | null };
  descriptionEn?: string;
  descriptionAr?: string;
  footerCopyrightEn?: string;
  footerCopyrightAr?: string;
  publishOrgContacts?: boolean;
  contact?: { businessEmail: string; salesEmail: string; officePhone: string; mobilePhone: string; whatsappNumber: string; addressEn: string; addressAr: string; mapEmbedUrl: string };
  socialLinks?: Partial<Record<"facebook" | "instagram" | "linkedin" | "youtube" | "tiktok" | "x", string>>;
  businessHours?: BusinessHoursRow[];
  businessHoursNoteEn?: string;
  businessHoursNoteAr?: string;
  header?: { showCta: boolean; ctaLabelEn: string; ctaLabelAr: string; ctaHref: string; showPhone: boolean; sticky: boolean };
  footer?: { showNewsletter: boolean; showSocial: boolean; showContact: boolean };
  cookieConsent?: { enabled: boolean; messageEn: string; messageAr: string; acceptLabelEn: string; acceptLabelAr: string; policyUrl: string; blockTrackingUntilConsent: boolean };
  robots?: { discourageIndexing: boolean; disallowPaths: string[] };
  updatedAt?: string;
}

export type WeekDay = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
export interface BusinessHoursRow {
  day: WeekDay;
  open?: string;
  close?: string;
  closed?: boolean;
}

export type WebsitePageStatus = "never_published" | "published" | "unpublished" | "archived";
export type WebsiteDisplayStatus = "draft" | "published" | "scheduled" | "archived";
export type WebsitePageLayout = "default" | "landing" | "full-width";
export type WebsitePageType = "managed" | "legacy";

export interface WebsitePage {
  _id: string;
  slug: string;
  path: string;
  isHomePage: boolean;
  pageType: WebsitePageType;
  titleEn: string;
  titleAr: string;
  layout: WebsitePageLayout;
  displayStatus?: WebsiteDisplayStatus;
  scheduledPublishAt?: string | null;
  scheduledRevision?: string | null;
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
  settings?: Partial<SectionSettings>;
  adminLabel?: string;
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
  kind: "image" | "video";
  displayName: string;
  originalName: string;
  mimeType?: string | null;
  duration?: number | null;
  usage?: { total: number; live: number; draft: number } | null;
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

// ---- Navigation (backend utils/website/navigation.js) ----
export interface NavEntry {
  id?: string;
  type: "link" | "group";
  labelEn: string;
  labelAr: string;
  linkType?: "page" | "external";
  pageSlug?: string;
  externalUrl?: string;
  target?: "_self" | "_blank";
  visible?: boolean;
  items?: NavEntry[];
}
export interface FooterColumn {
  id?: string;
  titleEn: string;
  titleAr: string;
  visible?: boolean;
  items: NavEntry[];
}
export interface WebsiteNavigation {
  headerEntries: NavEntry[];
  footerColumns: FooterColumn[];
  warnings?: string[];
  updatedAt?: string;
}

// ---- Integrations (admin only) ----
export type TrackingProvider = "ga4" | "gtm" | "metaPixel" | "googleAds";
export type VerificationProvider = "google" | "bing" | "meta" | "yandex" | "pinterest";
export interface WebsiteIntegrations {
  ga4: { id: string; enabled: boolean };
  gtm: { id: string; enabled: boolean };
  metaPixel: { id: string; enabled: boolean };
  googleAds: { id: string; enabled: boolean };
  verification: Record<VerificationProvider, string>;
  providers: Record<TrackingProvider, { label: string; example: string }>;
  verificationProviders: Record<VerificationProvider, string>;
  updatedAt: string | null;
}

// ---- Custom code (admin only) ----
export type CustomCodeKind = "html" | "css" | "js";
export type CustomCodePlacement = "head" | "body_start" | "body_end";
export interface WebsiteCustomCode {
  _id: string;
  name: string;
  description: string;
  kind: CustomCodeKind;
  placement: CustomCodePlacement;
  scope: "global" | "page";
  page: { _id: string; slug: string; titleEn?: string; titleAr?: string } | string | null;
  code: string;
  isEnabled: boolean;
  sortOrder: number;
  createdBy?: { _id: string; name: string } | string;
  updatedBy?: { _id: string; name: string } | string | null;
  createdAt: string;
  updatedAt: string;
  warnings?: string[];
}

// ---- Activity log ----
export interface WebsiteActivity {
  _id: string;
  actor: string;
  actorName: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  redacted?: boolean;
  createdAt: string;
}

// ---- Overview ----
export interface WebsiteOverviewData {
  pages: { total: number; published: number; draft: number; scheduled: number; archived: number };
  sections: number;
  media: { files: number; bytes: number };
  lastPublished: { slug: string; title: string; at: string } | null;
  upcoming: { pageId: string; slug: string; title: string; at: string }[];
  recentlyEdited: { pageId: string; slug: string; title: string; updatedAt: string; status: WebsiteDisplayStatus }[];
  needsAttention: { pageId: string; slug: string; problems: string[] }[];
  recentActivity: Pick<WebsiteActivity, "_id" | "actorName" | "action" | "targetType" | "targetLabel" | "createdAt">[];
  integrations: { enabled: TrackingProvider[]; customCodeSnippets: number };
  site: { publicSiteUrl: string; languages: WebsiteLocale[]; deployConfigured: boolean; previewConfigured: boolean };
}
