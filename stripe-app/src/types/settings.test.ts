// Unit tests for the settings model: how a stored jsonb row becomes the flat
// Settings object, and what a patch may contain.

import {
  DEFAULT_SETTINGS,
  keysForScope,
  resetPatch,
  resolveScope,
  resolveSettings,
  validatePatch,
} from "./settings";

describe("resolveSettings", () => {
  it("falls back to defaults when nothing is stored", () => {
    expect(resolveSettings({}, {})).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings(null, undefined)).toEqual(DEFAULT_SETTINGS);
    // Assignment emails are on until someone switches them off.
    expect(DEFAULT_SETTINGS.emailOnAssignment).toBe(true);
  });

  it("reads each scope's own keys only", () => {
    // A user setting stored on the account row is ignored.
    expect(resolveSettings({ emailOnAssignment: false }, {})).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({}, { emailOnAssignment: false })).toEqual({
      ...DEFAULT_SETTINGS,
      emailOnAssignment: false,
    });
  });

  it("ignores stored values of the wrong type", () => {
    expect(resolveSettings({}, { emailOnAssignment: "no" })).toEqual(DEFAULT_SETTINGS);
  });

  it("resolveScope returns only what is stored, without defaults", () => {
    expect(resolveScope({ emailOnAssignment: false }, "user")).toEqual({
      emailOnAssignment: false,
    });
    expect(resolveScope({}, "user")).toEqual({});
    expect(resolveScope({ emailOnAssignment: false }, "account")).toEqual({});
  });
});

describe("validatePatch", () => {
  it("accepts a well-formed patch as-is", () => {
    expect(validatePatch("user", { emailOnAssignment: false })).toEqual({
      ok: true,
      stored: { emailOnAssignment: false },
    });
  });

  it("passes null through so the database can delete the key", () => {
    expect(validatePatch("user", { emailOnAssignment: null })).toEqual({
      ok: true,
      stored: { emailOnAssignment: null },
    });
  });

  it("rejects keys from the other scope", () => {
    const result = validatePatch("account", { emailOnAssignment: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/user setting/);
  });

  it("rejects unknown keys, including prototype names", () => {
    expect(validatePatch("user", { theme: "dark" }).ok).toBe(false);
    expect(validatePatch("user", { __proto__: { polluted: true } }).ok).toBe(false);
    expect(validatePatch("user", { constructor: "x" }).ok).toBe(false);
  });

  it("rejects wrong types and non-objects", () => {
    expect(validatePatch("user", { emailOnAssignment: "yes" }).ok).toBe(false);
    expect(validatePatch("user", []).ok).toBe(false);
    expect(validatePatch("user", null).ok).toBe(false);
    expect(validatePatch("user", {}).ok).toBe(false);
  });
});

describe("resetPatch", () => {
  it("nulls every key of the scope", () => {
    expect(resetPatch("user")).toEqual({ emailOnAssignment: null });
    expect(Object.keys(resetPatch("account"))).toEqual(keysForScope("account"));
  });
});
