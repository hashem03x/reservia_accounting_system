// The company's capital structure summary (backend/server/services/equity/companyCapitalService.js).
// Paid-in/Unpaid are always computed server-side from real shareholder contributions - never
// stored, never editable directly.
export type CompanyCapital = {
  issuedCapital: number;
  paidInCapital: number;
  unpaidCapital: number;
} | null; // null until an admin sets Issued Capital for the first time
