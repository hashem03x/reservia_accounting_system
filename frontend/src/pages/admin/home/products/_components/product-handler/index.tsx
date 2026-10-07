import { Product } from "@/types/product";
import ProductFormProvider from "./context";
import ProductBasicInfo from "./basic";

export default function ProductHandler({ product }: { product?: Product }) {
  return (
    <ProductFormProvider product={product}>
      <div className="root-flex-1 flex min-h-full flex-col gap-4">
        <ProductBasicInfo />
      </div>
    </ProductFormProvider>
  );
}
