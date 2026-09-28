const  mongooseI18n  = require('mongoose-i18n-Localize');

const {Schema, model} = require('mongoose');


const imageSchema = Schema({
   productId:{type:Schema.Types.ObjectId, ref:'Product', required:true},
   variantId:{type:Schema.Types.ObjectId, ref:'Variant', required:true},
    images:[
        {
        url:{type:String},
        publicId:{type:String}
    }],
    
    isAvailable: {
        type: Boolean,
        default: true
    }
    }, {
         timestamps:true,
         toJson:{virtuals:true},
         toObject:{virtuals:true}
    });

imageSchema.plugin(mongooseI18n, { locales: ['en', 'ar'] }, {defaultLocale: process.env.DEFAULT_LOCALE || 'en'} );

module.exports = model('Image', imageSchema);