export function getProductFinalPrice(priceAfterDiscount: number | null, price: number): number {
  return priceAfterDiscount || price;
}
