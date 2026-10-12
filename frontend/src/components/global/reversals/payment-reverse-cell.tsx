import { useDisclosure } from "@mantine/hooks";
import { Badge, Button, Tooltip } from "@mantine/core";
import { useLanguage } from "@/context/LanguageContext";
import useHasPermission from "@/hooks/useHasPermission";
import resources from "@/utils/constants/resources";
import actions from "@/utils/constants/actions";
import { Payment } from "@/types/payment";
import ReverseModal from "./reverse-modal";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Target =
  // A cash / bank payment (or a refund).
  | { mode: "payment"; paymentId: string }
  // An advance applied through a payment, or to an order when it was created.
  | { mode: "settlement"; advancedPaymentId: string; paymentId?: string; salesOrderId?: string; purchaseOrderId?: string };

/**
 * Reverse action for one payment / settlement row: a payment is reversed with its cash / bank
 * movement (journal entries permission); an advance application is reversed back onto the advance
 * (advanced payments permission). The advance's own receipt is never touched here.
 */
export function ReverseAction({
  target,
  amount,
  direction,
  onDone,
}: {
  target: Target;
  amount: number;
  direction: "in" | "out";
  onDone: () => void;
}) {
  const { translate } = useLanguage();
  const [opened, { open, close }] = useDisclosure();
  const canReversePayment = useHasPermission(resources.journalEntries, actions.update);
  const canReverseSettlement = useHasPermission(resources.advancedPayments, actions.update);
  if (target.mode === "payment" ? !canReversePayment : !canReverseSettlement) return null;

  const settlement = target.mode === "settlement";
  const isIn = direction === "in";
  const { mode, ...ids } = target;
  void mode;
  return (
    <>
      <Button size="compact-xs" variant="subtle" color="orange" onClick={open}>
        {settlement ? translate("Reverse settlement", "عكس التسوية") : translate("Reverse", "عكس")}
      </Button>
      <ReverseModal
        opened={opened}
        close={close}
        title={
          settlement
            ? translate("Reverse this settlement", "عكس هذه التسوية")
            : translate("Reverse this payment", "عكس هذه الدفعة")
        }
        url={
          target.mode === "settlement"
            ? `reversals/advanced-payments/${target.advancedPaymentId}/settlements`
            : `reversals/payments/${target.paymentId}`
        }
        body={
          target.mode === "settlement"
            ? {
                paymentId: ids.paymentId,
                salesOrderId: (ids as { salesOrderId?: string }).salesOrderId,
                purchaseOrderId: (ids as { purchaseOrderId?: string }).purchaseOrderId,
              }
            : {}
        }
        explanation={
          settlement
            ? translate(
                `${money(amount)} goes back onto the advanced payment it came from, and the order owes it again. The advance itself (its receipt or payment) is not reversed. A reversing journal entry is posted; the original is kept.`,
                `يعود ${money(amount)} إلى الدفعة المقدمة التي سُدد منها، ويصبح مستحقاً على الأمر مرة أخرى. الدفعة المقدمة نفسها لا تُعكس. يُرحَّل قيد عكسي ويبقى القيد الأصلي.`,
              )
            : translate(
                `${money(amount)} ${isIn ? "received" : "paid"} is undone: the cash / bank movement and the settlement it made are reversed, and the order is outstanding by this amount again. The order itself is not returned. A reversing journal entry is posted; the original is kept.`,
                `يُلغى ${money(amount)} ${isIn ? "المقبوضة" : "المدفوعة"}: تُعكس حركة النقدية / البنك والتسوية التي تمت بها، ويصبح الأمر مستحقاً بهذا المبلغ مرة أخرى. لا يُرتجع الأمر نفسه. يُرحَّل قيد عكسي ويبقى القيد الأصلي.`,
              )
        }
        onDone={onDone}
      />
    </>
  );
}

/** The reversal cell of a Payment row: "Reversed" (with its reason) once reversed, else the action. */
export default function PaymentReverseCell({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const { translate } = useLanguage();
  if (payment.reversedAt || payment.reversedByEntry) {
    return (
      <Tooltip label={payment.reversalReason || ""} disabled={!payment.reversalReason} multiline w={260}>
        <Badge color="gray" variant="light">
          {translate("Reversed", "معكوسة")}
        </Badge>
      </Tooltip>
    );
  }
  const advanceId = payment.advancedPayment
    ? typeof payment.advancedPayment === "string"
      ? payment.advancedPayment
      : payment.advancedPayment._id
    : null;
  return (
    <ReverseAction
      target={
        advanceId
          ? { mode: "settlement", advancedPaymentId: advanceId, paymentId: payment._id }
          : { mode: "payment", paymentId: payment._id }
      }
      amount={payment.amountPaid}
      direction={payment.type}
      onDone={onDone}
    />
  );
}
