import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import LanguageProvider from "@/context/LanguageContext";
import CreatePrModal from "./create-pr-modal";
import { BoqLine } from "@/types/commercial";

// Feature 3/B4 - interaction tests for the Create PR modal: the one network seam (usePrivateRequest,
// which useDataHandler calls under the hood) is mocked so the component's own fetch-on-open,
// quantity pre-fill, submit payload and "already fully procured" guard are exercised for real
// without needing a live backend or the full UserContext/auth provider tree.
const privateRequestMock = vi.fn();
vi.mock("@/hooks/usePrivateRequest", () => ({ default: () => privateRequestMock }));

const defaultLine: BoqLine = {
  lineNo: 1,
  component: "PV Modules",
  description: "PV Module 475W",
  materialItemKey: null,
  unit: "pcs",
  qty: 100,
  unitPrice: 100,
  total: 10000,
  costGroup: "Equipment",
  source: "auto",
  autoQty: null,
  autoUnitPrice: null,
  flag: null,
  notes: "",
  vendor: { _id: "sup1", code: "SUP-L1", legalName: "Linked Supplier", status: "Approved" },
  orderedQty: 0,
};
const suppliers = [{ _id: "sup1", code: "SUP-L1", legalName: "Linked Supplier", status: "Approved" }];

function renderModal(line: BoqLine = defaultLine) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <MantineProvider>
      <LanguageProvider>
        <CreatePrModal opened onClose={onClose} revisionId="rev1" line={line} suppliers={suppliers} onCreated={onCreated} />
      </LanguageProvider>
    </MantineProvider>
  );
  return { onClose, onCreated };
}

beforeEach(() => {
  privateRequestMock.mockReset();
});
afterEach(() => cleanup());

describe("CreatePrModal", () => {
  it("fetches procurement status on open, pre-fills the remaining quantity, and lists existing Purchase Orders", async () => {
    privateRequestMock.mockResolvedValueOnce({
      data: { boqQty: 100, orderedQty: 40, remainingQty: 60, requisitions: [{ _id: "r1", code: "PO-0001", status: "draft", effectiveStatus: "draft", vendorId: "v1", quantity: 40, amount: 4000, createdAt: "2026-01-01" }] },
    });

    renderModal();

    await waitFor(() => expect(screen.getByText("PO-0001")).toBeTruthy());
    // Mantine's NumberInput renders the `suffix` prop inline in the input's own displayed value.
    expect((screen.getByLabelText(/Quantity/i) as HTMLInputElement).value).toBe("60 pcs");
    expect(privateRequestMock).toHaveBeenCalledWith(expect.objectContaining({ url: "commercial/revisions/rev1/boq-lines/PV%20Modules/procurement-status" }));
  });

  it("submits Create PR with the selected vendor and quantity, then shows the new Purchase Order", async () => {
    privateRequestMock.mockResolvedValueOnce({ data: { boqQty: 100, orderedQty: 0, remainingQty: 100, requisitions: [] } });
    privateRequestMock.mockResolvedValueOnce({ data: { _id: "r2", code: "PO-0002", status: "draft", vendorId: "v1", amount: 10000, createdAt: "2026-01-02" } });

    const { onCreated } = renderModal();
    await waitFor(() => expect((screen.getByLabelText(/Quantity/i) as HTMLInputElement).value).toBe("100 pcs"));

    fireEvent.click(screen.getByRole("button", { name: /Create Purchase Order/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(privateRequestMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: "commercial/revisions/rev1/boq-lines/PV%20Modules/create-pr",
        method: "POST",
        data: { supplierId: "sup1", quantity: 100 },
      })
    );
    expect(screen.getByText("PO-0002")).toBeTruthy();
  });

  it("shows no submission form once the line is already fully procured, so a duplicate click is impossible", async () => {
    privateRequestMock.mockResolvedValueOnce({
      data: { boqQty: 100, orderedQty: 100, remainingQty: 0, requisitions: [{ _id: "r1", code: "PO-0001", status: "open", effectiveStatus: "open", vendorId: "v1", quantity: 100, amount: 10000, createdAt: "2026-01-01" }] },
    });

    renderModal();

    await waitFor(() => expect(screen.getByText(/already been placed/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Create Purchase Order/i })).toBeNull();
    expect(privateRequestMock).toHaveBeenCalledTimes(1); // the status fetch only - never a create-pr call
  });
});
