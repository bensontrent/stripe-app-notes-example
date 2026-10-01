// src/pages/TaskQueue/index.tsx
//
// The `home` route (`/:tabId?`): the team's task queue, the page support
// staff work from. Three tabs — everyone's tasks, mine, unassigned — with the
// selected tab read from the URL with `useAppRoute()` and written back with
// `navigateToAppRoute`, so tabs are bookmarkable and the browser's
// back/forward buttons move between them.
//
// The providers here serve the whole page: the team (the check-in that makes
// this user assignable, plus everyone's names), this user's settings (the
// email switch) and the paywall status (the plan module).

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import {
  Redirect,
  useAppRoute,
  useNavigation,
} from "@stripe/ui-extension-sdk/navigation";
import { FullPageView } from "@stripe/ui-extension-sdk/ui";
import { Tab, Tabs } from "@stripe/ui-extension-sdk/ui/next";
import { PaywallProvider } from "../../hooks/usePaywall";
import { SettingsProvider } from "../../hooks/useSettings";
import { TeamProvider } from "../../hooks/useTeam";
import { QueueTab } from "./QueueTab";
import { DEFAULT_TAB, isQueueTab, QUEUE_TABS, queueRoute } from "./tabs";

type TaskQueueProps = {
  context: ExtensionContextValue;
};

export function TaskQueue({ context }: TaskQueueProps) {
  const route = useAppRoute();
  const { navigateToAppRoute } = useNavigation();

  // Checking `route.key` first narrows `routeParams` to this route's shape:
  // `{ tabId: string | undefined }`, straight from the "/:tabId?" pattern.
  const requestedTab = route.key === "home" ? route.routeParams.tabId : undefined;

  // "/:tabId?" matches *any* single segment, so "/whatever" lands here too.
  // Treat unknown values like an unmatched route: replace the URL with home.
  if (requestedTab !== undefined && !isQueueTab(requestedTab)) {
    return <Redirect route={{ key: "home" }} />;
  }

  const currentTab = requestedTab ?? DEFAULT_TAB;

  return (
    <TeamProvider context={context}>
      <SettingsProvider context={context}>
        <PaywallProvider context={context}>
          <FullPageView>
            <Tabs
              selectedKey={currentTab}
              onSelectionChange={(tabId) => {
                if (isQueueTab(tabId)) navigateToAppRoute(queueRoute(tabId));
              }}
            >
              {QUEUE_TABS.map((tab) => (
                <Tab key={tab.id} id={tab.id} label={tab.label}>
                  {/* Only the selected tab loads its tasks. */}
                  {tab.id === currentTab ? <QueueTab context={context} tab={tab} /> : null}
                </Tab>
              ))}
            </Tabs>
          </FullPageView>
        </PaywallProvider>
      </SettingsProvider>
    </TeamProvider>
  );
}
