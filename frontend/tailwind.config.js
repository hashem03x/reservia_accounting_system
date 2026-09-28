/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontSize: {
        xs: ["0.75rem", "1.20rem"],
        sm: ["0.875rem", "1.45rem"],
        base: ["1rem", "1.65rem"],
        lg: ["1.125rem", "1.85rem"],
        xl: ["1.25rem", "2rem"],
      },
      fontFamily: {
        tajawal: ['"Tajawal"', "sans-serif"],
      },
      container: { center: true },
      animation: {
        "fade-in": "fade-in 0.35s",
      },
    },
  },
};
