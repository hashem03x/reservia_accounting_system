const { Schema, model } = require('mongoose');

// Case-insensitive comparison for Project Manager names ("Ahmed Ali" and "ahmed ali" are the same
// person) - used by the unique index and every name lookup, so the duplicate check and the index agree.
const PROJECT_MANAGER_NAME_COLLATION = { locale: 'en', strength: 2 };

// An admin-managed Project Manager (Admin -> Project Managers). Projects reference one through
// Project.projectManager. Project managers who were staff users before this collection existed are
// brought in with the SAME _id as that user (services/project/projectManagerService.js#
// importLegacyProjectManagers), so the references on existing projects stay valid unchanged. A project
// manager used by a project can be deactivated but never deleted, so no project loses its manager.
const projectManagerSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Project manager name is required'],
      trim: true,
      maxlength: [100, 'Project manager name cannot exceed 100 characters'],
    },
    email: { type: String, trim: true, lowercase: true, default: null, maxlength: [254, 'Email is too long'] },
    phone: { type: String, trim: true, default: null, maxlength: [30, 'Phone number is too long'] },
    // Inactive project managers stay on the projects that already have them (and in reports), but are
    // not offered (or accepted) when a project's manager is set.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

projectManagerSchema.index({ name: 1 }, { unique: true, collation: PROJECT_MANAGER_NAME_COLLATION });
projectManagerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
projectManagerSchema.index({ isActive: 1 });

module.exports = model('ProjectManager', projectManagerSchema);
module.exports.PROJECT_MANAGER_NAME_COLLATION = PROJECT_MANAGER_NAME_COLLATION;
