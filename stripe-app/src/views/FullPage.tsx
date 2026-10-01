// src/views/FullPage.tsx
//
// The `stripe.dashboard.fullpage` view: the team's task queue. It renders
// nothing of its own: AppRouter matches the current Dashboard URL against
// src/routes.tsx and renders the winning route. Each route decides its own
// layout (FullPageView with tabs, DetailPage, ...), which is why AppRouter
// isn't wrapped in a shared FullPageView here.
//
// `redirectOnNotFound` handles stale bookmarks and typos: an unmatched URL is
// *replaced* with the home route, so the user can't get stuck in a
// back-button loop on a page that doesn't exist.

import { AppRouter } from "@stripe/ui-extension-sdk/navigation";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { withNavigation } from "../providers/withNavigation";

function FullPage(context: ExtensionContextValue) {
  return <AppRouter context={context} redirectOnNotFound={{ key: "home" }} />;
}

export default withNavigation(FullPage);
