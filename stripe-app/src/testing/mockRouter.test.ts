import { buildSegments, installMockRouter, matchPattern } from "./mockRouter";

describe("matchPattern", () => {
  it("matches static segments", () => {
    expect(matchPattern("/", "/")).toEqual({});
    expect(matchPattern("/examples", "/examples")).toEqual({});
    expect(matchPattern("/examples", "/other")).toBeNull();
  });

  it("extracts required params", () => {
    expect(matchPattern("/examples/:slug", "/examples/routing")).toEqual({
      slug: "routing",
    });
    expect(matchPattern("/examples/:slug", "/examples")).toBeNull();
  });

  it("treats optional params as absent when missing", () => {
    expect(matchPattern("/:tabId?", "/")).toEqual({ tabId: undefined });
    expect(matchPattern("/:tabId?", "/routing")).toEqual({ tabId: "routing" });
    expect(matchPattern("/:tabId?", "/a/b")).toBeNull();
  });

  it("handles nested params and ignores the query string", () => {
    expect(
      matchPattern(
        "/customers/:customerId/invoices/:invoiceId",
        "/customers/cus_1/invoices/in_2?app[x]=1",
      ),
    ).toEqual({ customerId: "cus_1", invoiceId: "in_2" });
  });
});

describe("buildSegments", () => {
  it("fills params and skips missing optional ones", () => {
    expect(buildSegments("/:tabId?", {})).toEqual([]);
    expect(buildSegments("/:tabId?", { tabId: "examples" })).toEqual(["examples"]);
    expect(
      buildSegments("/customers/:customerId/invoices/:invoiceId", {
        customerId: "cus_1",
        invoiceId: "in_2",
      }),
    ).toEqual(["customers", "cus_1", "invoices", "in_2"]);
  });

  it("throws on a missing required param", () => {
    expect(() => buildSegments("/examples/:slug", {})).toThrow(/slug/);
  });
});

describe("installMockRouter", () => {
  it("records pushes and replaces separately", () => {
    const router = installMockRouter("/");
    router.setHref("/examples");
    router.setHref("/examples", { replace: true, searchParams: { status: "done" } });
    expect(router.history).toEqual(["/", "/examples"]);
    expect(router.getSearchParams()).toEqual({ status: "done" });
  });

  it("notifies listeners and supports unsubscribe", () => {
    const router = installMockRouter("/");
    const listener = jest.fn();
    const unsubscribe = router.listenToHref(listener);
    router.setHref("/routing");
    expect(listener).toHaveBeenCalledWith({ href: "/routing" });
    unsubscribe();
    router.setHref("/");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
