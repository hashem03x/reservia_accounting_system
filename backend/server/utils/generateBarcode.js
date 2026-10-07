function generateBarcode() {
  const min = Math.pow(10, 11); // 12-digit number starts from 100000000000
  const max = Math.pow(10, 12) - 1; // 12-digit number ends at 999999999999
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = generateBarcode;
