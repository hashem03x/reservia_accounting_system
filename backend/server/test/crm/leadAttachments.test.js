const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Change Request 1, Feature 7: "Current: phone-created lead 10MB, website-created lead 4MB
// (inconsistent). Required: unified 10MB max per file across ALL lead creation channels, PDF AND
// images supported." Every lead-creation channel already shares the ONE
// services/files/attachmentService.js pipeline (routes/crm/leadAttachmentRoute.js) - this exercises
// that shared service directly for the 'crm-leads' owner, and confirms PO/SO/journal-entry
// attachments (a separate owner config) are untouched and still PDF-only.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Lead, attachmentService, leadService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  require('../../models/crm/activityModel');
  require('../../models/system/attachmentModel');
  await Lead.init();
  leadService = require('../../services/crm/leadService');
  attachmentService = require('../../services/files/attachmentService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  delete process.env.ATTACHMENT_MAX_MB;
  delete process.env.ATTACHMENT_MAX_FILES;
});

const pdf = (label, size = 64) => Buffer.concat([Buffer.from(`%PDF-1.7\n%${label}\n`), crypto.randomBytes(size), Buffer.from('\n%%EOF\n')]);
const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(size)]);
const png = (size = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(size)]);
const webp = (size = 64) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), crypto.randomBytes(size)]);
const file = (name, buffer, mimetype) => ({ originalname: name, mimetype, buffer });

maybeTest('maxBytes: flat 10MB by default, no more Vercel-specific 4MB special case', () => {
  delete process.env.ATTACHMENT_MAX_MB;
  const originalVercel = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    assert.equal(attachmentService.maxBytes(), 10 * 1024 * 1024, 'the limit is the SAME whether or not VERCEL is set');
    delete process.env.VERCEL;
    assert.equal(attachmentService.maxBytes(), 10 * 1024 * 1024);
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  }
});

maybeTest('crm-leads: a PDF attaches exactly as before', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01033334444', channel: 'phone', name: 'Attachment Test' }, {});
  const list = await attachmentService.uploadAttachments({ ownerKey: 'crm-leads', ownerId: lead._id, files: [file('bill.pdf', pdf('bill'), 'application/pdf')] });
  assert.equal(list.length, 1);
  assert.equal(list[0].contentType, 'application/pdf');
});

maybeTest('crm-leads: JPEG, PNG and WEBP images all attach - "PDF AND images supported"', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01033335555', channel: 'phone', name: 'Image Test' }, {});
  const files = [file('meter.jpg', jpeg(), 'image/jpeg'), file('meter.png', png(), 'image/png'), file('meter.webp', webp(), 'image/webp')];
  const list = await attachmentService.uploadAttachments({ ownerKey: 'crm-leads', ownerId: lead._id, files });
  assert.equal(list.length, 3);
  const types = list.map(a => a.contentType).sort();
  assert.deepEqual(types, ['image/jpeg', 'image/png', 'image/webp']);
});

maybeTest('crm-leads: a renamed non-image/non-PDF file (wrong magic bytes) is refused even with an image extension and declared type', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01033336666', channel: 'phone' }, {});
  const disguised = file('meter.jpg', Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(100)]), 'image/jpeg');
  await assert.rejects(
    () => attachmentService.uploadAttachments({ ownerKey: 'crm-leads', ownerId: lead._id, files: [disguised] }),
    /different format/
  );
});

maybeTest('crm-leads: real JPEG bytes named/declared as PNG are refused - content must match the declared image type, not just the extension', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01033337777', channel: 'phone' }, {});
  await assert.rejects(
    () => attachmentService.uploadAttachments({ ownerKey: 'crm-leads', ownerId: lead._id, files: [file('meter.png', jpeg(), 'image/png')] }),
    /does not match/
  );
});

maybeTest('crm-leads: an image extension that does not match the declared mimetype at all is refused', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01033337788', channel: 'phone' }, {});
  await assert.rejects(
    () => attachmentService.uploadAttachments({ ownerKey: 'crm-leads', ownerId: lead._id, files: [file('meter.jpg', png(), 'image/png')] }),
    /extension does not match/
  );
});

maybeTest('crm-leads: a 10MB file is accepted, a file over 10MB is refused - the unified limit from Feature 7', async () => {
  const { lead } = await leadService.intakeLead({ phone: '01033338888', channel: 'phone' }, {});
  const tenMb = file('big.pdf', pdf('big', 10 * 1024 * 1024 - 200), 'application/pdf');
  const list = await attachmentService.uploadAttachments({ ownerKey: 'crm-leads', ownerId: lead._id, files: [tenMb] });
  assert.equal(list.length, 1);

  const { lead: lead2 } = await leadService.intakeLead({ phone: '01033339999', channel: 'phone' }, {});
  const overLimit = file('toobig.pdf', pdf('toobig', 10 * 1024 * 1024 + 500), 'application/pdf');
  await assert.rejects(
    () => attachmentService.uploadAttachments({ ownerKey: 'crm-leads', ownerId: lead2._id, files: [overLimit] }),
    /larger than the 10 MB limit/
  );
});

maybeTest('purchase-orders/sales-orders/journal-entries: allowImages is per-owner, not global - these three stay PDF-only (Feature 7 only extends crm-leads)', () => {
  assert.equal(attachmentService.OWNERS['purchase-orders'].allowImages, false);
  assert.equal(attachmentService.OWNERS['sales-orders'].allowImages, false);
  assert.equal(attachmentService.OWNERS['journal-entries'].allowImages, false);
  assert.equal(attachmentService.OWNERS['crm-leads'].allowImages, true);
});
