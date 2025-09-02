module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "import", "jsdoc", "unused-imports"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:jsdoc/recommended",
    "plugin:import/typescript",
    "prettier"
  ],
  env: { es2022: true, node: true, jest: true },
  settings: { "import/resolver": { typescript: true } },
  ignorePatterns: ["dist/", "node_modules/", "*.d.ts"],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    experimentalDecorators: true,
    emitDecoratorMetadata: true
  },
  rules: {
    "unused-imports/no-unused-imports": "warn",
    "import/no-unresolved": "off",
    "import/namespace": "off",
    "import/no-duplicates": "off", 
    "import/export": "off",
    "import/default": "off",
    "import/no-named-as-default": "off",
    "import/no-named-as-default-member": "off",
    "jsdoc/require-param": "off",
    "jsdoc/require-returns": "off",
    "jsdoc/require-param-type": "off",
    "jsdoc/require-returns-type": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/ban-ts-comment": "warn"
  },
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parserOptions: { 
        project: false,
        experimentalDecorators: true,
        emitDecoratorMetadata: true
      }
    }
  ]
};