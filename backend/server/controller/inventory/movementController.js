const asyncHandler = require('express-async-handler')

const Movement = require('../../models/inventory/stockMovement')
const Product = require('../../models/inventory/productModel');
const factory = require('../handlersFactory');
const variantModel = require('../../models/inventory/variantModel');

/* Create a movement
* @params: req.body
* @returns: movement object
* @route : POST: api/v1/inventory/movement
* @access: private  
* @data ex1: {
*           "type": "product",
*           "from": "60e4e4f5d4f4b30015c3c0e9",
// *           "to": "60e4e4f5d4f4b30015c3c0e9",
*           "status": "sale",
*           "quantity": 10,
*           "reference": "60e4e4f5d4f4b30015c3c0e9",
*           "variant": "60e4e4f5d4f4b30015c3c0e9",
*           "reason": "sale"
*         },
* @data ex2: {
*           "type": "variants",
*           "from": "60e4e4f5d4f4b30015c3c0e9",
*           "to": "60e4e4f5d4f4b30015c3c0e9",
*           "status": "restock",
*           "quantity": 10,
*           "reference": "60e4e4f5d4f4b30015c3c0e9",
*           "variant": "60e4e4f5d4f4b30015c3c0e9",
*           "reason": "restock"
*         },
@data ex3: {
*           "type": "product",
*           "from": "60e4e4f5d4f4b30015c3c0e9",
*           "to": "60e4e4f5d4f4b30015c3c0e9",
*           "status": "transfer",
*           "quantity": 10,
*           "reference": "60e4e4f5d4f4b30015c3c0e9",
*           "variant": "60e4e4f5d4f4b30015c3c0e9",
*           "reason": "transfer"
*         },
* @method: POST

*/
function updateProductStock(variants, warehouse){
    // update stock
    // variants [{variant: '60e4e4f5d4f4b30015c3c0e9', quantity: 10}]

    return variants.map(variant => {
        // get Variant in first
          const stock = variantModel.findById(variant).select('stock sotckLevel')
          variant.stock.map(s =>  s.warehouse = warehouse )
            // {
            //  s.warehouse = warehouse;
        //  }
        return {variant:variant._id, quantity: variant.stockLevel};
    })


   

}

function updateVariantStock(variants, from, to){

    variants.map((variant) => {
        const stock = variantModel.findById(variant.variant).select('stock');

        stock.map(s => {
            let key = false;
                if(s.warehouse === from && variant.quantity <= s.quantity){
                    s.quantity -= variant.quantity;
                    key = true;
                } else if (s.warehouse === to && key){
                    s.quantity += variant.quantity;
                    key = false;
                }
        })
        stock.save();
    })
}
// type = product or variants  // 
exports.createMovement = asyncHandler(async(req, res, next) =>{
    // console.log(req.body);
    let {type, from, to, status, quantity, reference, variants, reason} = req.body;
    // let toType;

    variants =Array.isArray(variants) ? variants : [variants];


    if(!type || !from || !to || !quantity || !reference){
        return res.status(400).json({success: false, message: 'Please provide all required fields'})
    }

    // if(status === 'sale') toType = 'User';
    // else toType = 'Warehouse';

    let movement ;
    // req.body = {
    //     type, from, to, toType, status, quantity, reference, reason
    // }
    // req.body.toType = toType;
    const product = await Product.findById(reference);
    if(!product) return res.status(404).json({success: false, message: 'Product not found'});

    if(type === 'product'){

         let variants = product.variants;

          variants = updateProductStock(variants, to);   //[{variant: 2333, quantity:10}]

         // variants [{variant: '60e4e4f5d4f4b30015c3c0e9', quantity: 10}]

        // req.body = {
        //     type, from, to, toType, status, quantity, reference, variants, reason
        // }
        req.body.variants = variants;

        const productMovement = await factory.createOne(Movement, key=true)(req, res, next);
        movement = productMovement;
    }  else{


       
        const variantMovement = await factory.createOne(Movement, key=true)(req, res, next);
        movement = variantMovement;

    }

    if (type === 'product') {
        return res.status(400).json({success: false, message: 'Please provide all required fields'})
    }

});


exports.getAllMovement = factory.getAll(Movement);


exports.getMovement = factory.getOne(Movement);

exports.updateMovement = factory.updateOne(Movement);


exports.deleteMovement = factory.deleteOne(Movement);