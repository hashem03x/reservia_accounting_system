const asyncHandler = require('express-async-handler');

const ApiError = require('../utils/apiError');
const ApiFeatures = require('../utils/apiFeatures');

exports.deleteOne = (Model, key = false) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const document = await Model.findByIdAndDelete(id);

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    if (key) return document;

    // Trigger "remove" event when update document to get review details
    // Model.remove();
    res.status(204).send();
  });

exports.updateOne = (Model, key = false) =>
  asyncHandler(async (req, res, next) => {
    const document = await Model.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      {
        new: true,
      }
    );
    if (!document) {
      return next(new ApiError(`No document for this id ${req.params.id}`, 404));
    }

    let localizedDocs = document;
    // if (Model.schema.methods.toJSONLocalizedOnly) localizedDocs = Model.schema.methods.toJSONLocalizedOnly(document, req.language || 'en');
    if (Model.schema.methods.toJSONLocalized) localizedDocs = Model.schema.methods.toJSONLocalized(document, req.language || 'en');

    if (key) return localizedDocs;

    res.status(200).json({ data: localizedDocs });
  });

exports.createOne = (Model, key = false) =>
  asyncHandler(async (req, res) => {
    // console.log(req.body);
    const document = await Model.create(req.body);

    let localizedDocs = document;
    // if (Model.schema.methods.toJSONLocalizedOnly) localizedDocs = Model.schema.methods.toJSONLocalizedOnly(document, req.language || 'en');
    if (Model.schema.methods.toJSONLocalized) localizedDocs = Model.schema.methods.toJSONLocalized(document, req.language || 'en');

    if (key) return localizedDocs;

    res.status(201).json({ data: localizedDocs });
  });

exports.createMany = (Model, key = false) =>
  asyncHandler(async (req, res) => {
    // req.body= Array.isArray(req.body) ? req.body : [req.body]
    const document = await Model.insertMany(req.body);

    let localizedDocs = document;

    if (Model.schema.methods.toJSONLocalized) localizedDocs = Model.schema.methods.toJSONLocalized(document, req.language || 'en');

    if (key) return localizedDocs;

    res.status(201).json({ data: localizedDocs });
  });

exports.getOne = (Model, populateOpt, key = false) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;

    let query = Model.findById(id);

    // {path , select}
    // const lenPopulate = Object.keys(populateOpt)?.length;

    if (populateOpt) {
      query = query.populate(populateOpt);
    }

    const document = await query;
    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    let localizedDocs = document;
    // if (Model.schema.methods.toJSONLocalizedOnly) localizedDocs = Model.schema.methods.toJSONLocalizedOnly(document, req.language || 'en');
    if (Model.schema.methods.toJSONLocalized) localizedDocs = Model.schema.methods.toJSONLocalized(document, req.language || 'en');

    if (key) return localizedDocs;

    res.status(200).json({ data: localizedDocs });
  });

// `transform`, when given, is an optional async hook applied to the page's results right before
// they're sent (e.g. to label each row with extra batched-query data). Every caller of getAll()
// that omits it is unaffected - nothing about the existing response shape/behavior changes.
exports.getAll = (Model, modelName = '', populateOpt = ' ', key = false, transform = null) =>
  asyncHandler(async (req, res) => {
    // Language to search by multiple languages
    const accept_lang = req.headers['accept-language'];

    let lang;
    // en-US,en;q=0.9 => en-US => en
    if (accept_lang) lang = accept_lang.split(',')[0].split('-')[0];
    else lang = 'en';

    req.query.lang = lang;

    // Build query
    const countDocments = await Model.countDocuments(req.filterObject);

    const mongoosequery = Model.find(req.filterObject);

    const apiFeatures = new ApiFeatures(mongoosequery, req.query).paginate(countDocments).sort().search(modelName).filter(req.filterObject).limitFields();

    // Execute query
    const { mongooseQuery, paginationResult } = apiFeatures;
    const document = await mongooseQuery;

    let localizedDocs = document;

    if (Model.schema.methods.toJSONLocalizedOnly && document.length) {
      localizedDocs = Model.schema.methods.toJSONLocalized(document, req.language || 'en');
    }

    if (transform) {
      localizedDocs = await transform(localizedDocs, req);
    }

    if (key) return localizedDocs;

    res.status(200).json({
      results: localizedDocs.length,
      paginationResult,
      data: localizedDocs,
    });
  });
