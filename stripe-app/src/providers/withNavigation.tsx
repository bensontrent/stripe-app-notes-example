// src/providers/withNavigation.tsx
//
// Every view (full-page, drawer, settings, ...) wraps itself in the same
// NavigationProvider with the same route config. That's what lets a drawer
// build links into the full-page app with `useNavigation()` even though the
// drawer never renders an AppRouter itself.

import { NavigationProvider } from "@stripe/ui-extension-sdk/navigation";
import type { ComponentType } from "react";
import { routes } from "../routes";

export function withNavigation<P extends object>(
  Component: ComponentType<P>,
): ComponentType<P> {
  return function ViewWithNavigation(props: P) {
    return (
      <NavigationProvider routes={routes}>
        <Component {...props} />
      </NavigationProvider>
    );
  };
}
