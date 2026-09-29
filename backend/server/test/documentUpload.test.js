const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPdfFile } = require('../middleware/documentUploadMiddleware');

test('accepts a file with both a PDF mimetype and a .pdf extension', () => {
  assert.equal(isPdfFile({ mimetype: 'application/pdf', originalname: 'commercial-registration.pdf' }), true);
});

test('rejects a non-PDF mimetype even with a .pdf extension (spoofed extension)', () => {
  assert.equal(isPdfFile({ mimetype: 'image/png', originalname: 'document.pdf' }), false);
});

test('rejects a PDF mimetype with a non-.pdf extension (spoofed mimetype)', () => {
  assert.equal(isPdfFile({ mimetype: 'application/pdf', originalname: 'document.exe' }), false);
});

test('rejects a plain image upload', () => {
  assert.equal(isPdfFile({ mimetype: 'image/jpeg', originalname: 'photo.jpg' }), false);
});

test('extension check is case-insensitive', () => {
  assert.equal(isPdfFile({ mimetype: 'application/pdf', originalname: 'FILE.PDF' }), true);
});

test('handles a missing filename without throwing', () => {
  assert.equal(isPdfFile({ mimetype: 'application/pdf', originalname: undefined }), false);
});
