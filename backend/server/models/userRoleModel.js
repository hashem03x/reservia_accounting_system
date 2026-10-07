const {model, Schema} = require('mongoose');

const PermissionSchema = new Schema({
    resource: { type: String, required: true },  // Resource name (e.g., 'post', 'comment')
    actions: [{ type: String, required: true }]   // Allowed actions (e.g., 'create', 'read', 'update', 'delete')
}, {timestamps:true});

// Define the Role Schema
const RoleSchema = new Schema({
    name: { type: String, required: true, unique: true },  // Role name (e.g., 'admin', 'editor')
    permissions: [PermissionSchema]  // Array of permissions
}, {timestamps:true});

module.exports = model('Role', RoleSchema);