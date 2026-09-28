const { Schema, model } = require('mongoose');



const invoiceSchema = new Schema({
    poNumber: { type: Schema.Types.ObjectId,ref:'PurchaseOrder', required: true },          // Reference to the PO number
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },  // Vendor who issued the invoice
    invoiceNumber: { type: String, required: true, unique: true },  // Invoice number
    invoiceDate: { type: Date, required: true },         // Invoice date
    totalAmount: { type: Number, required: true },       // Total amount billed
    paymentStatus: { type: String, enum: ['unpaid', 'partially_paid', 'paid'], default: 'unpaid' },  // Payment status
    dueDate: { type: Date },                             // Due date for payment
    payments: [{                                         // Payments associated with this invoice
      paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
      amount: { type: Number }
    }]
  });



module.exports = new model('Invoice', invoiceSchema);
  