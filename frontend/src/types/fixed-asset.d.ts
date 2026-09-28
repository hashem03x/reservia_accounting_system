import { Warehouse } from "./warehouse";

export interface FixedAsset {
  _id: string;
  name: string;
  bookValue: number;
  fairValue: number;
  loseValue: number;
  warehouseId: Warehouse;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  id: string;
}
