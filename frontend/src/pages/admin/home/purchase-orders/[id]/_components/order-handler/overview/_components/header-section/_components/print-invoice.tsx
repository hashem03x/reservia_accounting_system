import Barcode from "react-barcode";
import PrintDocument from "@/components/ui/print-document";
import { useOrder } from "../../../../../../context";
import { useLanguage } from "@/context/LanguageContext";
import { formatDateAndTime } from "@/utils/helpers/date-formaters";
import { getColorLabel } from "@/utils/constants/colors";
import { getPaymentStatusLabel } from "@/utils/constants/payment-statuses";
import { solidIcons } from "@/components/icons";
import useWarehouseHelpers from "@/hooks/useWarehouseHelpers";

export default function PrintInvoice() {
  const { translate } = useLanguage();
  const { order, returnedItems } = useOrder();
  const { getWarehouseById } = useWarehouseHelpers();

  const warehouse = getWarehouseById(order.warehouseId);

  return (
    <PrintDocument
      title={translate("Invoice", "الفاتورة")}
      icon={<solidIcons.Invoice />}
      paperWidth={210} // A4 Width in mm
      paperHeight={297} // A4 Height in mm
      paperMarginX={15}
      paperMarginY={20}
    >
      <div>
        <style>
          {`
            @media print {
              * { font-size: 3mm; } 
              .h3 { margin: 7.5mm 0 2mm; }
              .table { width: 100%; border-collapse: collapse; }
              .table th, .table tfoot td { background-color: #f5f5f5; }
              .table th, .table td { border: 0.25mm solid #eee; padding: 2.5mm 5mm; text-align: left; }
            }
          `}
        </style>

        {/* Header */}
        <header
          style={{
            width: "100%",
            textAlign: "center",
            backgroundColor: "#eee",
            padding: "5mm 0",
            fontSize: "5mm",
            fontWeight: 600,
            marginBottom: "5mm",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "2.5mm",
            borderBottom: "0.35mm dashed #ddd",
          }}
        >
          {warehouse?.image && (
            <img
              src={warehouse.image}
              alt="Warehouse Logo"
              style={{ height: "12mm", width: "12mm", objectFit: "contain" }}
            />
          )}
          <div style={{ fontSize: "5mm" }}>{warehouse?.name} Invoice</div>
        </header>

        {/* Details */}
        <main style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "2.5mm" }}>
            <span>
              <strong>Date & Time:</strong> {formatDateAndTime(order.createdAt, "en-US")}
            </span>
            <span>
              <strong>Vendor Name:</strong> {order.vendor.name}
            </span>
            <span>
              <strong>Vendor Phone:</strong> {order.vendor.contact.phone}
            </span>
          </div>

          <Barcode value={order.code || order._id} margin={0} width={order.code ? 2.45 : 1} height={50} fontSize={15} />
        </main>

        {/* Items */}
        <section>
          <h3 className="h3">Order Items</h3>
          <table className="table">
            <thead>
              <tr>
                <th style={{ minWidth: "50mm" }}>Item</th>
                <th>Color</th>
                <th>Size</th>
                <th>Quantity</th>
                <th style={{ textWrap: "nowrap" }}>Unit Price</th>
                <th style={{ textWrap: "nowrap" }}>After Discount</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item, index) => (
                <tr key={index}>
                  <td>{item.variant.product.title.en}</td>
                  <td>{getColorLabel(item.variant.color, "en-US")}</td>
                  <td>{item.variant.size}</td>
                  <td>{item.starterQuantity}</td>
                  <td>{item.unitPrice.toFixed(2)}</td>
                  <td>{item.unitPriceAfterDiscount.toFixed(2)}</td>
                  <td style={{ fontWeight: 500 }}>{item.starterSubtotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}></td>
                <td style={{ fontWeight: 600 }}>{order.starterTotalAmount.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* Returned Items */}
        {returnedItems.length > 0 && (
          <section>
            <h3 className="h3">Returned Items</h3>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: "50mm" }}>Item</th>
                  <th>Color</th>
                  <th>Size</th>
                  <th style={{ textWrap: "nowrap" }}>Price After Discount</th>
                  <th style={{ textWrap: "nowrap" }}>Quantity Returned</th>
                  <th style={{ textWrap: "nowrap" }}>Amount Returned</th>
                </tr>
              </thead>
              <tbody>
                {returnedItems.map((item) => (
                  <tr key={item.variant._id}>
                    <td>{item.variant.product.title.en}</td>
                    <td>{getColorLabel(item.variant.color, "en-US")}</td>
                    <td>{item.variant.size}</td>
                    <td>{item.unitPriceAfterDiscount.toFixed(2)}</td>
                    <td>{item.returnedQuantity}</td>
                    <td style={{ fontWeight: 500 }}>{(item.unitPriceAfterDiscount * item.returnedQuantity).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}></td>
                  <td style={{ fontWeight: 600 }}>{(order.starterTotalAmount - order.totalAmount).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {/* Order Summary */}
        <section>
          <h3 className="h3">Order Summary</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Total Amount</th>
                <th>Total Paid</th>
                <th>Remaining Amount</th>
                <th>Payment Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>{order.totalAmount.toFixed(2)} EGP</td>
                <td>{order.paidAmount.toFixed(2)} EGP</td>
                <td>{order.remainingAmount.toFixed(2)} EGP</td>
                <td>{getPaymentStatusLabel(order.paymentStatus, "en-US")}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div style={{ marginTop: "5mm", color: "#555" }}>Thank you for dealing with us!</div>
      </div>
    </PrintDocument>
  );
}
