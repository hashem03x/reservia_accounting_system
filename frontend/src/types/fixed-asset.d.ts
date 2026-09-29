import { Warehouse } from "./warehouse";
import { ChartOfAccount } from "./chart-of-account";

export type FixedAssetStatus = "active" | "disposed" | "under_maintenance";

export interface FixedAsset {
  _id: string;
  name: string;
  bookValue: number;
  fairValue: number;
  loseValue: number;
  warehouseId: Warehouse;
  // Accounting-foundation fields (optional - pre-existing assets predate them, see
  // backend/server/models/fixedAssets.js).
  price?: number;
  assetAccountId?: ChartOfAccount | null;
  acquisitionDate?: string;
  status?: FixedAssetStatus;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  id: string;
}
