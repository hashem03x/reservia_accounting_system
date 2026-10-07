const mongooseI18n = require('mongoose-i18n-localize');

const {Schema, model} = require('mongoose');
const { findOneAndUpdate } = require('../userRoleModel');


const sizeSchema = Schema({

    size:{  // size name or number
        type:String,
        required:true,
    },
    sku:{
        type:String,
        required:true,
        unique:true
    },
    variantId:{
        type:Schema.Types.ObjectId,
        ref:'Variant',
        required:true
    },
    // size stock  quantity
    stock:[{
        quantity:{
            type:Number,
            default:0
        },
        warehouse:{ // move from location a to location b
            type:Schema.Types.ObjectId,
            ref:'Warehouse',
            required:true
        }
        
    }],

    stockLevel:{
        type:Number,
        default:0
    }


}, {
    timestamps:true,
    toJson:{virtuals:true},
    toObject:{virtuals:true}

})

sizeSchema.pre('save', function(next) {
// pre save hook to calculate stock level
  this.stockLevel = 
        this.stock.reduce((acc, curr) => acc + curr.quantity, 0);

    next();
})

// pre find or update or delete
sizeSchema.post('findOneAndUpdate', function(next) {
    // update stock level
    if(this.isModified('stock')){
        this.stockLevel = 
        this.stock.reduce((acc, curr) => acc + curr.quantity, 0);
    }

      next();
   
})

sizeSchema.plugin(mongooseI18n, { locales: ['en', 'ar'] }, {defaultLocale: process.env.DEFAULT_LOCALE || 'en'} );

module.exports = model('Size', sizeSchema);

