export default function generateRandomNumber(x: number): number {
  if (x <= 0) {
    throw new Error("The number of digits must be greater than 0.");
  }

  const min = Math.pow(10, x - 1);
  const max = Math.pow(10, x) - 1;

  return Math.floor(Math.random() * (max - min + 1)) + min;
}
