'use strict';

const sanitizeHtml = require('sanitize-html');

// Website Management - the real, allowlist-based defense for blog post bodies (the one field in
// this codebase that is deliberately meant to carry rich HTML from the CMS's TipTap editor, not
// plain text). Every other website-management text field is rendered as a React child on the
// public site (never `dangerouslySetInnerHTML`) or is admin-only trusted Custom Code (access-gated,
// not sanitized - see websiteCustomCodeModel.js's own header comment) - this is the first and only
// place genuinely user-authored HTML needs real sanitization. Called on SAVE (blogPostController.js
// create/update), never on read, so revisions always store already-sanitized HTML.
const ALLOWED_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'hr', 'a', 'img', 'br'];

function sanitizeBlogBody(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt'] },
    allowedSchemes: ['https'],
    allowedSchemesByTag: { img: ['https'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
}

module.exports = { sanitizeBlogBody, ALLOWED_TAGS };
