const mongoose = require('mongoose');

const roleChangeLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },
    userName: { type: String, required: true },
    userEmail: { type: String },
    previousRole: {
      type: String,
      enum: ['user', 'moderator', 'operator', 'admin', null], // null for user creation
    },
    newRole: {
      type: String,
      required: [true, 'New role is required'],
      enum: ['user', 'moderator', 'operator', 'admin'],
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Changed by user ID is required'],
    },
    changedByName: { type: String, required: true },
    changedByEmail: { type: String },
    action: {
      type: String,
      enum: ['create', 'update'],
      required: true,
    },
    reason: {
      type: String,
    },
    ipAddress: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
roleChangeLogSchema.index({ userId: 1, createdAt: -1 });
roleChangeLogSchema.index({ changedBy: 1, createdAt: -1 });
roleChangeLogSchema.index({ newRole: 1, createdAt: -1 });

module.exports = mongoose.model('RoleChangeLog', roleChangeLogSchema);
