// The notes drawer, rendered through a real view (CustomerNotes) with the
// backend and the Stripe lookups mocked. What is checked here is the wiring:
// which requests the drawer makes for the object it is open on, and what it
// shows for the answers.

import { getMockContextProps, render } from "@stripe/ui-extension-sdk/testing";
import { Banner, Button, ContextView, Link, TextArea } from "@stripe/ui-extension-sdk/ui";
import { getDashboardUserEmail } from "@stripe/ui-extension-sdk/utils";

import {
  checkInToTeam,
  createNote,
  deleteNote,
  getPaywallStatus,
  getUserInfo,
  listNotes,
  updateNote,
} from "../api/backend";
import { describeNoteTarget } from "../api/stripeObjects";
import {
  flush,
  makeNote,
  makeTask,
  statusFor,
  TASK_ID,
  team,
  TEST_MODE,
} from "../testing/fixtures";
import { findAllInFragment, fragmentText } from "../testing/fragments";
import { installMockRouter } from "../testing/mockRouter";
import CustomerNotes from "./CustomerNotes";

jest.mock("../api/backend", () => ({
  ...jest.requireActual("../api/backend"),
  checkInToTeam: jest.fn(),
  createNote: jest.fn(),
  deleteNote: jest.fn(),
  getPaywallStatus: jest.fn(),
  listNotes: jest.fn(),
  updateNote: jest.fn(),
  // The upgrade steps render <Login>, which asks who is logged in.
  getUserInfo: jest.fn(),
}));

jest.mock("../api/stripeObjects", () => ({
  ...jest.requireActual("../api/stripeObjects"),
  describeNoteTarget: jest.fn(),
}));

jest.mock("@stripe/ui-extension-sdk/utils", () => ({
  ...jest.requireActual("@stripe/ui-extension-sdk/utils"),
  getDashboardUserEmail: jest.fn(),
}));

const mockCheckIn = checkInToTeam as jest.MockedFunction<typeof checkInToTeam>;
const mockCreate = createNote as jest.MockedFunction<typeof createNote>;
const mockDelete = deleteNote as jest.MockedFunction<typeof deleteNote>;
const mockStatus = getPaywallStatus as jest.MockedFunction<typeof getPaywallStatus>;
const mockList = listNotes as jest.MockedFunction<typeof listNotes>;
const mockUpdate = updateNote as jest.MockedFunction<typeof updateNote>;
const mockUserInfo = getUserInfo as jest.MockedFunction<typeof getUserInfo>;
const mockDescribe = describeNoteTarget as jest.MockedFunction<typeof describeNoteTarget>;
const mockEmail = getDashboardUserEmail as jest.MockedFunction<typeof getDashboardUserEmail>;

const onCustomer = () =>
  getMockContextProps({
    environment: { objectContext: { id: "cus_123", object: "customer" } },
  });

type Wrapper = ReturnType<typeof render>["wrapper"];

const findButton = (wrapper: Wrapper, label: string) =>
  wrapper.findAll(Button).find((button) => button.text.includes(label));

const renderDrawer = async (context = onCustomer()) => {
  const rendered = render(<CustomerNotes {...context} />);
  await flush();
  await rendered.update();
  await flush();
  await rendered.update();
  return { ...rendered, context };
};

