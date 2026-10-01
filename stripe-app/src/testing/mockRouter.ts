// src/testing/mockRouter.ts
//
// ============================================================================
//  A fake ExtensionRouter for Jest
// ============================================================================
//
// In the Dashboard, the host injects a router at `globalThis.__extRouter`
// during sandbox initialisation; every navigation hook and component in
// @stripe/ui-extension-sdk/navigation talks to it. Nothing injects it under
// Jest, so `useNavigation()` throws "ExtensionRouter is not found".
//
// This module installs a small in-memory implementation of the same
// interface so routed views can be rendered with `render()` from
// @stripe/ui-extension-sdk/testing:
//
//   const router = installMockRouter("/");
//   render(<NavigationProvider routes={routes}><AppRouter context={ctx} /></NavigationProvider>);
//   ...
//   expect(router.getHref()).toBe("/mine");
//
// It implements the documented pattern syntax (static segments, `:param`,
// `:param?`) and keeps a history array so tests can assert on push vs.
// replace. It is a test double, not a re-implementation of the Dashboard.

import type {
  ExtensionRouter,
  HrefListener,
  RouteDescriptor,
  RoutesConfig,
  SearchParams,
} from "@stripe/ui-extension-sdk/types/global.navigation";

type Params = Record<string, string | undefined>;

// Patterns keep their "?" (optional marker); hrefs drop theirs (query string).
const patternSegments = (pattern: string): string[] =>
  pattern.split("/").filter(Boolean);
const hrefSegments = (href: string): string[] =>
  patternSegments(href.split("?")[0]);

/** Match a pattern like "/customers/:id/invoices/:invoiceId?" against a href. */
export function matchPattern(pattern: string, href: string): Params | null {
  const patternParts = patternSegments(pattern);
  const hrefParts = hrefSegments(href);
  const params: Params = {};
  let cursor = 0;

  for (const segment of patternParts) {
    if (!segment.startsWith(":")) {
      if (hrefParts[cursor] !== segment) return null;
      cursor += 1;
      continue;
    }
    const optional = segment.endsWith("?");
    const name = segment.slice(1, optional ? -1 : undefined);
    const value = hrefParts[cursor];
    if (value === undefined) {
      if (!optional) return null;
      params[name] = undefined;
      continue;
    }
    params[name] = value;
    cursor += 1;
  }

  return cursor === hrefParts.length ? params : null;
}

/** Build the path segments for a pattern from a params object. */
export function buildSegments(pattern: string, params: Params): string[] {
  const segments: string[] = [];
  for (const segment of patternSegments(pattern)) {
    if (!segment.startsWith(":")) {
      segments.push(segment);
      continue;
    }
    const optional = segment.endsWith("?");
    const name = segment.slice(1, optional ? -1 : undefined);
    const value = params[name];
    if (value === undefined) {
      if (optional) continue;
      throw new Error(`Missing required route param "${name}" for ${pattern}`);
    }
    segments.push(value);
  }
  return segments;
}

export type MockRouter = ExtensionRouter & {
  /** Every href the router has been set to, in order; replaces overwrite the last entry. */
  readonly history: string[];
};

export function installMockRouter(
  initialHref = "/",
  initialSearchParams: SearchParams = {},
): MockRouter {
  let href = initialHref;
  let searchParams: SearchParams = initialSearchParams;
  const history = [initialHref];
  const listeners = new Set<HrefListener>();

  const notify = () => listeners.forEach((listener) => listener({ href }));

  const router: MockRouter = {
    history,
    getHref: () => href,
    getSearchParams: () => searchParams,

    setHref(next, options) {
      href = next;
      if (options?.searchParams !== undefined) searchParams = options.searchParams;
      if (options?.replace) history[history.length - 1] = next;
      else history.push(next);
      notify();
    },

    listenToHref(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    validateRoutes: (config) => config,
    registerRoutes: () => undefined,

    createPathSegments(config: RoutesConfig, route: RouteDescriptor) {
      const definition = config[route.key];
      if (!definition) throw new Error(`Unknown route "${route.key}"`);
      return buildSegments(definition.path, route.params ?? {});
    },

    setRoute(config, route, options) {
      const segments = router.createPathSegments(config, route);
      router.setHref(`/${segments.join("/")}`, {
        ...options,
        searchParams: route.searchParams ?? {},
      });
    },

    getMatchedRoute(config, currentHref) {
      for (const [key, routeDefinition] of Object.entries(config)) {
        const routeParams = matchPattern(routeDefinition.path, currentHref);
        if (routeParams) return { key, routeDefinition, routeParams };
      }
      return null;
    },
  };

  (globalThis as { __extRouter?: ExtensionRouter }).__extRouter = router;
  return router;
}
