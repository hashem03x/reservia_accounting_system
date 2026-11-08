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
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const WebsiteSettings = model('WebsiteSettings', websiteSettingsSchema);
WebsiteSettings.SINGLETON_ID = SINGLETON_ID;

module.exports = WebsiteSettings;