describe("the notes drawer on a customer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The drawer links to the task queue with useNavigation().
    installMockRouter("/");
    mockEmail.mockResolvedValue({ email: "alice@example.com" } as Awaited<
      ReturnType<typeof getDashboardUserEmail>
    >);
    mockCheckIn.mockResolvedValue(team("usr_alice"));
    mockStatus.mockResolvedValue(TEST_MODE);
    mockUserInfo.mockResolvedValue(null);
    mockDescribe.mockResolvedValue({
      objectType: "customer",
      objectId: "cus_123",
      customerId: "cus_123",
      objectLabel: "Jane Doe",
      customerLabel: "Jane Doe",
    });
    mockList.mockResolvedValue({ notes: [makeTask(), makeNote()], hasMore: false });
  });

  it("asks for everything about the customer and checks the user in", async () => {
    const { wrapper } = await renderDrawer();

    expect(mockList).toHaveBeenCalledWith(expect.anything(), {
      objectType: "customer",
      objectId: "cus_123",
    });
    // The check-in carries the email the Dashboard gave us.
    expect(mockCheckIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "alice@example.com" }),
    );

    expect(wrapper.text).toContain("Called about a refund.");
    expect(wrapper.text).toContain("Charged twice. Refund one.");
    expect(wrapper.text).toContain("Notes (2)");
    // Names come from the team, not from the note.
    expect(wrapper.text).toContain("Assigned to Bob Example");
  });

  it("says where a note from the customer's invoice was written, with a link to it", async () => {
    const { wrapper } = await renderDrawer();

    const origins = wrapper
      .findAll(Link)
      .filter((link) => link.text.includes("Written on"));
    expect(origins).toHaveLength(1);
    expect(origins[0].text).toBe("Written on invoice ABC-0001");
    expect(origins[0].props.href).toEqual({
      name: "invoiceDetails",
      params: { invoiceId: "in_456" },
    });
  });

  it("links to the task queue in the full-page app", async () => {
    const { wrapper } = await renderDrawer();

    // `actions` is an element prop, so it arrives as a fragment.
    const [button] = findAllInFragment(wrapper.find(ContextView)!.props.actions, "Button");
    expect(fragmentText(button)).toBe("Open the task queue");
    // createAppRoute() produces a fullPageGlob descriptor; [] is the app's "/".
    expect(button.props?.href).toMatchObject({ name: "fullPageGlob", params: { glob: [] } });
  });

  it("files a new note under the customer and shows it", async () => {
    const created = makeNote({ id: "33333333-3333-4333-8333-333333333333", body: "New note." });
    mockCreate.mockResolvedValue({
      created: true,
      note: created,
      notification: "none",
      status: TEST_MODE,
    });
    const { wrapper, update } = await renderDrawer();

    wrapper.find(TextArea)!.trigger("onChange", { target: { value: "  New note.  " } });
    await update();
    findButton(wrapper, "Add note")!.trigger("onPress");
    await flush();
    await update();

    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), {
      objectType: "customer",
      objectId: "cus_123",
      customerId: "cus_123",
      objectLabel: "Jane Doe",
      customerLabel: "Jane Doe",
      body: "New note.",
      isTask: false,
      priority: "normal",
      assigneeId: null,
    });
    expect(wrapper.text).toContain("New note.");
    expect(wrapper.text).toContain("Notes (3)");
    // The form is ready for the next note.
    expect(wrapper.find(TextArea)!.props.value).toBe("");
  });

  it("shows how to subscribe when the backend refuses a note, and keeps the list", async () => {
    mockStatus.mockResolvedValue(statusFor({ trial: { startedAt: new Date().toISOString(), usageCount: 99 } }));
    mockCreate.mockResolvedValue({
      created: false,
      status: statusFor({ trial: { startedAt: new Date().toISOString(), usageCount: 100 } }),
    });
    const { wrapper, update } = await renderDrawer();
    expect(wrapper.text).toContain("1 note left in your free trial");

    wrapper.find(TextArea)!.trigger("onChange", { target: { value: "One too many." } });
    await update();
    findButton(wrapper, "Add note")!.trigger("onPress");
    await flush();
    await update();

    const banner = wrapper
      .findAll(Banner)
      .find((candidate) => String(candidate.props.title).includes("free trial"));
    expect(banner!.props.title).toBe("You have used all 100 notes of your free trial");
    // The form is gone; what was written is still there.
    expect(wrapper.find(TextArea)).toBeNull();
    expect(wrapper.text).toContain("Called about a refund.");
  });

  it("resolves a task with one press", async () => {
    mockUpdate.mockResolvedValue({
      note: makeTask({ status: "resolved", resolvedAt: "2026-10-01T10:00:00.000Z" }),
      notification: "none",
    });
    const { wrapper, update } = await renderDrawer();

    findButton(wrapper, "Resolve")!.trigger("onPress");
    await flush();
    await update();

    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), TASK_ID, { status: "resolved" });
    expect(findButton(wrapper, "Reopen")).toBeTruthy();
  });

  it("asks before deleting", async () => {
    mockDelete.mockResolvedValue({ deleted: true });
    const { wrapper, update } = await renderDrawer();

    // Two notes, two Delete buttons; the first belongs to the task.
    findButton(wrapper, "Delete")!.trigger("onPress");
    await update();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(wrapper.text).toContain("This can’t be undone");

    wrapper
      .findAll(Button)
      .find((button) => button.props.type === "destructive")!
      .trigger("onPress");
    await flush();
    await update();

    expect(mockDelete).toHaveBeenCalledWith(expect.anything(), TASK_ID);
    expect(wrapper.text).not.toContain("Charged twice. Refund one.");
    expect(wrapper.text).toContain("Notes (1)");
  });

  it("still lets you write when the object can't be read from Stripe", async () => {
    mockDescribe.mockRejectedValue(new Error("permission denied"));
    mockList.mockResolvedValue({ notes: [], hasMore: false });
    const { wrapper } = await renderDrawer();

    expect(wrapper.find(TextArea)).toBeTruthy();
    expect(wrapper.text).toContain("No notes on this customer yet.");
  });

  it("explains itself on a page that has no notes", async () => {
    const { wrapper } = await renderDrawer(getMockContextProps());

    expect(wrapper.find(Banner)!.props.title).toBe("Open a customer, invoice or payment");
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCheckIn).not.toHaveBeenCalled();
  });

  it("shows the load error with a way to retry", async () => {
    mockList.mockRejectedValue(new Error("Failed to fetch"));
    const { wrapper } = await renderDrawer();

    const error = wrapper
      .findAll(Banner)
      .find((banner) => banner.props.type === "critical");
    expect(error!.props.title).toBe("Couldn't load the notes");
  });
});
