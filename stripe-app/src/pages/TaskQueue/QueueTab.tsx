// src/pages/TaskQueue/QueueTab.tsx
//
// One tab of the task queue: the table of tasks for that tab's assignee
// filter, and the side column with the numbers, the email switch and the
// plan.
//
// What is on screen is all in the URL or derived from it:
//
//   the tab        the path segment (see tabs.ts)        whose tasks
//   ?status=…      a search param, read with             which statuses;
//                  useSearchParam                        default: open and
//                                                        in progress
//
// so a filtered queue can be bookmarked and shared. Only the page number is
// local state. The order is the backend's: most urgent first, then oldest.
//
// Layout rule: PageModule must be a direct child of OverviewPage's columns
// (wrapping one in a Box throws "Invalid usage of PageModule" in the
// Dashboard), so the modules below are siblings in fragments and everything
// else goes inside them.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { useNavigation, useSearchParam } from "@stripe/ui-extension-sdk/navigation";
import {
  Banner,
  Box,
  Button,
  DataTable,
  Link,
  OverviewPage,
  PageModule,
  PropertyList,
  PropertyListItem,
  Select,
  Switch,
} from "@stripe/ui-extension-sdk/ui";
import { useEffect, useMemo, useState } from "react";
import { docsPageUrl, getTaskSummary } from "../../api/backend";
import Paywall from "../../components/Paywall";
import { useNotes } from "../../hooks/useNotes";
import { usePaywall } from "../../hooks/usePaywall";
import { useSettings } from "../../hooks/useSettings";
import { useTeam } from "../../hooks/useTeam";
import { aboutLabel, excerpt, formatDateTime, notificationText } from "../../notes/display";
import {
  PRIORITY_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
  type NoteListQuery,
  type StatusFilter,
  type TaskSummary,
  type UpdateNoteBody,
} from "../../types/notes";
import type { QueueTab as QueueTabConfig } from "./tabs";

export const PAGE_SIZE = 25;

const DEFAULT_STATUS_FILTER: StatusFilter = "active";

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  active: "Open and in progress",
  open: STATUS_LABELS.open,
  in_progress: STATUS_LABELS.in_progress,
  resolved: STATUS_LABELS.resolved,
  any: "All statuses",
};

/** The ?status= value, or the default for anything it doesn't recognise. */
export function readStatusFilter(value: unknown): StatusFilter {
  return typeof value === "string" && (STATUS_FILTERS as readonly string[]).includes(value)
    ? (value as StatusFilter)
    : DEFAULT_STATUS_FILTER;
}

const EMPTY_MESSAGES: Record<QueueTabConfig["id"], string> = {
  all: "No tasks match. Turn a note into a task from a customer, invoice or payment page.",
  mine: "Nothing is assigned to you here.",
  unassigned: "Every task has an owner.",
};

