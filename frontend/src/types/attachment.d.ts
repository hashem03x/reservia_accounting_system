// A PDF attached to a purchase order, sales order or journal entry
// (backend: services/files/attachmentService.js, routes /attachments).
export type AttachmentOwnerKey = "purchase-orders" | "sales-orders" | "journal-entries";

export interface Attachment {
  _id: string;
  ownerType: "PurchaseOrder" | "SalesOrder" | "JournalEntry";
  owner: string;
  originalName: string;
  contentType: string;
  size: number;
  sha256: string;
  uploadedBy?: { _id: string; name: string } | null;
  createdAt: string;
}

export interface AttachmentLimits {
  maxBytes: number;
  maxFiles: number;
}
