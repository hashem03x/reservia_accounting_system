import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import LanguageProvider from "@/context/LanguageContext";
import { WarehousesContext } from "@/context/WarehousesContext";
import TransferMoneyModal from "./transfer-money-modal";

// Transfer Money - the withdrawal/deposit selectors must be real Chart of Accounts Cash/Cash
// Equivalent accounts fetched from the backend (never the old hardcoded payment-methods list).
// The submit payload's currency-vs-amount branching logic is covered separately and more reliably
// in transfer-money-payload.test.ts, as a pure function - Mantine's Select dropdown does not
// reliably open under jsdom when nested inside this codebase's Modal wrapper (confirmed in
// isolation; the project's only other Modal+Select component test never opens its Select either),
// so this file sticks to what driving the real rendered component can verify well.
const privateRequestMock = vi.fn();
vi.mock("@/hooks/usePrivateRequest", () => ({ default: () => privateRequestMock }));

const warehouses = [
  { _id: "wh1", name: "Head Office", balance: 50000 },
  { _id: "wh2", name: "Branch", balance: 10000 },
];
const accounts = [
  { _id: "acc1", code: "11000001", name: "Bank Misr" },
  { _id: "acc2", code: "11000002", name: "NBE Current" },
];

function mockResponses() {
  privateRequestMock.mockImplementation(({ url }: { url: string }) => {
    if (url === "accounts/cash-equivalent-eligible") return Promise.resolve({ data: accounts });
    if (url === "currencies") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderModal() {
  const close = vi.fn();
  const setPaginatedPayments = vi.fn();
  render(
    <MantineProvider>
      <LanguageProvider>
        <WarehousesContext.Provider value={{ data: warehouses as never, setData: vi.fn(), loading: false, error: "", reFetch: vi.fn() }}>
          <TransferMoneyModal opened close={close} setPaginatedPayments={setPaginatedPayments} />
        </WarehousesContext.Provider>
      </LanguageProvider>
    </MantineProvider>
  );
  return { close, setPaginatedPayments };
}

const selectInput = (label: RegExp) => screen.getByRole("textbox", { name: label });

beforeEach(() => {
  privateRequestMock.mockReset();
  mockResponses();
});
afterEach(() => cleanup());

describe("TransferMoneyModal", () => {
  it("loads real Chart of Accounts Cash/Cash-Equivalent options for both the withdraw and deposit selectors, never a hardcoded list", async () => {
    renderModal();

    await waitFor(() =>
      expect(privateRequestMock).toHaveBeenCalledWith(expect.objectContaining({ url: "accounts/cash-equivalent-eligible" }))
    );
    // Called once per selector - two independent PaymentAccountSelect instances.
    const eligibleCalls = privateRequestMock.mock.calls.filter(([arg]) => arg.url === "accounts/cash-equivalent-eligible");
    expect(eligibleCalls.length).toBe(2);

    expect(selectInput(/Withdraw Account/i)).toBeTruthy();
    expect(selectInput(/Deposit Account/i)).toBeTruthy();
    // The old hardcoded "Withdraw Method"/"Deposit Method" labels are gone.
    expect(screen.queryByLabelText(/Withdraw Method/i)).toBeNull();
    expect(screen.queryByLabelText(/Deposit Method/i)).toBeNull();
  });

  it("submit is disabled until warehouses, accounts and an amount are all filled in", async () => {
    renderModal();
    await waitFor(() => expect(selectInput(/Withdraw Account/i)).toBeTruthy());
    expect((screen.getByRole("button", { name: /Transfer Money/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
