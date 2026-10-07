const mongooseI18n  = require('mongoose-i18n-localize')

const {Schema, model} = require('mongoose');


const colorSchema = Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    code: {
        type: String,
        trim: true,
    },
    imageCover: {
        url: { type: String },
        publicId: { type: String },
        // required: [true, 'Product Image cover is required'],
    },
    images:[
        {
        url:{type:String},
        publicId:{type:String}
    }],

    isDeleted: {
        type: Boolean,
        default: false
    },
    
    isAvailable: {
        type: Boolean,
        default: true
    }

    }, {
         timestamps:true,
         toJson:{virtuals:true},
         toObject:{virtuals:true}
    });

    
colorSchema.plugin(mongooseI18n, { locales: ['en', 'ar'] }, {defaultLocale: process.env.DEFAULT_LOCALE || 'en'} );

module.exports = model('Color', colorSchema);