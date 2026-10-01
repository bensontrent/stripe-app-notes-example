// src/routes.tsx
//
// ============================================================================
//  Route config — the single place that maps URLs to views
// ============================================================================
//
// The full-page app owns the path after its base URL:
//
//   https://dashboard.stripe.com/<ACCOUNT>/app/<APP_ID>/notes/<note id>
//                                                     └──────────────┘
//
// Everything else in the app navigates by route *name* (`key`), never by raw
// path, so a pattern can change here without touching the call sites:
//
//   createAppRoute({ key: "home" })
//   navigateToAppRoute({ key: "note", params: { noteId } })
//
// The routes:
//
//   /:tabId?          the task queue. The optional segment is the tab:
//                     "/" everyone's tasks, "/mine", "/unassigned"
//                     (see pages/TaskQueue/tabs.ts)
//   /notes/:noteId    one note or task, in full
//
// Note that `/:tabId?` also matches any other single-segment URL ("/whatever"),
// so the queue validates the tab and redirects unknown values. Paths with
// more segments that match nothing fall through to AppRouter's
// `redirectOnNotFound` in views/FullPage.tsx.
//
// The `RouteRegister` declaration at the bottom is what makes every
// navigation call type-checked: an unknown key or a missing parameter is a
// compile error, not a broken link.
// ============================================================================

import { createRoutes, route } from "@stripe/ui-extension-sdk/navigation";

import { NoteDetail } from "./pages/NoteDetail";
import { TaskQueue } from "./pages/TaskQueue";

export const routes = createRoutes({
  // The render function receives the matched params and the view's
  // ExtensionContextValue (user, account, mode, viewport, ...).
  home: route("/:tabId?", (_params, context) => <TaskQueue context={context} />),

  note: route("/notes/:noteId", ({ noteId }, context) => (
    <NoteDetail noteId={noteId} context={context} />
  )),
});

declare module "@stripe/ui-extension-sdk/navigation" {
  interface RouteRegister {
    routes: typeof routes;
  }
}
