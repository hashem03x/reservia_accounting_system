import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import paths from "@/utils/constants/paths";

function Admin() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === `/${paths.admin}` || location.pathname === `/${paths.admin}/`) {
      navigate(paths.home);
    }
  }, [location]);

  return <Outlet />;
}

export default Admin;


/**
 * i want to create a new page Analytics @analytics 
 * and here the endpoints and the response body :
 * 
 * 1- {{URL}}/analytics/top-selling-products
 * {
    "status": "success",
    "data": [
        {
            "_id": "679cf76ea2962c2d8f14e26e",
            "price": 2000,
            "totalSold": 501,
            "title": {
                "en": "test",
                "ar": "test"
            },
            "variantsCount": 1,
            "availableColors": 1
        },
        {
            "_id": "679d1ce6a2962c2d8f14e646",
            "price": 120,
            "totalSold": 71,
            "title": {
                "en": "product 2",
                "ar": "product 2"
            },
            "variantsCount": 2,
            "availableColors": 2
        },
        {
            "_id": "679d1d26a2962c2d8f14e65a",
            "price": 130,
            "totalSold": 16,
            "title": {
                "en": "product 3",
                "ar": "product 3"
            },
            "variantsCount": 2,
            "availableColors": 2
        },
        {
            "_id": "679d1c0ca2962c2d8f14e5a5",
            "price": 110,
            "totalSold": 0,
            "title": {
                "en": "product 1",
                "ar": "product 1"
            },
            "variantsCount": 1,
            "availableColors": 3
        }
    ]
}
  -2{{URL}}/analytics/product-performance
  {
    "status": "success",
    "data": [
        {
            "_id": "679cf76ea2962c2d8f14e26e",
            "totalSold": 501,
            "title": {
                "en": "test",
                "ar": "test"
            },
            "revenue": 1002000,
            "reviewCount": 0
        },
        {
            "_id": "679d1ce6a2962c2d8f14e646",
            "totalSold": 71,
            "title": {
                "en": "product 2",
                "ar": "product 2"
            },
            "revenue": 8520,
            "reviewCount": 0
        },
        {
            "_id": "679d1d26a2962c2d8f14e65a",
            "totalSold": 16,
            "title": {
                "en": "product 3",
                "ar": "product 3"
            },
            "revenue": 2080,
            "reviewCount": 0
        },
        {
            "_id": "679d1c0ca2962c2d8f14e5a5",
            "totalSold": 1,
            "title": {
                "en": "product 1",
                "ar": "product 1"
            },
            "revenue": 110,
            "reviewCount": 0
        }
    ]
}
  -3{{URL}}/analytics/sales-by-sub-category
  {
    "status": "success",
    "data": [
        {
            "_id": "67923ba23bf29b9f172ee9c4",
            "categoryName": {
                "en": "Test",
                "ar": "اختبار"
            },
            "categorySlug": null,
            "subcategories": [
                {
                    "_id": "67923bd43bf29b9f172ee9c7",
                    "name": {
                        "en": "tshirt",
                        "ar": "asDsgfdhfjkhlj"
                    },
                    "slug": null,
                    "totalRevenue": 1002000,
                    "totalQuantitySold": 501,
                    "numberOfOrders": 2,
                    "numberOfProducts": 1,
                    "averageOrderValue": 501000
                }
            ],
            "totalRevenue": 1002000,
            "totalQuantitySold": 501,
            "numberOfOrders": 2,
            "averageOrderValue": 501000
        },
        {
            "_id": "6796826561c3489479c0aaf9",
            "categoryName": {
                "en": "category 2",
                "ar": "category 2"
            },
            "categorySlug": null,
            "subcategories": [
                {
                    "_id": "6796827f61c3489479c0aafc",
                    "name": {
                        "en": "subcategory 2",
                        "ar": "subcategory 2"
                    },
                    "slug": null,
                    "totalRevenue": 10600,
                    "totalQuantitySold": 87,
                    "numberOfOrders": 4,
                    "numberOfProducts": 2,
                    "averageOrderValue": 2650
                }
            ],
            "totalRevenue": 10600,
            "totalQuantitySold": 87,
            "numberOfOrders": 4,
            "averageOrderValue": 2650
        },
        {
            "_id": "6795589050cd52c79d0c3ebe",
            "categoryName": {
                "en": "category 1",
                "ar": "category 1"
            },
            "categorySlug": null,
            "subcategories": [
                {
                    "_id": "679558a250cd52c79d0c3ec1",
                    "name": {
                        "en": "sub category 1",
                        "ar": "sub category 1"
                    },
                    "slug": null,
                    "totalRevenue": 110,
                    "totalQuantitySold": 1,
                    "numberOfOrders": 1,
                    "numberOfProducts": 1,
                    "averageOrderValue": 110
                }
            ],
            "totalRevenue": 110,
            "totalQuantitySold": 1,
            "numberOfOrders": 1,
            "averageOrderValue": 110
        }
    ],
    "summary": {
        "totalCategories": 3,
        "totalSubcategories": 3,
        "totalRevenue": 1012710,
        "totalQuantitySold": 589,
        "totalOrders": 7,
        "averageOrderValue": 144672.85714285713
    }
}
    -4{{URL}}/analytics/customer-insights
    {
    "status": "success",
    "data": {
        "totalCustomers": 4,
        "onlineCustomers": 2,
        "offlineCustomers": 2,
        "newCustomers": 4,
        "topCustomers": [
            {
                "_id": "67955a2850cd52c79d0c4096",
                "totalOrders": 4,
                "totalSpent": 1007880,
                "averageOrderValue": 251970,
                "lastOrderDate": "2025-01-31T21:55:11.472Z",
                "name": "Tawfik",
                "email": "ahmed.elasiri1@gmail.com",
                "phone": "01146238575",
                "type": "online",
                "customerStatus": "VIP"
            },
            {
                "_id": "6795596b50cd52c79d0c3fd4",
                "totalOrders": 3,
                "totalSpent": 4230,
                "averageOrderValue": 1410,
                "lastOrderDate": "2025-01-31T19:14:04.345Z",
                "name": "Sara G",
                "email": "ahmedmostafat5124@gmail.com",
                "phone": "01146238572",
                "type": "online",
                "customerStatus": "Regular"
            },
            {
                "_id": "679d1e96a2962c2d8f14ea48",
                "totalOrders": 1,
                "totalSpent": 600,
                "averageOrderValue": 600,
                "lastOrderDate": "2025-01-31T19:04:45.793Z",
                "name": "Omar",
                "phone": "01066032819",
                "type": "offline",
                "customerStatus": "New"
            }
        ],
        "customerMetrics": {
            "averageOrderValue": 84660,
            "averageOrdersPerCustomer": 2.6666666666666665,
            "totalRevenue": 1012710,
            "customerCategories": {
                "vip": 1,
                "premium": 0,
                "regular": 1,
                "new": 1
            }
        }
    }
}
    -5{{URL}}/analytics/wishlist-analysis
    {
    "status": "success",
    "data": {
        "topWishlistedProducts": [
            {
                "_id": "679cf76ea2962c2d8f14e26e",
                "count": 1,
                "productTitle": {
                    "en": "test",
                    "ar": "test"
                },
                "productPrice": 2000
            },
            {
                "_id": "679d1d26a2962c2d8f14e65a",
                "count": 1,
                "productTitle": {
                    "en": "product 3",
                    "ar": "product 3"
                },
                "productPrice": 130
            }
        ],
        "averageWishlistSize": 0.4
    }
}
    -6{{URL}}/analytics/order-statistics
    {
    "status": "success",
    "data": {
        "orderStats": {
            "_id": null,
            "totalOrders": 9,
            "maxOrderValue": 1000000,
            "minOrderValue": 0,
            "averageOrderValue": 112544.44444444444,
            "totalRevenue": 1012900,
            "totalShippingCost": 190,
            "totalPaidAmount": 1003990,
            "pendingPayments": 8910,
            "netRevenue": 1012900
        },
        "ordersByDeliveryStatus": [
            {
                "count": 9,
                "totalAmount": 1012900,
                "status": "Delivered"
            }
        ],
        "ordersByPaymentStatus": [
            {
                "count": 5,
                "totalAmount": 1004180,
                "status": "Fully Paid"
            },
            {
                "count": 4,
                "totalAmount": 8720,
                "status": "Unpaid"
            }
        ],
        "ordersBySource": [
            {
                "count": 9,
                "totalAmount": 1012900,
                "source": "Cashier"
            }
        ],
        "returnStats": {
            "totalReturns": 0,
            "totalReturnAmount": 0
        },
        "dateRange": {
            "start": "2024-01-31T22:22:37.469Z",
            "end": "2025-01-31T22:22:37.469Z"
        }
    }
}
    -7{{URL}}/analytics/sales-by-time-period?startDate=2024-08-01&endDate=2025-08-31&groupBy=month or week or year
    {
    "status": "success",
    "data": {
        "timePeriod": {
            "start": "2024-08-01T00:00:00.000Z",
            "end": "2025-08-31T00:00:00.000Z",
            "groupBy": "month"
        },
        "summary": {
            "totalRevenue": 1012900,
            "totalOrders": 9,
            "totalShipping": 190,
            "totalPaid": 1003990,
            "totalPending": 8910
        },
        "sales": [
            {
                "totalAmount": 5880,
                "totalOrders": 1,
                "totalShipping": 0,
                "paidAmount": 0,
                "date": "2024-12",
                "pendingPayments": 5880
            },
            {
                "totalAmount": 1007020,
                "totalOrders": 8,
                "totalShipping": 190,
                "paidAmount": 1003990,
                "date": "2025-01",
                "pendingPayments": 3030
            }
        ]
    }
}
    befor start check the project code and structure and code style @src @App.tsx @context.tsx @hooks.tsx @components.t
    Note: after any update you should run "npm run build" to make sure you don't have any errors
 */