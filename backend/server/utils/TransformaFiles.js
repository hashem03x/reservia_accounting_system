const transformProductData = (data) => {
  return data.map((product) => ({
    title: product.title,
    price: parseFloat(product.price),
    description: product.description,
    category: product.category || null,
    subcategory: product.subcategory || null,
    barcode: product.barcode || null,
    colors: JSON.parse(product.colors || '[]'),
  }));
};

const transformVariantData = (data) => {
  return data.map((variant) => ({
    productId: variant.productId,
    color: variant.color,
    size: variant.size,
    price: parseFloat(variant.price),
    sku: variant.sku,
    stock: JSON.parse(variant.stock || '[]'),
  }));
};


const formattedData = data.flatMap(product => 
  product.variants.map(variant => ({
    ProductTitle: product.title,
    Price: product.price,
    VariantSlug: variant.slug,
    Color: variant.color,
    Size: variant.size,
    SKU: variant.sku,
  }))
);

module.exports = { transformProductData, transformVariantData, formattedData };