/** The five counts in the side column. Refetched whenever `version` changes. */
function useTaskSummary(context: ExtensionContextValue, version: number): TaskSummary | null {
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    getTaskSummary(context)
      .then((loaded) => {
        if (!cancelled) setSummary(loaded);
      })
      .catch(() => {
        // The table reports backend trouble; the numbers just stay blank.
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [context, version]);
  return summary;
}

/** What the plan module says when adding notes is allowed. */
function PlanSummary() {
  const { status } = usePaywall();
  if (!status) return null;
  if (status.reason === "test_mode") {
    return <Box css={{ color: "secondary" }}>Test mode is free and unlimited.</Box>;
  }
  if (status.reason === "subscribed") {
    return (
      <Box css={{ color: "secondary" }}>
        {status.subscription?.planName ?? "Your"} plan is active. Notes are unlimited.
      </Box>
    );
  }
  // Trialing: <Paywall> already shows what is left of the trial above this.
  return <Box css={{ color: "secondary" }}>Each note you add counts against the trial.</Box>;
}

type QueueTabProps = {
  context: ExtensionContextValue;
  tab: QueueTabConfig;
};

export function QueueTab({ context, tab }: QueueTabProps) {
  const { navigateToAppRoute } = useNavigation();
  const { nameOf, me } = useTeam();
  const settings = useSettings();

  // `replace` keeps a change of filter out of the back-button history.
  const [statusParam, setStatusParam] = useSearchParam("status", { replace: true });
  const statusFilter = readStatusFilter(statusParam);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [summaryVersion, setSummaryVersion] = useState(0);

  const query = useMemo<NoteListQuery>(
    () => ({
      tasksOnly: true,
      assignee: tab.assignee,
      status: statusFilter,
      sort: "priority",
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    [tab.assignee, statusFilter, page],
  );
  const tasks = useNotes(context, query);
  const summary = useTaskSummary(context, summaryVersion);

  /** A change made from the table: save, then refetch — the row may have left this list. */
  const change = async (id: string, changes: UpdateNoteBody) => {
    setNotice(null);
    const notification = await tasks.update(id, changes);
    if (notification === null) return;
    setNotice(notificationText(notification, nameOf(changes.assigneeId)));
    setSummaryVersion((version) => version + 1);
    await tasks.reload();
  };

  const items = tasks.items.map((task) => ({
    id: task.id,
    priority: PRIORITY_LABELS[task.priority],
    task: excerpt(task.body),
    about: aboutLabel(task),
    assignee: task.assigneeId ? nameOf(task.assigneeId) : "Unassigned",
    status: STATUS_LABELS[task.status],
    created: formatDateTime(task.createdAt),
  }));

  return (
    <OverviewPage
      primaryColumn={
        <PageModule
          title="Tasks"
          subtitle="Most urgent first, then oldest. Select a task to open it."
        >
          <Box css={{ stack: "y", gap: "medium" }}>
            <Box css={{ width: "1/3" }}>
              <Select
                label="Status"
                value={statusFilter}
                onChange={(event) => {
                  const next = readStatusFilter(event.target.value);
                  setPage(1);
                  // The default isn't written to the URL: one canonical URL per view.
                  setStatusParam(next === DEFAULT_STATUS_FILTER ? undefined : next);
                }}
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter} value={filter}>
                    {STATUS_FILTER_LABELS[filter]}
                  </option>
                ))}
              </Select>
            </Box>

            {tasks.actionError && (
              <Banner
                type="critical"
                title="That didn't work"
                description={tasks.actionError.message}
                onDismiss={tasks.clearActionError}
              />
            )}
            {notice && <Box css={{ font: "caption", color: "secondary" }}>{notice}</Box>}

            {tasks.status === "error" ? (
              <Box css={{ stack: "y", gap: "xsmall" }}>
                <Banner
                  type="critical"
                  title="Couldn't load the tasks"
                  description={tasks.error?.message ?? "Unknown error"}
                  actions={<Button onPress={tasks.reload}>Try again</Button>}
                />
                {tasks.error?.hint && (
                  <Box css={{ font: "caption", color: "secondary" }}>{tasks.error.hint}</Box>
                )}
              </Box>
            ) : (
              <DataTable
                loading={tasks.status === "loading"}
                columns={[
                  {
                    key: "priority",
                    label: "Priority",
                    cell: {
                      type: "status",
                      statusMap: {
                        [PRIORITY_LABELS.urgent]: "urgent",
                        [PRIORITY_LABELS.high]: "warning",
                        [PRIORITY_LABELS.normal]: "info",
                        [PRIORITY_LABELS.low]: "neutral",
                      },
                    },
                  },
                  { key: "task", label: "Task" },
                  { key: "about", label: "About" },
                  { key: "assignee", label: "Assigned to" },
                  {
                    key: "status",
                    label: "Status",
                    cell: {
                      type: "status",
                      statusMap: {
                        [STATUS_LABELS.open]: "info",
                        [STATUS_LABELS.in_progress]: "warning",
                        [STATUS_LABELS.resolved]: "positive",
                      },
                    },
                  },
                  { key: "created", label: "Created" },
                ]}
                items={items}
                emptyMessage={EMPTY_MESSAGES[tab.id]}
                onRowClick={(item) =>
                  navigateToAppRoute({ key: "note", params: { noteId: String(item.id) } })
                }
                rowActions={[
                  {
                    id: "assign-to-me",
                    label: "Assign to me",
                    onPress: (item) => change(String(item.id), { assigneeId: me || null }),
                  },
                  {
                    id: "in-progress",
                    label: "Mark in progress",
                    onPress: (item) => change(String(item.id), { status: "in_progress" }),
                  },
                  {
                    id: "resolve",
                    label: "Mark resolved",
                    onPress: (item) => change(String(item.id), { status: "resolved" }),
                  },
                ]}
                pagination={{
                  pageSize: PAGE_SIZE,
                  currentPage: page,
                  onPageChange: setPage,
                  hasMore: tasks.hasMore,
                }}
              />
            )}
          </Box>
        </PageModule>
      }
      secondaryColumn={
        <>
          <PageModule title="At a glance" subtitle="Open and in-progress tasks, whole team">
            <PropertyList>
              <PropertyListItem label="Open" value={summary ? String(summary.open) : "–"} />
              <PropertyListItem
                label="In progress"
                value={summary ? String(summary.inProgress) : "–"}
              />
              <PropertyListItem
                label="Assigned to you"
                value={summary ? String(summary.assignedToMe) : "–"}
              />
              <PropertyListItem
                label="Unassigned"
                value={summary ? String(summary.unassigned) : "–"}
              />
              <PropertyListItem label="Urgent" value={summary ? String(summary.urgent) : "–"} />
            </PropertyList>
          </PageModule>

          <PageModule title="Notifications">
            <Switch
              label="Email me when a task is assigned to me"
              description={
                settings.status === "error"
                  ? "Couldn't load this setting."
                  : `Applies to you, in ${context.environment.mode} mode.`
              }
              disabled={settings.status !== "ready"}
              checked={settings.settings.emailOnAssignment}
              onChange={(event) =>
                settings.updateUserSettings({ emailOnAssignment: event.target.checked })
              }
            />
          </PageModule>

          <PageModule title="Plan">
            <Paywall context={context} unit="note">
              <PlanSummary />
            </Paywall>
          </PageModule>

          <PageModule title="Adding notes">
            <Box css={{ stack: "y", gap: "small", color: "secondary" }}>
              <Box>
                Notes are written where the work is: open a customer, invoice or payment in
                the Dashboard, then open this app in the drawer.
              </Box>
              <Box>
                <Link href={docsPageUrl(context)} target="_blank" external>
                  How notes and tasks work
                </Link>
              </Box>
            </Box>
          </PageModule>
        </>
      }
    />
  );
}
