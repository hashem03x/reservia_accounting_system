const { Schema, model } = require('mongoose');

// Website Management - the site-wide header/footer navigation, a singleton document (mirrors
// companyCapitalModel.js's "one document per fixed _id" convention). `headerEntries`/
// `footerColumns` are Mixed, a tagged-union shape mirroring the website's own
// src/config/navigation.ts `NavEntry` type exactly: {type:'link', labelEn, labelAr, pageSlug |
// externalUrl} | {type:'group', labelEn, labelAr, items:[...]}.
const SINGLETON_ID = 'main-nav';

const websiteNavigationSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    headerEntries: { type: [Schema.Types.Mixed], default: [] },
    footerColumns: { type: [Schema.Types.Mixed], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const WebsiteNavigation = model('WebsiteNavigation', websiteNavigationSchema);
WebsiteNavigation.SINGLETON_ID = SINGLETON_ID;

module.exports = WebsiteNavigation;
