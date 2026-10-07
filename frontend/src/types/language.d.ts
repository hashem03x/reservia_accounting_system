export type Language = "en-US" | "ar-EG";

export interface LanguageContextProps {
  language: Language;
  toggleLanguage: () => void;
  translate: (english: string, arabic: string) => string;
  translations: {
    dir: string;
    language: string;
    toggleLanguage: string;
    appName: string;
    adminPanel: string;
    underConstruction: string;
    currency: string;
    continue: string;
    back: string;
    confirm: string;
    cancel: string;
    loading: string;
    error: string;
    pages: {
      home: string;
      vendors: string;
      purchaseOrders: string;
      products: string;
      variants: string;
      salesOrders: string;
      customers: string;
      expenses: string;
      warehouses: string;
      transfers: string;
      reports: string;
      cash: string;
      currencies: string;
      categories: string;
      coupons: string;
      customization: string;
      governorates: string;
      transactions: string;
      users: string;
      fixedAssets: string;
      analytics: string;
      projects: string;
      accounts: string;
      journalEntries: string;
      advancedPayments: string;
    };
  };
}
