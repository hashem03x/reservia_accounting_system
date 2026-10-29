const asyncHandler = require('express-async-handler');
const Quotation = require('../../models/crm/quotationModel');
const apiResponse = require('../../utils/apiResponse');
const quotationService = require('../../services/crm/quotationService');

exports.listQuotationsForLead = asyncHandler(async (req, res) => {
  const quotations = await Quotation.find({ lead: req.params.leadId }).sort({ version: -1 });
  res.status(200).json(apiResponse('Quotations retrieved successfully', true, quotations));
});

exports.createQuotation = asyncHandler(async (req, res) => {
  const quotation = await quotationService.createQuotation(req.params.leadId, req.body, { userId: req.user._id });
  res.status(201).json(apiResponse('Quotation created successfully', true, quotation));
});

exports.sendQuotation = asyncHandler(async (req, res) => {
  const quotation = await quotationService.sendQuotation(req.params.id, { userId: req.user._id, role: req.crmRole });
  res.status(200).json(apiResponse('Quotation sent successfully', true, quotation));
});

exports.acceptQuotation = asyncHandler(async (req, res) => {
  const quotation = await quotationService.acceptQuotation(req.params.id);
  res.status(200).json(apiResponse('Quotation accepted successfully', true, quotation));
});
