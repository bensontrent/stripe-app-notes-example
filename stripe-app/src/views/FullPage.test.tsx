// The full-page app, rendered through the real view (NavigationProvider +
// AppRouter + routes) against the in-memory router from
// src/testing/mockRouter.ts, with the backend mocked. Checked here: which
// tasks each URL asks the backend for, and what the URL becomes.

import { getMockContextProps, render } from "@stripe/ui-extension-sdk/testing";
import { DetailPage, OverviewPage } from "@stripe/ui-extension-sdk/ui";
import { Tabs } from "@stripe/ui-extension-sdk/ui/next";
import { getDashboardUserEmail } from "@stripe/ui-extension-sdk/utils";

import {
  checkInToTeam,
  getNote,
  getPaywallStatus,
  getSettings,
  getTaskSummary,
  getUserInfo,
  listNotes,
  updateNote,
} from "../api/backend";
import { PAGE_SIZE } from "../pages/TaskQueue/QueueTab";
import { flush, makeTask, TASK_ID, team, TEST_MODE } from "../testing/fixtures";
import { findAllInFragment, fragmentText, type RemoteNode } from "../testing/fragments";
import { installMockRouter } from "../testing/mockRouter";
import { DEFAULT_SETTINGS } from "../types/settings";
import FullPage from "./FullPage";

jest.mock("../api/backend", () => ({
  ...jest.requireActual("../api/backend"),
  checkInToTeam: jest.fn(),
  getNote: jest.fn(),
  getPaywallStatus: jest.fn(),
  getSettings: jest.fn(),
  getTaskSummary: jest.fn(),
  getUserInfo: jest.fn(),
  listNotes: jest.fn(),
  updateNote: jest.fn(),
}));

jest.mock("@stripe/ui-extension-sdk/utils", () => ({
  ...jest.requireActual("@stripe/ui-extension-sdk/utils"),
  getDashboardUserEmail: jest.fn(),
}));

const mockCheckIn = checkInToTeam as jest.MockedFunction<typeof checkInToTeam>;
const mockGetNote = getNote as jest.MockedFunction<typeof getNote>;
const mockStatus = getPaywallStatus as jest.MockedFunction<typeof getPaywallStatus>;
const mockSettings = getSettings as jest.MockedFunction<typeof getSettings>;
const mockSummary = getTaskSummary as jest.MockedFunction<typeof getTaskSummary>;
const mockUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>;
const mockList = listNotes as jest.MockedFunction<typeof listNotes>;
const mockUpdate = updateNote as jest.MockedFunction<typeof updateNote>;
const mockEmail = getDashboardUserEmail as jest.MockedFunction<typeof getDashboardUserEmail>;

const renderAt = async (href: string, searchParams = {}) => {
  const router = installMockRouter(href, searchParams);
  // The manifest's constants (stripe-app.dev.json); the link URLs need API_BASE.
  const context = getMockContextProps({
    environment: { constants: { API_BASE: "https://localhost:3006" } },
  });
  const result = render(<FullPage {...context} />);
  await flush();
  await result.update();
  await flush();
  await result.update();
  return { router, context, ...result };
};

/** The task table: it lives in OverviewPage's primaryColumn, an element prop. */
const findTable = (wrapper: ReturnType<typeof render>["wrapper"]): RemoteNode => {
  const [table] = findAllInFragment(wrapper.find(OverviewPage)!.props.primaryColumn, "DataTable");
  return table;
};

