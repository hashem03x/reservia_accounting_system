import { Warehouse } from "./warehouse";

export interface FixedAsset {
  _id: string;
  name: string;
  bookValue: number;
  fairValue: number;
  warehouseId: { _id: string; name: string };
  warehouse?: Warehouse;
  createdAt: string;
  updatedAt: string;
}
