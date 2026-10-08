const { Schema, model } = require('mongoose');

// Case-insensitive comparison for Sector names ("Villa" and "villa" are the same sector). Used by
// the unique index below and by every query that looks a sector up by name, so the duplicate check
// and the index always agree.
const SECTOR_NAME_COLLATION = { locale: 'en', strength: 2 };

// An admin-managed Project Sector (Admin -> Sectors). Projects store the sector's NAME in
// Project.sector (the field's original format, so existing projects need no migration); this
// collection is the source of truth for which names are valid. Renaming a sector updates the
// projects using it (services/project/sectorService.js), and a sector in use can be deactivated
// but never deleted, so a project never loses its sector.
const sectorSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Sector name is required'],
      trim: true,
      maxlength: [100, 'Sector name cannot exceed 100 characters'],
    },
    // Inactive sectors stay visible to admins and on the projects that already use them, but are
    // not offered (or accepted) when a project's sector is set.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

sectorSchema.index({ name: 1 }, { unique: true, collation: SECTOR_NAME_COLLATION });
sectorSchema.index({ isActive: 1 });

module.exports = model('Sector', sectorSchema);
module.exports.SECTOR_NAME_COLLATION = SECTOR_NAME_COLLATION;
