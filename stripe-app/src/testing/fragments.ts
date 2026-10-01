// src/testing/fragments.ts
//
// Some SDK components take elements as *props* rather than children:
// OverviewPage and DetailPage their columns, ContextView its actions,
// PropertyListItem its value. remote-ui renders such a prop into a fragment —
// a tree of remote component nodes carrying the component *name* — that the
// testing wrapper's find() does not descend into. These helpers walk a
// fragment by hand.

export type RemoteNode = {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: Array<RemoteNode | string | { text?: string }>;
  text?: string;
};

const isNode = (value: unknown): value is RemoteNode =>
  typeof value === "object" && value !== null;

/** Every node of the given component name ("Button", "PageModule", …) in a fragment. */
export function findAllInFragment(fragment: unknown, type: string): RemoteNode[] {
  if (!isNode(fragment)) return [];
  const own = fragment.type === type ? [fragment] : [];
  return own.concat(
    ...(fragment.children ?? []).map((child) => findAllInFragment(child, type)),
  );
}

/** All the text inside a fragment, concatenated. */
export function fragmentText(fragment: unknown): string {
  if (typeof fragment === "string") return fragment;
  if (!isNode(fragment)) return "";
  const own = typeof fragment.text === "string" ? fragment.text : "";
  return own + (fragment.children ?? []).map(fragmentText).join("");
}