describe("the task queue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmail.mockResolvedValue({ email: "alice@example.com" } as Awaited<
      ReturnType<typeof getDashboardUserEmail>
    >);
    mockCheckIn.mockImplementation(async (context) => team(context.userContext?.id ?? ""));
    mockStatus.mockResolvedValue(TEST_MODE);
    mockUserInfo.mockResolvedValue(null);
    mockSettings.mockResolvedValue({ settings: DEFAULT_SETTINGS, account: {}, user: {}, mode: "test" });
    mockSummary.mockResolvedValue({ open: 3, inProgress: 1, assignedToMe: 2, unassigned: 1, urgent: 1 });
    mockList.mockResolvedValue({ notes: [makeTask()], hasMore: false });
  });

  it("opens on everyone's unfinished tasks, most urgent first", async () => {
    const { wrapper } = await renderAt("/");

    expect(wrapper.find(Tabs)!.props.selectedKey).toBe("all");
    // Only the selected tab loads.
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(expect.anything(), {
      tasksOnly: true,
      assignee: "anyone",
      status: "active",
      sort: "priority",
      limit: PAGE_SIZE,
      offset: 0,
    });

    expect(findTable(wrapper).props?.items).toEqual([
      expect.objectContaining({
        id: TASK_ID,
        priority: "Urgent",
        task: "Charged twice. Refund one.",
        about: "Invoice ABC-0001 · Jane Doe",
        assignee: "Bob Example",
        status: "Open",
      }),
    ]);
  });

  it("shows the team's numbers beside the table", async () => {
    const { wrapper } = await renderAt("/");

    const column = wrapper.find(OverviewPage)!.props.secondaryColumn;
    expect(findAllInFragment(column, "PageModule").map((module) => module.props?.title)).toEqual([
      "At a glance",
      "Notifications",
      "Plan",
      "Adding notes",
    ]);
    const counts = findAllInFragment(column, "PropertyListItem").map(
      (item) => `${fragmentText(item.props?.label)}: ${fragmentText(item.props?.value)}`,
    );
    expect(counts).toEqual([
      "Open: 3",
      "In progress: 1",
      "Assigned to you: 2",
      "Unassigned: 1",
      "Urgent: 1",
    ]);
  });

  it("puts the selected tab in the URL and asks for that tab's tasks", async () => {
    const { router, wrapper, update } = await renderAt("/");

    wrapper.find(Tabs)!.trigger("onSelectionChange", "mine");
    await update();
    await flush();
    await update();

    expect(router.getHref()).toBe("/mine");
    expect(wrapper.find(Tabs)!.props.selectedKey).toBe("mine");
    expect(mockList).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ assignee: "me", status: "active" }),
    );
    // Tab changes are ordinary navigations: a new history entry each.
    expect(router.history).toEqual(["/", "/mine"]);
  });

  it("addresses the default tab as the bare home URL", async () => {
    const { router, wrapper, update } = await renderAt("/unassigned");
    expect(mockList).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ assignee: "unassigned" }),
    );

    wrapper.find(Tabs)!.trigger("onSelectionChange", "all");
    await update();

    expect(router.getHref()).toBe("/");
  });

  it("reads the status filter from the URL", async () => {
    await renderAt("/", { status: "resolved" });

    expect(mockList).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "resolved" }),
    );
  });

  it("falls back to unfinished tasks for a status it doesn't know", async () => {
    await renderAt("/", { status: "whatever" });

    expect(mockList).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "active" }),
    );
  });

  it("opens a task's page when its row is selected", async () => {
    mockGetNote.mockResolvedValue(makeTask());
    const { router, wrapper, update } = await renderAt("/");

    (findTable(wrapper).props?.onRowClick as (item: { id: string }) => void)({ id: TASK_ID });
    await update();
    await flush();
    await update();

    expect(router.getHref()).toBe(`/notes/${TASK_ID}`);
  });

  it("assigns a task to the current user from the row menu, then refetches", async () => {
    const { context, wrapper, update } = await renderAt("/");
    const me = context.userContext.id!;
    mockUpdate.mockResolvedValue({ note: makeTask({ assigneeId: me }), notification: "none" });

    const actions = findTable(wrapper).props?.rowActions as Array<{
      id: string;
      onPress: (item: { id: string }) => void;
    }>;
    actions.find((action) => action.id === "assign-to-me")!.onPress({ id: TASK_ID });
    await flush();
    await update();
    await flush();
    await update();

    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), TASK_ID, { assigneeId: me });
    // The row may no longer belong in this list, and the numbers moved.
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockSummary).toHaveBeenCalledTimes(2);
  });

  it("redirects unknown single-segment paths home (replace, not push)", async () => {
    const { router } = await renderAt("/no-such-tab");

    expect(router.getHref()).toBe("/");
    expect(router.history).toEqual(["/"]);
  });

  it("redirects unmatched deeper paths home via redirectOnNotFound", async () => {
    const { router } = await renderAt("/a/b/c/d");

    expect(router.getHref()).toBe("/");
    expect(router.history).toEqual(["/"]);
  });
});

describe("a note's page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmail.mockResolvedValue({ email: "alice@example.com" } as Awaited<
      ReturnType<typeof getDashboardUserEmail>
    >);
    mockCheckIn.mockImplementation(async (context) => team(context.userContext?.id ?? ""));
  });

  it("shows the task with a way back to the queue and a link to its object", async () => {
    mockGetNote.mockResolvedValue(makeTask());
    const { wrapper } = await renderAt(`/notes/${TASK_ID}`);

    const page = wrapper.find(DetailPage)!;
    expect(mockGetNote).toHaveBeenCalledWith(expect.anything(), TASK_ID);
    expect(page.props.title).toBe("Task");
    expect(page.props.description).toBe("Invoice ABC-0001 · Jane Doe");
    expect(page.props.breadcrumbs.map((crumb) => crumb.label)).toEqual(["Tasks"]);
    expect(page.props.breadcrumbs[0].route.params?.glob).toEqual([]);

    expect(fragmentText(page.props.primaryColumn)).toContain("Charged twice. Refund one.");
    // Each PropertyListItem's value is an element prop of its own: a fragment
    // inside the column's fragment.
    const links = findAllInFragment(page.props.secondaryColumn, "PropertyListItem").flatMap(
      (item) => findAllInFragment(item.props?.value, "Link"),
    );
    expect(links.map((link) => link.props?.href)).toEqual([
      { name: "invoiceDetails", params: { invoiceId: "in_456" } },
      { name: "customerDetails", params: { customerId: "cus_123" } },
    ]);
  });

  it("says so when the note doesn't exist", async () => {
    mockGetNote.mockResolvedValue(null);
    const { wrapper } = await renderAt(`/notes/${TASK_ID}`);

    expect(wrapper.find(DetailPage)!.props.title).toBe("Note not found");
  });

  it("doesn't ask the backend about something that isn't a note id", async () => {
    const { wrapper } = await renderAt("/notes/not-an-id");

    expect(wrapper.find(DetailPage)!.props.title).toBe("Note not found");
    expect(mockGetNote).not.toHaveBeenCalled();
  });
});
