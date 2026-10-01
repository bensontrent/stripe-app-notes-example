// src/pages/TaskQueue/tabs.ts
//
// The task queue's route is `/:tabId?`, so the selected tab is part of the
// URL: "/" is everyone's tasks, "/mine" and "/unassigned" the other two.
// Keeping the list here (rather than in the Tabs markup) lets the route
// validate what it receives and lets other pages build links to a tab
// without knowing the pattern.

import type { AssigneeFilter } from "../../types/notes";

export type QueueTabId = "all" | "mine" | "unassigned";

export type QueueTab = {
  id: QueueTabId;
  label: string;
  /** Whose tasks the tab lists. */
  assignee: AssigneeFilter;
};

export const QUEUE_TABS: readonly QueueTab[] = [
  { id: "all", label: "Everyone", assignee: "anyone" },
  { id: "mine", label: "Assigned to me", assignee: "me" },
  { id: "unassigned", label: "Unassigned", assignee: "unassigned" },
];

export const DEFAULT_TAB: QueueTabId = "all";

export const isQueueTab = (value: string): value is QueueTabId =>
  QUEUE_TABS.some((tab) => tab.id === value);

/**
 * Route descriptor for a queue tab, for `createAppRoute` / `navigateToAppRoute`.
 * The default tab is addressed as "/" (no parameter) so every view has exactly
 * one canonical URL: "/" and "/all" would otherwise be the same page.
 */
export function queueRoute(tabId: QueueTabId) {
  return tabId === DEFAULT_TAB
    ? { key: "home" as const }
    : { key: "home" as const, params: { tabId } };
}
