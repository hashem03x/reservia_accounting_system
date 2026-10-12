const asyncHandler = require('express-async-handler');
const multer = require('multer');
const ApiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');
const { Actions } = require('../utils/appConstant');
const { setFileHeaders } = require('../utils/contentDisposition');
const service = require('../services/files/attachmentService');
const { decodeUploadName } = require('../utils/uploadFileName');

// PDF attachments of purchase orders, sales orders and journal entries
// (services/files/attachmentService.js holds every rule). Each request is allowed only with the
// permission of the record the file belongs to: read to list / preview / download, update to
// attach or remove. Requests by attachment id look the owner up first, so a guessed id gives
// nothing more than the record's own permissions allow.

const userCan = (user, resource, action) => user?.role === 'admin' || (user?.permissions || []).some(p => p.resource === resource && p.actions.includes(action));
const assertCan = (req, resource, action) => {
  if (!userCan(req.user, resource, action)) throw new ApiError('You are not allowed to access this resource', 403);
};

/** Route guard for /:ownerKey/:ownerId routes. */
exports.guardOwner = action => (req, res, next) => {
  try {
    assertCan(req, service.ownerOf(req.params.ownerKey).resource, action);
    next();
  } catch (err) {
    next(err);
  }
};

// Multipart parsing in memory (each file is validated before anything is stored). Sizes over the
// limit are cut off by multer itself, so an oversized upload is never fully buffered.
exports.receiveFiles = (req, res, next) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: service.maxBytes(), files: service.maxFiles(), fields: 10 } }).array('files', service.maxFiles());
  upload(req, res, err => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(`The file is larger than the ${Math.round((service.maxBytes() / 1048576) * 10) / 10} MB limit.`, 413));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
        return next(new ApiError(`Attach at most ${service.maxFiles()} files at a time, in the "files" field.`, 400));
    }
    return next(new ApiError('The upload could not be read.', 400));
  });
};

exports.listAttachments = asyncHandler(async (req, res) => {
  const data = await service.listAttachments(req.params.ownerKey, req.params.ownerId);
  res.status(200).json({ results: data.length, data, limits: { maxBytes: service.maxBytes(), maxFiles: service.maxFiles() } });
});

exports.uploadAttachments = asyncHandler(async (req, res) => {
  const data = await service.uploadAttachments({
    ownerKey: req.params.ownerKey,
    ownerId: req.params.ownerId,
    files: (req.files || []).map(f => ({ ...f, originalname: decodeUploadName(f.originalname) })),
    userId: req.user._id,
  });
  res.status(201).json(apiResponse('Attachment uploaded', true, data));
});

// GET /attachments/:id/download[?inline=1] - the file with its real name and type. `inline=1`
// opens it in the browser (preview); otherwise the browser saves it.
exports.downloadAttachment = asyncHandler(async (req, res) => {
  const { attachment, owner } = await service.getAttachment(req.params.id);
  assertCan(req, owner.resource, Actions.read);
  const { stream, size } = await service.openFile(attachment);
  setFileHeaders(res, { fileName: attachment.originalName, contentType: attachment.contentType, size, inline: req.query.inline === '1' || req.query.inline === 'true' });
  stream.on('error', err => (res.headersSent ? res.destroy(err) : res.status(500).json({ success: false, message: 'Could not read the attachment.' })));
  stream.pipe(res);
});

exports.deleteAttachment = asyncHandler(async (req, res) => {
  const { attachment, owner } = await service.getAttachment(req.params.id);
  assertCan(req, owner.resource, Actions.update);
  await service.deleteAttachment(attachment);
  res.status(200).json(apiResponse('Attachment removed', true, { _id: attachment._id }));
});

exports.userCan = userCan;
