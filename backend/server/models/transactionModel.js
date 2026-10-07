const { Schema, model } = require('mongoose');

// const TransactionType = ['payment', 'refund', 'void'];
const TransactionType = ['payment', 'refund', 'void'];

const transactionSchema = new Schema(
  {
    transactionId: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    transactionType: {
      type: String,
      enum: TransactionType,
    },
    pending: {
      type: Boolean,
      required: true,
    },
    success: {
      type: Boolean,
      required: true,
    },
    orderId: {
      type: String,
      required: true,
    },
    is_refund: {
      type: Boolean,
    },
    is_void: {
      type: Boolean,
    },
    userId: {
      type: String,
      required: true,
      ref: 'User',
    },
    created_at: {
      type: Date,
    },
    cartItems: [
      {
        product: {
          type: Schema.ObjectId,
          ref: 'Product',
        },
        quantity: Number,
        color: String,
        price: Number,
        size: String,
      },
    ],
  },
  { timestamps: true }
);

module.exports = model('Transaction', transactionSchema);
