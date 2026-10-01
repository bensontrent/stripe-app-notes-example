// notes.ts, paywall.ts and settings.ts exist twice: here and in the backend
// (stripe-app-nextjs-backend/src/types). They are separate packages without
// a shared one, so the copies are kept identical by hand — and by this test,
// which fails the moment one side is changed without the other.
//
// It compares text, ignoring line endings. When the backend isn't checked
// out next to the app (the app can live in a repository of its own), there
// is nothing to compare and the test passes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SHARED = ["notes.ts", "paywall.ts", "settings.ts"];
const BACKEND_TYPES = join(__dirname, "..", "..", "..", "stripe-app-nextjs-backend", "src", "types");

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("types shared with the backend", () => {
  const backendPresent = existsSync(BACKEND_TYPES);

  for (const file of SHARED) {
    (backendPresent ? it : it.skip)(`${file} is identical in both projects`, () => {
      expect(read(join(__dirname, file))).toBe(read(join(BACKEND_TYPES, file)));
    });
  }
});
