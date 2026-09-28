import { useDisclosure } from "@mantine/hooks";
import { useLanguage } from "@/context/LanguageContext";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import EmptySection from "@/components/ui/sections/empty";
import { solidIcons } from "@/components/icons";
import { Button, Table } from "@mantine/core";
import { useOrder } from "../../../context";
import ReturnItemModal from "./_components/return-item-modal";
import ReturnRecordRow from "./_components/return-record-row";
import ReturnedItemRow from "./_components/returned-item-row";

export default function Returns() {
  const { translate } = useLanguage();
  const { returnRecords, returnedItems } = useOrder();

  const [opened, { open, close }] = useDisclosure();

  return (
    <AdminLayoutBox
      header={{
        title: translate("Returns", "المرتجعات"),
        sideElements: (
          <>
            <Button onClick={open} radius="md" leftSection={<solidIcons.Plus />}>
              {translate("Return Item", "ارجاع عنصر")}
            </Button>

            <ReturnItemModal opened={opened} close={close} />
          </>
        ),
      }}
    >
      {returnRecords.length > 0 ? (
        <>
          {returnedItems.length > 0 && (
            <section className="flex flex-col gap-2">
              <div className="overflow-x-auto rounded-md border">
                <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
                  <Table.Thead className="bg-gray-100 text-gray-800">
                    <Table.Tr>
                      <Table.Th>{translate("Variant Code", "كود الصنف")}</Table.Th>
                      <Table.Th>{translate("Product Title", "عنوان المنتج")}</Table.Th>
                      <Table.Th>{translate("Color", "اللون")}</Table.Th>
                      <Table.Th>{translate("Size", "المقاس")}</Table.Th>
                      <Table.Th>{translate("Price After Discount", "السعر بعد الخصم")}</Table.Th>
                      <Table.Th>{translate("Quantity Returned", "الكمية المرتجعة")}</Table.Th>
                      <Table.Th>{translate("Amount Returned", "المبلغ المرتجع")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {returnedItems.map((returnedItem) => (
                      <ReturnedItemRow key={returnedItem._id} returnedItem={returnedItem} />
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
            </section>
          )}

          <hr className="my-2" />

          <section className="flex flex-col gap-2">
            <h4>{translate("Return Processes History", "سجل عمليات الارجاع")}</h4>
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-nowrap text-sm" withColumnBorders verticalSpacing="xs">
                <Table.Thead className="bg-gray-100 text-gray-800">
                  <Table.Tr>
                    <Table.Th>{translate("Return Date", "تاريخ الارجاع")}</Table.Th>
                    <Table.Th>{translate("Variant Code", "كود الصنف")}</Table.Th>
                    <Table.Th>{translate("Product Title", "عنوان المنتج")}</Table.Th>
                    <Table.Th>{translate("Color", "اللون")}</Table.Th>
                    <Table.Th>{translate("Size", "المقاس")}</Table.Th>
                    <Table.Th>{translate("Quantity Returned", "الكمية المرتجعة")}</Table.Th>
                    <Table.Th>{translate("Amount Returned", "المبلغ المرتجع")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {returnRecords.map((returnRecord) => (
                    <ReturnRecordRow key={returnRecord._id} returnRecord={returnRecord} />
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </section>
        </>
      ) : (
        <EmptySection message={translate("No Items Returned", "لا توجد مرتجعات")} useDefaultImg />
      )}
    </AdminLayoutBox>
  );
}
