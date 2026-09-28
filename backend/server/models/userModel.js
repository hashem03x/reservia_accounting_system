const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { moderatorPermission, userPermission, operatorPermission } = require('../utils/appConstant');

const userSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    phone: {
      type: String,
      sparse: true,
      unique: true,
      // required: [true, 'Phone number is required'],
      // required: function () { return this.type === 'offline' },
    },

    additionalPhone: String,

    email: {
      type: String,
      sparse: true,
      lowercase: true,
      unique: true,
      // required: function () {
      //   return this.type === 'online';
      // },
    },

    password: {
      type: String,
      // required: function () {
      //   return this.type === 'online';
      // },
      sparse: true,
      default: undefined,
    },

    role: { type: String, default: 'user', enum: ['user', 'moderator', 'operator', 'admin'] },

    // We need to store the permissions for each 'moderator' and 'operator'.
    permissions: [
      {
        resource: { type: String, required: true }, // Resource (e.g., 'product', 'post')
        actions: [{ type: String, required: true }], // Actions (e.g., 'create', 'read', 'update', 'delete')
      },
    ],

    type: { type: String, enum: ['online', 'offline'], default: 'online', required: true },

    isGuest: { type: Boolean, default: false }, // true for guest users who checkout without registering

    balance: { type: Number, default: 0 },

    isDeleted: { type: Boolean, default: false },

    passwordChangedAt: Date,
    passwordResetCode: String,
    passwordResetCodeExpires: Date,
    passwordResetVerified: Boolean,

    wishlist: [{ type: mongoose.Schema.ObjectId, ref: 'Product' }],

    addresses: [
      {
        governorate: { type: mongoose.Schema.ObjectId, ref: 'Governorate' },
        city: String,

        street: String,
        details: String,
        landmark: String,
        phone: String,
        postalCode: String,
      },
    ],

    offlineAddress: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true },
      postalCode: { type: String, match: [/^\d{5}(-\d{4})?$/, 'Postal code must be valid (e.g., 12345 or 12345-6789)'] },
    },

    isActive: { type: Boolean, default: true },
    isAdmin: { type: Boolean, default: false },
    isOffline: { type: Boolean, default: false },
    isMerged: { type: Boolean, default: false },
    mergedWith: { type: mongoose.Schema.ObjectId, ref: 'User' },

    emailVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userSchema.index(
  { email: 1, type: 1 }, // Compound index on email and type
  {
    unique: true,
    // MongoDB's partialFilterExpression only supports a limited operator set - $exists, $eq,
    // $gt(e), $lt(e), $type, and top-level $and - not $ne/$not (see MongoDB docs on partial
    // indexes). $exists: true already excludes documents where `email` is entirely absent
    // (the actual shape offline/legacy users are created with - see createOfflineCustomer),
    // which is what this index needs: unique email per 'online' user without erroring on users
    // that never had an email at all.
    partialFilterExpression: { email: { $exists: true }, type: 'online' },
  }
);

userSchema.methods.savePermissions = async function (next) {
  if (this.role === 'admin') this.permissions = [{ resource: 'all', actions: ['create', 'read', 'update', 'delete'] }];
  else if (this.role === 'moderator') this.permissions = moderatorPermission;
  else if (this.role === 'operator') this.permissions = operatorPermission;
  else this.permissions = userPermission;
};

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  // Remove email for offline users
  if (this.type === 'offline') {
    this.email = undefined;
  }

  this.password = bcrypt.hash(this.password, 5);
  next();
});

module.exports = mongoose.model('User', userSchema);
