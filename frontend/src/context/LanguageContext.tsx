import { LocalizedLabel } from "@/types/global";
import { Language, LanguageContextProps } from "@/types/language";
import { createContext, useContext, useEffect, useState } from "react";
import resources from "@/utils/constants/resources";
import { Resource } from "@/types/user";

const defaultLanguage: Language = "en-US";

export const LanguageContext = createContext<LanguageContextProps>({
  language: defaultLanguage,
  toggleLanguage: () => {},
  translate: () => "",
  translations: {
    dir: "",
    language: "",
    toggleLanguage: "",
    appName: "",
    adminPanel: "",
    underConstruction: "",
    currency: "",
    continue: "",
    back: "",
    exit: "",
    confirm: "",
    cancel: "",
    loading: "",
    error: "",
    pages: {
      home: "",
      vendors: "",
      purchaseOrders: "",
      products: "",
      variants: "",
      salesOrders: "",
      customers: "",
      expenses: "",
      warehouses: "",
      transfers: "",
      reports: "",
      financialReports: "",
      accountingPeriods: "",
      expenseCategories: "",
      cash: "",
      categories: "",
      coupons: "",
      customization: "",
      governorates: "",
      transactions: "",
      users: "",
      currencies: "",
      fixedAssets: "",
      analytics: "",
      projects: "",
      accounts: "",
      journalEntries: "",
      advancedPayments: "",
      shareholders: "",
      sectors: "",
    },
  },
});

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const savedLanguage = JSON.parse(localStorage.getItem("language") as Language) ?? defaultLanguage;

  const [language, setLanguage] = useState<Language>(savedLanguage);

  function toggleLanguage() {
    const newLanguage: Language = language === "ar-EG" ? "en-US" : "ar-EG";
    localStorage.setItem("language", JSON.stringify(newLanguage));
    setLanguage(newLanguage);
  }

  function translate(english: string, arabic: string): string {
    return language === "ar-EG" ? arabic : english;
  }

  // Sets dir/lang on <html> (not just the app-root div layout.tsx already scopes with `dir`), so
  // the language-driven font switch (Inter for LTR, Cairo for RTL - see index.css) reaches every
  // element in the document, including Mantine's portaled content (Modal, Notifications, Menu/
  // Select dropdowns render into a node appended to <body>, outside the React tree) - CSS
  // inheritance follows the real DOM tree, and portals are still descendants of <html>, so this is
  // the one place that reliably covers all of them.
  useEffect(() => {
    document.documentElement.dir = language === "ar-EG" ? "rtl" : "ltr";
    document.documentElement.lang = language === "ar-EG" ? "ar" : "en";
  }, [language]);

  const translations = {
    dir: translate("ltr", "rtl"),
    language: translate("English", "العربية"),
    toggleLanguage: translate("Toggle Language", "تغيير اللغة"),
    appName: translate("Reservia Integrated Energy", "ريزيرفيا للطاقة المتكاملة"),
    adminPanel: translate("Admin Panel", "لوحة التحكم"),
    underConstruction: translate("Under Construction", "تحت الإنشاء"),
    currency: translate("EGP", "جنيه"),
    continue: translate("Continue", "متابعة"),
    back: translate("Back", "العودة"),
    exit: translate("Exit", "خروج"),
    confirm: translate("Confirm", "تأكيد"),
    cancel: translate("Cancel", "إلغاء"),
    loading: translate("Loading...", "جار التحميل..."),
    error: translate("Something went wrong. Please try again later.", "حدث خطأ ما. يرجى المحاولة مرة أخرى لاحقًا"),
    pages: {
      home: translate("Home", "الرئيسية"),
      vendors: translateResource(resources.vendors),
      purchaseOrders: translateResource(resources.purchaseOrders),
      products: translateResource(resources.products),
      variants: translate("Variants", "الأصناف"),
      salesOrders: translateResource(resources.salesOrders),
      customers: translateResource(resources.customers),
      expenses: translateResource(resources.expenses),
      warehouses: translateResource(resources.warehouses),
      transfers: translateResource(resources.transfers),
      reports: translateResource(resources.reports),
      financialReports: translate("Financial Reports", "التقارير المالية"),
      accountingPeriods: translate("Accounting Periods", "الفترات المحاسبية"),
      expenseCategories: translate("Expense Categories", "تصنيفات المصروفات"),
      cash: translateResource(resources.cash),
      currencies: translateResource(resources.currencies),
      categories: translateResource(resources.categories),
      coupons: translateResource(resources.coupons),
      customization: translateResource(resources.customization),
      governorates: translateResource(resources.governorates),
      transactions: translateResource(resources.transactions),
      users: translateResource(resources.users),
      fixedAssets: translateResource(resources.fixedAssets),
      analytics: translateResource(resources.analytics),
      projects: translateResource(resources.projects),
      accounts: translateResource(resources.accounts),
      journalEntries: translateResource(resources.journalEntries),
      advancedPayments: translateResource(resources.advancedPayments),
      shareholders: translateResource(resources.shareholders),
      sectors: translate("Sectors", "القطاعات"),
    },
  };

  function translateResource(localizedResource: LocalizedLabel<Resource>): string {
    return translate(localizedResource.label.en, localizedResource.label.ar);
  }

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, translate, translations }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
