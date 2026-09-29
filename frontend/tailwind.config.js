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
        // Utility classes (font-inter / font-cairo) for the rare spot that needs one explicitly -
        // the actual app-wide switch between the two happens via `dir`-scoped CSS variables in
        // index.css, not via these classes.
        inter: ['"Inter"', "sans-serif"],
        cairo: ['"Cairo"', "sans-serif"],
      },
      colors: {
        // Reservia Integrated Energy palette. `gray` is redefined (not just extended) with values
        // anchored directly on the design spec - gray-50/100/500/800 are exact hex matches for
        // background/borders/secondary-text/main-text - so the hundreds of pre-existing
        // `text-gray-*`/`bg-gray-*`/`border-gray-*` classes already used throughout every page
        // pick up the new professional palette automatically, without editing those pages. `white`
        // is already #FFFFFF (the spec's surface/card color), so it's untouched.
        gray: {
          50: "#F5F7F9", // background
          100: "#E1E7EC", // borders
          200: "#CBD3DA",
          300: "#AEB9C2",
          400: "#8D9BA6",
          500: "#66727F", // secondary text
          600: "#4F5B67",
          700: "#38424C",
          800: "#17212B", // main text
          900: "#0D1319",
        },
        // New named brand tokens for the handful of places that reference the brand color
        // directly (sidebar active state, links, dashboard tile accents) rather than the neutral
        // gray scale above.
        primary: {
          50: "#EAF0F5",
          100: "#CBDAE6",
          200: "#A8C0D4",
          300: "#82A3BF",
          400: "#5D85A8",
          500: "#396A91",
          600: "#123B5D", // brand primary - deep navy
          700: "#0F3352",
          800: "#0C2A45",
          900: "#081C30",
        },
        secondary: {
          50: "#E8F5EF",
          100: "#C3E6D6",
          200: "#9AD5BC",
          300: "#6FC3A1",
          400: "#4CAE89",
          500: "#369973",
          600: "#2E7D5B", // brand secondary / success - energy green
          700: "#276B4E",
          800: "#205740",
          900: "#17402F",
        },
        accent: {
          50: "#FCF6EA",
          100: "#F7E9CC",
          200: "#F0D9A8",
          300: "#E8C884",
          400: "#E0B968",
          500: "#DAB05C",
          600: "#D6A84F", // brand accent / warning - warm gold
          700: "#B98E3F",
          800: "#997434",
          900: "#785A28",
        },
        danger: {
          50: "#FBEAEA",
          100: "#F4CACA",
          200: "#EBA5A5",
          300: "#E17F7F",
          400: "#D96060",
          500: "#D15252",
          600: "#C94A4A", // error
          700: "#AD3F3F",
          800: "#8F3535",
          900: "#6E2828",
        },
      },
      container: { center: true },
      animation: {
        "fade-in": "fade-in 0.35s",
      },
    },
  },
};
