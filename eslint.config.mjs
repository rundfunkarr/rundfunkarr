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
      // Allow console for server-side logging
      "no-console": "off",
      // eslint-plugin-react-hooks 7.1 also flags setState reached through useCallback
      // fetchers called from effects. Keep it visible as a warning until those data
      // loaders are refactored.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
