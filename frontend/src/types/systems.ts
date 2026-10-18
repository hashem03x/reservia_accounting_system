// Central Business Portal - mirrors backend/server/utils/systemsRegistry.js's SYSTEM_IDS exactly.
export type SystemId = "ERP" | "HR" | "CRM" | "COMMERCIAL" | "WEBSITE";

export type SystemAccessEntry = {
  implemented: boolean;
  active: boolean;
  hasMembership: boolean;
  role: string | null;
};

export type SystemAccessMap = Record<SystemId, SystemAccessEntry>;

export interface SystemAccessContextProps {
  systems: SystemAccessMap | null;
  loading: boolean;
  error: string;
  reFetch: () => void;
}
