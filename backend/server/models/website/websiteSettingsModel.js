const { Schema, model } = require('mongoose');

// Website Management - site-wide settings, a singleton document (mirrors companyCapitalModel.js's
// "one document per fixed _id" convention). Maps 1:1 onto Reservia_Website's existing
// src/config/contactDefaults.ts fields - the exact same business data it already hardcodes, now
// editable from the CMS instead.
const SINGLETON_ID = 'website-settings';

const websiteSettingsSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    siteNameEn: { type: String, trim: true, default: '' },
    siteNameAr: { type: String, trim: true, default: '' },
    taglineEn: { type: String, trim: true, default: '' },
    taglineAr: { type: String, trim: true, default: '' },
    logo: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    defaultOgImage: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
    },
    contact: {
      businessEmail: { type: String, trim: true, default: '' },
      salesEmail: { type: String, trim: true, default: '' },
      officePhone: { type: String, trim: true, default: '' },
      mobilePhone: { type: String, trim: true, default: '' },
      whatsappNumber: { type: String, trim: true, default: '' },
      addressEn: { type: String, trim: true, default: '' },
      addressAr: { type: String, trim: true, default: '' },
      mapEmbedUrl: { type: String, trim: true, default: '' },
    },
    socialLinks: {
      facebook: { type: String, trim: true, default: '' },
      instagram: { type: String, trim: true, default: '' },
      linkedin: { type: String, trim: true, default: '' },
      youtube: { type: String, trim: true, default: '' },
      tiktok: { type: String, trim: true, default: '' },
    },
    footerCopyrightEn: { type: String, trim: true, default: '' },
    footerCopyrightAr: { type: String, trim: true, default: '' },
    publishOrgContacts: { type: Boolean, default: false },

    // ---- SEO brief 2.1/2.2: domain and languages ----
    // The public origin every canonical/hreflang/sitemap URL is built on, e.g.
    // "https://reservia-energy.com" (no trailing slash). Empty = the website build's own
    // VITE_SITE_URL is used; nothing absolute is generated from a guess.
    publicSiteUrl: { type: String, trim: true, maxlength: 200, default: '' },
    // Arabic is the default language (brief 2.2); English is secondary.
    defaultLocale: { type: String, enum: ['ar', 'en'], default: 'ar' },
    enabledLocales: { type: [{ type: String, enum: ['ar', 'en'] }], default: ['ar', 'en'] },

    // ---- SEO defaults ----
    // "%s" is replaced by the page title, e.g. "%s | Reservia". Empty = the title is used as-is.
    titleTemplateEn: { type: String, trim: true, maxlength: 80, default: '' },
    titleTemplateAr: { type: String, trim: true, maxlength: 80, default: '' },
    defaultDescriptionEn: { type: String, trim: true, maxlength: 160, default: '' },
    defaultDescriptionAr: { type: String, trim: true, maxlength: 160, default: '' },
    twitterHandle: { type: String, trim: true, maxlength: 30, default: '' },

    // ---- Structured data: Organization / LocalBusiness (brief 5.1) ----
    // Only what an administrator actually enters is ever emitted - no field here has a
    // business value as its default. `schemaType` 'Organization' unless the business details
    // support a LocalBusiness subtype.
    organization: {
      schemaType: { type: String, enum: ['Organization', 'LocalBusiness', 'ProfessionalService', 'HomeAndConstructionBusiness'], default: 'Organization' },
      legalName: { type: String, trim: true, maxlength: 200, default: '' },
      descriptionEn: { type: String, trim: true, maxlength: 500, default: '' },
      descriptionAr: { type: String, trim: true, maxlength: 500, default: '' },
      foundingDate: { type: String, trim: true, maxlength: 10, default: '' },
      streetAddress: { type: String, trim: true, maxlength: 200, default: '' },
      addressLocality: { type: String, trim: true, maxlength: 100, default: '' },
      addressRegion: { type: String, trim: true, maxlength: 100, default: '' },
      postalCode: { type: String, trim: true, maxlength: 20, default: '' },
      addressCountry: { type: String, trim: true, maxlength: 2, default: '' },
      priceRange: { type: String, trim: true, maxlength: 10, default: '' },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const WebsiteSettings = model('WebsiteSettings', websiteSettingsSchema);
WebsiteSettings.SINGLETON_ID = SINGLETON_ID;

module.exports = WebsiteSettings;
