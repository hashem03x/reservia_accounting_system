// Mirrors backend/server/models/shared/businessPartnerSchemas.js's EGYPTIAN_IBAN_REGEX /
// SWIFT_CODE_REGEX exactly - this is a UX nicety (instant feedback before submit), NOT the actual
// enforcement. The backend validates independently and is the source of truth; never rely on this
// alone.
export const EGYPTIAN_IBAN_REGEX = /^EG[A-Za-z0-9]{27}$/;
export const SWIFT_CODE_REGEX = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export function isValidEgyptianIban(iban: string): boolean {
  return EGYPTIAN_IBAN_REGEX.test(iban);
}

export function isValidSwiftCode(swiftCode: string): boolean {
  return SWIFT_CODE_REGEX.test(swiftCode);
}
