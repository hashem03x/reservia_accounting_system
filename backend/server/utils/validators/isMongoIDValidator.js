const validatorMiddleware = require('../../middleware/validatorMiddleware');

exports.isMongoId = [check('id').notEmpty().withMessage('is_required').isMongoId().withMessage('invalid_MongoId'), validatorMiddleware];
