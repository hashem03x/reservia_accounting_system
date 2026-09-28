import { PaginatedData } from "@/types/global";
import { Product } from "@/types/product";

export function filterPaginatedProducts(paginatedProducts: PaginatedData<Product>): PaginatedData<Product> {
  if (!paginatedProducts) return null;

  const filteredColorsProducts = paginatedProducts.data.map((product) => {
    // Filter colors that have at least one variant available in stock
    const filteredColors = product.colors.filter((color) =>
      product.variants.some((variant) => variant.color === color.name && variant.stock.some((s) => s.quantity > 0)),
    );

    return { ...product, colors: filteredColors };
  });

  return {
    ...paginatedProducts,
    data: filteredColorsProducts.filter((product) => product.colors.length > 0),
  };
}

// =============================================================

export function filterProduct(product: Product): Product {
  const filteredColors = product.colors.filter((color) =>
    product.variants.some((variant) => variant.color === color.name && variant.stock.some((s) => s.quantity > 0)),
  );

  // Here, we also need to filter the variants that have no stock available or that are deleted
  const filteredVariants = product.variants.filter(
    (variant) => variant.stock.some((s) => s.quantity > 0) && !variant.isDeleted,
  );

  return { ...product, colors: filteredColors, variants: filteredVariants };
}

// =============================================================

export function getProductFinalPrice(priceAfterDiscount: number | null, price: number): number {
  return priceAfterDiscount || price;
}
