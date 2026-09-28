import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useWarehouses } from "@/context/WarehousesContext";
import useDocumentTitle from "@/hooks/useDocumentTitle";
import { NumberInput } from "@mantine/core";
import AdminLayoutBox from "@/components/ui/admin-layout-box";
import LoadingSection from "@/components/ui/sections/loading";
import ErrorSection from "@/components/ui/sections/error";
import EmptySection from "@/components/ui/sections/empty";
import { Warehouse } from "@/types/warehouse";
import usePrivateRequest from "@/hooks/usePrivateRequest";
import { notifications } from "@mantine/notifications";
import { solidIcons, outlineIcons } from "@/components/icons";

interface CurrencyData {
  code: string;
  data: {
    balance: number;
    exchangeRate: number;
  };
}

export default function Currencies() {
  const { translations, translate } = useLanguage();
  const { data: warehouses, loading, error, setData: setWarehouses } = useWarehouses();
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
  const [editingExchangeRate, setEditingExchangeRate] = useState<{ currency: string; rate: number } | null>(null);
  const [editingBalance, setEditingBalance] = useState<{ currency: string; amount: number; action: "buy" | "sell" } | null>(
    null,
  );
  const privateRequest = usePrivateRequest();

  useDocumentTitle(`Currencies | ${translations.adminPanel}`);

  const updateExchangeRate = async (currency: string, exchangeRate: number) => {
    try {
      await privateRequest({
        url: "warehouses/exchange-rate",
        method: "PUT",
        data: { currency: currency.toLowerCase(), exchangeRate },
      });

      const response = await privateRequest({
        url: `warehouses/${selectedWarehouse?._id}`,
        method: "GET",
      });

      setWarehouses((prevWarehouses) => {
        if (!prevWarehouses) return prevWarehouses;
        return prevWarehouses.map((warehouse) => (warehouse._id === selectedWarehouse?._id ? response.data : warehouse));
      });

      setSelectedWarehouse(response.data);
      notifications.show({
        title: translate("Success", "نجاح"),
        message: translate("Exchange rate updated successfully", "تم تحديث سعر الصرف بنجاح"),
        color: "green",
      });
      setEditingExchangeRate(null);
    } catch (error) {
      notifications.show({
        title: translate("Error", "خطأ"),
        message: translate("Failed to update exchange rate", "فشل تحديث سعر الصرف"),
        color: "red",
      });
    }
  };

  const updateCurrencyBalance = async (warehouseId: string, currency: string, amount: number) => {
    try {
      await privateRequest({
        url: editingBalance?.action === "sell" ? "warehouses/convert-currency" : "warehouses/currency-balance",
        method: "PUT",
        data: { warehouseId, currency: currency.toLowerCase(), amount },
      });

      const response = await privateRequest({
        url: `warehouses/${warehouseId}`,
        method: "GET",
      });

      setWarehouses((prevWarehouses) => {
        if (!prevWarehouses) return prevWarehouses;
        return prevWarehouses.map((warehouse) => (warehouse._id === warehouseId ? response.data : warehouse));
      });

      if (selectedWarehouse?._id === warehouseId) {
        setSelectedWarehouse(response.data);
      }

      notifications.show({
        title: translate("Success", "نجاح"),
        message: translate("Currency balance updated successfully", "تم تحديث رصيد العملة بنجاح"),
        color: "green",
      });
      setEditingBalance(null);
    } catch (error) {
      notifications.show({
        title: translate("Error", "خطأ"),
        message: translate("Failed to update currency balance", "فشل تحديث رصيد العملة"),
        color: "red",
      });
    }
  };

  const getCurrencyData = (warehouse: Warehouse): CurrencyData[] => [
    { code: "USD", data: warehouse.usd },
    { code: "EUR", data: warehouse.eur },
    { code: "TRY", data: warehouse.try },
    { code: "CNY", data: warehouse.cny },
  ];

  const renderCurrencyCard = (currency: CurrencyData, warehouse: Warehouse) => {
    const { code, data } = currency;
    const isEditingBalance = editingBalance?.currency === code;
    const isEditingRate = editingExchangeRate?.currency === code;

    return (
      <div key={code} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">{code}</h3>

        <div className="space-y-4">
          {/* Balance Section */}
          <div>
            <label className="my-1 block text-sm font-medium text-gray-600">{translate("Balance", "الرصيد")}:</label>
            {isEditingBalance ? (
              <div className="space-y-3">
                <NumberInput
                  label={translate(
                    `Enter the amount in ${editingBalance.action === "sell" ? code : "جنيه"}`,
                    `أدخل المبلغ بالـ ${editingBalance.action === "sell" ? code : "جنيه"}`,
                  )}
                  value={editingBalance.amount}
                  onChange={(value) => setEditingBalance({ ...editingBalance, amount: Number(value) || 0 })}
                />
                {editingBalance.action === "buy" && (
                  <p className="text-sm text-gray-500">
                    {translate("Amount in", "المبلغ بالـ")} {code}:{" "}
                    {((editingBalance.amount || 0) / data.exchangeRate).toFixed(2)}
                  </p>
                )}
                {editingBalance.action === "sell" && (
                  <p className="text-sm text-gray-500">
                    {translate("Amount in EGP", "المبلغ بالجنيه")}: {(editingBalance.amount * data.exchangeRate).toFixed(2)}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => updateCurrencyBalance(warehouse._id, code, editingBalance.amount)}
                    className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                  >
                    <solidIcons.Check size={14} />
                    {translations.confirm}
                  </button>
                  <button
                    onClick={() => setEditingBalance(null)}
                    className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <solidIcons.XMark size={14} />
                    {translations.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-lg font-medium text-gray-900">
                  {data.balance.toFixed(2)} {code}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setEditingBalance({ currency: code, amount: data.balance * data.exchangeRate, action: "buy" })
                    }
                    className="flex items-center gap-1 rounded-md bg-green-100 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-200"
                  >
                    <solidIcons.Plus size={14} />
                    {translate("Buy", "شراء")}
                  </button>
                  <button
                    onClick={() => setEditingBalance({ currency: code, amount: data.balance, action: "sell" })}
                    className="flex items-center gap-1 rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-200"
                  >
                    <solidIcons.Minus size={14} />
                    {translate("Sell", "بيع")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <hr />

          {/* Exchange Rate Section */}
          <div>
            <label className="by-1 block text-sm font-medium text-gray-600">{translate("Exchange Rate", "سعر الصرف")}</label>
            {isEditingRate ? (
              <div className="space-y-3">
                <NumberInput
                  label={translate("New Exchange Rate", "سعر الصرف الجديد")}
                  value={editingExchangeRate.rate}
                  onChange={(value) => setEditingExchangeRate({ currency: code, rate: Number(value) || 0 })}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => updateExchangeRate(code, editingExchangeRate.rate)}
                    className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                  >
                    <solidIcons.Check size={14} />
                    {translations.confirm}
                  </button>
                  <button
                    onClick={() => setEditingExchangeRate(null)}
                    className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <solidIcons.XMark size={14} />
                    {translations.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-lg font-medium text-gray-800">{data.exchangeRate}</p>
                <button
                  onClick={() => setEditingExchangeRate({ currency: code, rate: data.exchangeRate })}
                  className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  title={translate("Edit", "تعديل")}
                >
                  <outlineIcons.Edit size={14} />
                </button>
              </div>
            )}
          </div>

          <hr />

          {/* Value in EGP */}
          <div className="rounded-lg bg-gray-100 p-3">
            <p className="mb-1 text-sm font-medium text-gray-600">
              {translate("Total Value in EGP", "القيمة الإجمالية بالجنيه")}
            </p>
            <p className="text-lg font-semibold text-gray-900">
              {(data.balance * data.exchangeRate).toFixed(2)} {translations.currency}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderWarehouseDetails = (warehouse: Warehouse) => (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">{warehouse.name}</h2>
            <p className="text-gray-600">{warehouse.location}</p>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
              {translate("Base Balance", "الرصيد الأساسي")}: {warehouse.balance.toFixed(2)} {translations.currency}
            </span>
            <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
              {translate("Total Balance", "الرصيد الإجمالي")}: {warehouse.totalBalanceEGP.toFixed(2)} {translations.currency}
            </span>
          </div>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-gray-900">{translate("Currencies", "العملات")}</h3>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {getCurrencyData(warehouse).map((currency) => renderCurrencyCard(currency, warehouse))}
      </div>
    </div>
  );

  if (loading) return <LoadingSection message={translate("Loading warehouses...", "جاري تحميل المخازن...")} />;
  if (error)
    return <ErrorSection errorMessage={error} errorTitle={translate("Error Loading Warehouses", "خطأ في تحميل المخازن")} />;
  if (!warehouses?.length) return <EmptySection />;

  return (
    <AdminLayoutBox
      header={{
        title: translations.pages.currencies,
        subTitle: translate(
          "This page allows you to manage the exchange rates and balances of different currencies in different warehouses.",
          "تسمح لك هذه الصفحة بإدارة أسعار العملات الاجنبية المختلفة والارصدة فى مختلف الأفرع.",
        ),
      }}
    >
      <div className="space-y-6">
        {!selectedWarehouse ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {warehouses.map((warehouse) => (
              <div
                key={warehouse._id}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm transition-all hover:bg-gray-100"
                onClick={() => setSelectedWarehouse(warehouse)}
              >
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-gray-800">{warehouse.name}</h3>
                  <p className="text-sm text-gray-600">{translate("Total Balance", "الرصيد الإجمالي")}</p>
                  <strong className="text-lg font-semibold text-gray-900">
                    {warehouse.totalBalanceEGP.toFixed(2)} {translations.currency}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <button
              onClick={() => setSelectedWarehouse(null)}
              className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <solidIcons.ArrowLeft className={`${translate("rotate-0", "rotate-180")}`} />
              {translate("Back to Warehouses", "العودة إلى المخازن")}
            </button>
            {renderWarehouseDetails(selectedWarehouse)}
          </div>
        )}
      </div>
    </AdminLayoutBox>
  );
}
