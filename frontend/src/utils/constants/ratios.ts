const ratios = {
  slide: {
    desktop: "3/1",
    mobile: "2/3",
  },
  product: "4/5",
  subcategory: "1/1",
};

export default ratios;

// ================ Helpers ================

export function getRatioLabel(ratio: string) {
  return ratio.split("/").join(":");
}
