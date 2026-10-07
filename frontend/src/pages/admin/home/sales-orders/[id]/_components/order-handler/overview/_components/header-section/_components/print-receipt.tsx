import Barcode from "react-barcode";
import { useLanguage } from "@/context/LanguageContext";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { RECEIPT_WIDTH } from "@/utils/constants";
import { solidIcons } from "@/components/icons";
import PrintDocument from "@/components/ui/print-document";
import { useOrder } from "../../../../../../context";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";
<<<<<<< HEAD
import { getOrderTotal } from "@/utils/helpers/order-totals";
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

const receiptPadding = 2.5;
const separatorHeight = 7.5;
const miniHeaderHeight = 6.5;

const borderHeight = 0.5;

const headerHeight = 20;
let detailsHeight = 0; // Will be calculated later
const tableItemHeight = 7.5;
const summaryHeight = 32;
const termsHeight = 20;

export default function PrintReceipt() {
  const { translate } = useLanguage();
  const { order, returnedItems } = useOrder();
  const { getWarehouseById } = useWarehouseHelpers();

  const warehouse = getWarehouseById(order.warehouse);

  if (order.shippingCost > 0) detailsHeight = 25;
  else detailsHeight = 20;

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
    separatorHeight +
    miniHeaderHeight +
    termsHeight +
    receiptPadding;

  // If there are returned items, add their height to the paper height
  if (returnedItems.length > 0) {
    paperHeight += separatorHeight + miniHeaderHeight + borderHeight + tableItemHeight * (returnedItems.length + 2);
  }

  // Calculate order summary including shipping cost
  const totalSales =
    order.items.reduce((acc, item) => acc + (item.starterQuantity - item.returnedQuantity) * item.unitPrice, 0) +
    order.shippingCost; // totalSales is the total amount before discount
  const discount = totalSales - order.totalAmountPlusShipping;
  const netSales = order.totalAmountPlusShipping;
  const totalPaidAmount = order.paidAmount + (order.shippingCostPaid ? order.shippingCost : 0);
<<<<<<< HEAD
  // Remaining is measured against the Order Total Amount (incl. VAT) + shipping, not the pre-tax net.
  const totalRemainingAmount = getOrderTotal(order) + (order.shippingCost || 0) - totalPaidAmount;
=======
  const totalRemainingAmount = order.totalAmountPlusShipping - totalPaidAmount;
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

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
              <strong>Customer Name:</strong> {order.customer?.name || "Deleted Customer"}
            </span>
            {order.customer?.phone && (
              <span>
                <strong>Customer Phone:</strong> {order.customer.phone}
              </span>
            )}
            {order.shippingCost ? (
              <span>
                <strong>Shipping Cost:</strong> {order.shippingCost.toFixed(2)} LE
              </span>
            ) : null}
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
                <strong>Total Sales:</strong> {totalSales.toFixed(2)} LE
              </span>
              <span>
                <strong>Discount:</strong> {discount.toFixed(2)} LE
              </span>
              <span>
                <strong>Net Sales:</strong> {netSales.toFixed(2)} LE
              </span>
              <span>
                <strong>Total Paid:</strong> {totalPaidAmount.toFixed(2)} LE
              </span>
              <span>
                {totalRemainingAmount > 0 ? (
                  <>
                    <strong>Remaining Amount:</strong> {totalRemainingAmount.toFixed(2)} LE
                  </>
                ) : null}
              </span>
            </div>
          </section>

          {/* سياسة الاستبدال والاسترجاع */}
          <div className="separtor" />

          <section>
            <h3 className="mini-header" style={{ borderBottom: `${borderHeight}mm dashed #aaa` }}>
              {translate("Return & Exchange Policy", "سياسة الاستبدال والاسترجاع")}
            </h3>
            <div
              style={{
                fontSize: "3.75mm",
                lineHeight: "1.65",
                height: `${termsHeight}mm`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              يتم الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الشراء، وذلك بشرط إحضار الفاتورة الأصلية وأن تكون القطع
              بحالتها الأصلية دون استخدام أو تلف.
            </div>
          </section>
        </div>
      </div>
    </PrintDocument>
  );
}
