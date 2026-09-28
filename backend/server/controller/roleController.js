const userRoleModel = require('../models/userRoleModel')
const factoryHandler = require('./handlersFactory')

exports.createRole = factoryHandler.createOne(userRoleModel)