/**
 * Tailwind, for the shadcn/ui components the console builds on (ADR-119). Everything else in
 * the console is plain CSS on the Organic tokens and passes through untouched.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
