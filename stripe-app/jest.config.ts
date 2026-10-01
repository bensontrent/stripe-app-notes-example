import type {Config} from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  roots: ['./src'],
  transform: {
    ".+\.(svg|css|styl|less|sass|scss|png|jpg|ttf|woff|woff2)$": "jest-transform-stub",
    // The SDK ships ES modules; let ts-jest compile them for Jest (CommonJS).
    "^.+\.[jt]sx?$": ["ts-jest", { tsconfig: { allowJs: true, module: "commonjs" } }],
  },
  transformIgnorePatterns: ["node_modules/(?!(@stripe/ui-extension-sdk|@remote-ui)/)"],
};

export default config;
