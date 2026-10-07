const asyncHandler = require('express-async-handler');
const factory = require('./handlersFactory');

const Governorate = require('../models/governorateModel');

exports.getGovernorates = factory.getAll(Governorate);

exports.getGovernorateById = factory.getOne(Governorate);

exports.createGovernorate = factory.createOne(Governorate);

exports.updateGovernorate = factory.updateOne(Governorate);

exports.deleteGovernorate = factory.deleteOne(Governorate);
