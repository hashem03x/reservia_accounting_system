import Barcode from "react-barcode";
import { useLanguage } from "@/context/LanguageContext";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { RECEIPT_WIDTH } from "@/utils/constants";
import { solidIcons } from "@/components/icons";
import PrintDocument from "@/components/ui/print-document";
import { useOrder } from "../../../../../../context";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";

const receiptPadding = 2.5;
const separatorHeight = 7.5;
const miniHeaderHeight = 6.5;

const borderHeight = 0.5;

const headerHeight = 20;
const detailsHeight = 20;
const tableItemHeight = 7.5;
const summaryHeight = 27.5;

export default function PrintReceipt() {
  const { translate } = useLanguage();
  const { order, returnedItems } = useOrder();
  const { getWarehouseById } = useWarehouseHelpers();

  const warehouse = getWarehouseById(order.warehouseId);

  // This is the map of the receipt (without the returned items)
  let paperHeight =
    headerHeight +
    receiptPadding +
    18.5 + // Barcode Height
    separatorHeight +
    detailsHeight +
    separatorHeight +
    miniHeaderHeight +
    borderHeight +
    tableItemHeight * (order.items.length + 2) +
    separatorHeight +
    miniHeaderHeight +
    summaryHeight +
    receiptPadding;

  // If there are returned items, add their height to the paper height
  if (returnedItems.length > 0) {
    paperHeight += separatorHeight + miniHeaderHeight + borderHeight + tableItemHeight * (returnedItems.length + 2);
  }

  // Calculate order summary
  const totalPurchase = order.items.reduce(
    (acc, item) => acc + (item.starterQuantity - item.returnedQuantity) * item.unitPrice,
    0,
  ); // Before discount
  const discount = totalPurchase - order.totalAmount;

  return (
    <PrintDocument
      title={translate("Receipt", "الايصال")}
      icon={<solidIcons.Receipt />}
      paperWidth={RECEIPT_WIDTH}
      paperHeight={paperHeight}
      paperMarginX={0}
      paperMarginY={0}
    >
      <div>
        <style>
          {`
            @media print {
              * { font-size: 3.25mm; font-family: sans-serif; }
              .separtor { height: ${separatorHeight}mm; }
              .mini-header { height: ${miniHeaderHeight}mm; }
              .table { width: 100%; border-collapse: collapse; }
              .table th, .table td { text-align: left; height: ${tableItemHeight}mm; }
              .table thead { border-bottom: ${borderHeight}mm dashed #aaa; }
            }
          `}
        </style>

        {/* Header */}
        <header
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.5mm",
            backgroundColor: "#eee",
            height: `${headerHeight}mm`,
            fontSize: "4.75mm",
            fontWeight: 600,
            borderBottom: "0.35mm dashed #ddd",
          }}
        >
          {warehouse?.image && (
            <img
              src={warehouse.image}
              alt="Warehouse Logo"
              style={{ height: "10mm", width: "10mm", objectFit: "contain" }}
            />
          )}
          {warehouse?.name}
        </header>

        <div style={{ padding: `${receiptPadding}mm` }}>
          {/* Barcode */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            {/* (18.5mm) Height - Changing these values will affect the barcode size */}
            <Barcode value={order.code || order._id} margin={0} width={order.code ? 2.45 : 0.95} height={50} fontSize={14} />
          </div>

          <div className="separtor" />

          {/* Main Details */}
          <main
            style={{
              height: `${detailsHeight}mm`,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-around",
              fontSize: "3.5mm",
            }}
          >
            <span>
              <strong>Date & Time:</strong> {formatDateAndTime(order.createdAt, "en-US")}
            </span>
            <span>
              <strong>Vendor Name:</strong> {order.vendor?.name || "Deleted Vendor"}
            </span>
<<<<<<< HEAD
            {order.vendor?.contact?.phone && (
              <span>
                <strong>Vendor Phone:</strong> {order.vendor.contact?.phone}
=======
            {order.vendor?.contact.phone && (
              <span>
                <strong>Vendor Phone:</strong> {order.vendor.contact.phone}
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
              </span>
            )}
          </main>

          <div className="separtor" />

          {/* Items */}
          <section>
            <h3 className="mini-header">Order Items</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, index) => (
                  <tr key={index}>
                    <td>{item.product?.sku || "-"}</td>
                    <td>{item.starterQuantity}</td>
                    <td>{item.unitPriceAfterDiscount.toFixed(0)}</td>
                    <td style={{ fontWeight: 500 }}>{item.starterSubtotal.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}></td>
                  <td style={{ fontWeight: 600 }}>{order.starterTotalAmount.toFixed(0)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          {/* Returned Items */}
          {returnedItems.length > 0 && (
            <section>
              <div className="separtor" />
              <h3 className="mini-header">Returned Items</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Item Code</th>
                    <th>Qty</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {returnedItems.map((item) => (
                    <tr key={item._id}>
                      <td>{item.product?.sku || "-"}</td>
                      <td>{item.returnedQuantity}</td>
                      <td style={{ fontWeight: 500 }}>{(item.unitPriceAfterDiscount * item.returnedQuantity).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}></td>
                    <td style={{ fontWeight: 600 }}>{(order.starterTotalAmount - order.totalAmount).toFixed(0)}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          )}

          {/* Separator */}
          <div className="separtor" />

          {/* Order Summary */}
          <section>
            <h3 className="mini-header" style={{ borderBottom: `${borderHeight}mm dashed #aaa` }}>
              Order Summary
            </h3>
            <div
              style={{
                height: `${summaryHeight}mm`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-evenly",
              }}
            >
              <span>
                <strong>Total Purchase:</strong> {totalPurchase.toFixed(2)} LE
              </span>
              <span>
                <strong>Discount:</strong> {discount.toFixed(2)} LE
              </span>
              <span>
                <strong>Net Purchase:</strong> {order.totalAmount.toFixed(2)} LE
              </span>
              <span>
                <strong>Total Paid:</strong> {order.paidAmount.toFixed(2)} LE
              </span>
              <span>
                {order.remainingAmount > 0 ? (
                  <>
                    <strong>Remaining Amount:</strong> {order.remainingAmount.toFixed(2)} LE
                  </>
                ) : null}
              </span>
            </div>
          </section>
        </div>
      </div>
    </PrintDocument>
  );
}
