const { Schema, model } = require('mongoose');

// Website Management - tracking/pixel integrations, a singleton document (mirrors
// companyCapitalModel.js's "one document per fixed _id" convention). The Meta Conversions API
// access token is the one secret this feature stores at rest - select:false here (belt) plus
// every controller response built from an explicit field allow-list (suspenders, see
// utils/website/secretCipher.js's header comment and controller/website/integrationController.js)
// - "never expose access tokens in frontend code" must hold even if some future code path adds
// `.select('+accessTokenCipher')` by mistake. The build-content endpoint
// (controller/website/buildContentController.js) never includes metaCapi in its response at all -
// the static website build has no legitimate need for it; server-side CAPI forwarding, if ever
// built, reads the decrypted token directly from this model over an authenticated backend path.
const SINGLETON_ID = 'website-integrations';

const providerSchema = new Schema(
  {
    id: { type: String, trim: true, default: '' },
    enabled: { type: Boolean, default: false },
  },
  { _id: false }
);

const websiteIntegrationSchema = new Schema(
  {
    _id: { type: String, default: SINGLETON_ID },
    ga4: { type: providerSchema, default: () => ({}) },
    gtm: { type: providerSchema, default: () => ({}) },
    metaPixel: { type: providerSchema, default: () => ({}) },
    googleAds: { type: providerSchema, default: () => ({}) },
    // Site-ownership verification meta tags (content values only - the tag itself is generated).
    verification: {
      google: { type: String, trim: true, default: '' },
      bing: { type: String, trim: true, default: '' },
      meta: { type: String, trim: true, default: '' },
      yandex: { type: String, trim: true, default: '' },
      pinterest: { type: String, trim: true, default: '' },
    },
    metaCapi: {
      enabled: { type: Boolean, default: false },
      accessTokenCipher: { type: String, select: false, default: null },
      accessTokenLast4: { type: String, default: null },
      accessTokenSetAt: { type: Date, default: null },
      accessTokenSetBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const WebsiteIntegration = model('WebsiteIntegration', websiteIntegrationSchema);
WebsiteIntegration.SINGLETON_ID = SINGLETON_ID;

module.exports = WebsiteIntegration;
