const mongoose = require('mongoose');

const movementSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1']
  },
  fromLocation: {
    type: String,
    required: true
  },
  toLocation: {
    type: String,
    required: function(){
      return this.movementType === 'transfer';
    },
    validate: {
      validator: function(value) {
        return value !== this.fromLocation;
      },
      message: 'From and to locations must be different'
    }
  },
  movementType: {
    type: String,
    enum: ['transfer', 'sale', 'return'],
    required: true
  },
  date: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isDeleted: {
    type: Boolean,
    default: false,
  }
});

module.exports = mongoose.model('Movement', movementSchema);
