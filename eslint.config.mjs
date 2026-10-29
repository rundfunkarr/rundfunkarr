import nextConfig from "eslint-config-next";
import eslintConfigPrettier from "eslint-config-prettier";

const eslintConfig = [
  ...nextConfig,
  eslintConfigPrettier,
  {
    rules: {
      // Relaxed rules for open-source friendliness
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Server code logs through src/lib/logger.ts (levels, redaction, log viewer).
      "no-console": "error",
    },
  },
  {
    files: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/lib/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
