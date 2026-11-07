const asyncHandler = require('express-async-handler');
const multer = require('multer');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { setFileHeaders } = require('../../utils/contentDisposition');
const { decodeUploadName } = require('../../utils/uploadFileName');
const attachmentService = require('../../services/files/attachmentService');

// Commercial project attachments (supplier quotes, site photos, supporting documents). Reuses
// services/files/attachmentService.js's storage/validation wholesale (same private GridFS
// bucket, same per-record size/count limits) - mirrors controller/crm/leadAttachmentController.js
// exactly; this file only adds the Commercial-role permission gate (middleware/commercialAccess.js,
// wired in routes/commercial/projectAttachmentRoute.js).

const OWNER_KEY = 'commercial-projects';

exports.receiveFiles = (req, res, next) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: attachmentService.maxBytes(), files: attachmentService.maxFiles(), fields: 10 } }).array(
    'files',
    attachmentService.maxFiles()
  );
  upload(req, res, err => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new ApiError(`The file is larger than the ${Math.round((attachmentService.maxBytes() / 1048576) * 10) / 10} MB limit.`, 413));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
        return next(new ApiError(`Attach at most ${attachmentService.maxFiles()} files at a time, in the "files" field.`, 400));
    }
    return next(new ApiError('The upload could not be read.', 400));
  });
};

exports.listAttachments = asyncHandler(async (req, res) => {
  const data = await attachmentService.listAttachments(OWNER_KEY, req.params.projectId);
  res.status(200).json({ results: data.length, data, limits: { maxBytes: attachmentService.maxBytes(), maxFiles: attachmentService.maxFiles() } });
});

exports.uploadAttachments = asyncHandler(async (req, res) => {
  const files = (req.files || []).map(f => ({ ...f, originalname: decodeUploadName(f.originalname) }));
  const data = await attachmentService.uploadAttachments({ ownerKey: OWNER_KEY, ownerId: req.params.projectId, files, userId: req.user._id });
  res.status(201).json(apiResponse('Attachment uploaded', true, data));
});

exports.downloadAttachment = asyncHandler(async (req, res) => {
  const { attachment, owner } = await attachmentService.getAttachment(req.params.id);
  if (owner?.ownerType !== 'CommercialProject') throw new ApiError('Attachment not found.', 404);
  const { stream, size } = await attachmentService.openFile(attachment);
  setFileHeaders(res, { fileName: attachment.originalName, contentType: attachment.contentType, size, inline: req.query.inline === '1' || req.query.inline === 'true' });
  stream.on('error', err => (res.headersSent ? res.destroy(err) : res.status(500).json({ success: false, message: 'Could not read the attachment.' })));
  stream.pipe(res);
});

exports.deleteAttachment = asyncHandler(async (req, res) => {
  const { attachment, owner } = await attachmentService.getAttachment(req.params.id);
  if (owner?.ownerType !== 'CommercialProject') throw new ApiError('Attachment not found.', 404);
  await attachmentService.deleteAttachment(attachment);
  res.status(200).json(apiResponse('Attachment removed', true, { _id: attachment._id }));
});
