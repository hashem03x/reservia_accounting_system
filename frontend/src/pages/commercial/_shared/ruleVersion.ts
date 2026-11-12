// Deal Engine C11: revisions calculated before 12 November 2026 carry no rule version - their price per
// kWp was measured on the INSTALLED kWp and must be labelled so (ONG-000003 revision 1 showed "per
// design kWp" with an installed-kWp number). Mirrors backend services/commercial/dealEngineSettings.js.
export const RULE_VERSION_DATE = "2026-11-12";

type RevisionLike = { ruleVersion?: string | null; createdAt?: string };

/** "design" for revisions on the current rule set (or created on/after 12 Nov), "installed" for older ones. */
export function perKwpBasis(revision: RevisionLike | null | undefined): "design" | "installed" {
  if (!revision) return "design";
  if (revision.ruleVersion) return "design";
  if (revision.createdAt && revision.createdAt.slice(0, 10) < RULE_VERSION_DATE) return "installed";
  return "design";
}

export function ruleVersionLabel(revision: RevisionLike | null | undefined): string {
  return revision?.ruleVersion || "legacy (before 12 Nov 2026)";
}
