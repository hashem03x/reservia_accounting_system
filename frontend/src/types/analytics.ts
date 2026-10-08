export interface LocalizedText {
  en: string;
  ar: string;
}

export interface TopSellingProduct {
  _id: string;
  price: number;
  totalSold: number;
  title: LocalizedText;
  revenue: number;
}

export interface ProductPerformance {
  _id: string;
  totalSold: number;
  title: LocalizedText;
  revenue: number;
  reviewCount: number;
}

export interface SubCategory {
  _id: string;
  name: LocalizedText;
  slug: string | null;
  totalRevenue: number;
  totalQuantitySold: number;
  numberOfOrders: number;
  numberOfProducts: number;
  averageOrderValue: number;
}

export interface CategorySales {
  _id: string;
  categoryName: LocalizedText;
  categorySlug: string | null;
  subcategories: SubCategory[];
  totalRevenue: number;
  totalQuantitySold: number;
  numberOfOrders: number;
  averageOrderValue: number;
}

export interface SalesSummary {
  totalCategories: number;
  totalSubcategories: number;
  totalRevenue: number;
  totalQuantitySold: number;
  totalOrders: number;
  averageOrderValue: number;
}

export interface SalesBySubCategory {
  data: CategorySales[];
  summary: SalesSummary;
}

export interface TopCustomer {
  _id: string;
  totalOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  lastOrderDate: string;
  name: string;
  email?: string;
  phone: string;
  type: "online" | "offline";
  customerStatus: "VIP" | "Premium" | "Regular" | "New";
  orderSources?: string[];
}

export interface CustomerCategories {
  vip: number;
  premium: number;
  regular: number;
  new: number;
}

export interface CustomerMetrics {
  averageOrderValue: number;
  averageOrdersPerCustomer: number;
  totalRevenue: number;
  customerCategories: {
    vip: number;
    premium: number;
    regular: number;
    new: number;
  };
  orderSources?: {
    website: number;
    cashier: number;
  };
}

export interface CustomerInsights {
  totalCustomers: number;
  onlineCustomers: number;
  offlineCustomers: number;
  activeCustomers: number;
  newCustomers: number;
  topCustomers: TopCustomer[];
  customerMetrics: CustomerMetrics;
}

export interface OrderStats {
  _id: null;
  totalOrders: number;
  maxOrderValue: number;
  minOrderValue: number;
  averageOrderValue: number;
  totalRevenue: number;
  totalShippingCost: number;
  totalPaidAmount: number;
  pendingPayments: number;
  netRevenue: number;
}

export interface OrderStatusGroup {
  count: number;
  totalAmount: number;
  status: string;
}

export interface OrderSourceGroup {
  count: number;
  totalAmount: number;
  source: string;
}

export interface ReturnStats {
  totalReturns: number;
  totalReturnAmount: number;
}

export interface DateRange {
  start: string;
  end: string;
}

export interface OrderStatistics {
  orderStats: OrderStats;
  ordersByDeliveryStatus: OrderStatusGroup[];
  ordersByPaymentStatus: OrderStatusGroup[];
  ordersBySource: OrderSourceGroup[];
  returnStats: ReturnStats;
  dateRange: DateRange;
}

export interface TimePeriod {
  start: string;
  end: string;
  groupBy: "day" | "week" | "month" | "year";
}

export interface SalesPeriodSummary {
  totalRevenue: number;
  totalOrders: number;
  totalShipping: number;
  totalPaid: number;
  totalPending: number;
  totalValue: number;
  totalBookValue: number;
}

export interface SalesPeriod {
  totalAmount: number;
  totalOrders: number;
  totalShipping: number;
  paidAmount: number;
  date: string;
  pendingPayments: number;
}

export interface SalesByTimePeriod {
  timePeriod: TimePeriod;
  summary: SalesPeriodSummary;
  sales: SalesPeriod[];
}

export interface ProductAvailability {
  totalProducts: number;
  availableProducts: number;
  soldProducts: number;
  unsoldProducts: number;
  totalStock: number;
  totalSold: number;
}

export interface WarehousesBalanceType {
  totalBalance: number;
  totalBalanceForAllCurrencies: number;
  USD: number;
  EUR: number;
  TRY: number;
  CNY: number;
}

export interface AnalyticsData {
  topSellingProducts: TopSellingProduct[];
  productPerformance: ProductPerformance[];
  salesBySubCategory: SalesBySubCategory;
  customerInsights: CustomerInsights;
  orderStatistics: OrderStatistics;
  salesByTimePeriod: SalesByTimePeriod;
  productAvailability: ProductAvailability;
}
