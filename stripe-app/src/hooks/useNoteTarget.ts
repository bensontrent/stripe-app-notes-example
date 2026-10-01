// hooks/useNoteTarget.ts
//
// Describes the object a drawer view is open on, for filing notes under it:
// its customer and its labels, read from Stripe (src/api/stripeObjects.ts).
//
// The read is best effort. Until it answers — and if it fails, because the
// app wasn't granted the permission or the object can't be read — the target
// is the bare id from the Dashboard, which is enough to save a note. What is
// lost without the read is said by `lookup`, so the view can explain it.

import { useEffect, useState } from "react";
import {
  bareTarget,
  describeNoteTarget,
  noteObjectTypeFor,
  type NoteTarget,
} from "../api/stripeObjects";

export type NoteTargetState = {
  /** Null when the view isn't open on a customer, invoice or payment. */
  target: NoteTarget | null;
  /** 'failed' = Stripe couldn't be asked; the target has no labels or customer. */
  lookup: "loading" | "ready" | "failed";
};

export function useNoteTarget(
  objectContext: { id: string; object: string } | null | undefined,
): NoteTargetState {
  const objectId = objectContext?.id ?? null;
  const dashboardObject = objectContext?.object ?? null;
  const objectType = dashboardObject ? noteObjectTypeFor(dashboardObject) : null;

  const [described, setDescribed] = useState<{ target: NoteTarget; ok: boolean } | null>(null);

  useEffect(() => {
    if (!objectId || !dashboardObject || !objectType) return;
    let cancelled = false;
    describeNoteTarget(dashboardObject, objectId)
      .then((target) => {
        if (!cancelled) setDescribed({ target, ok: true });
      })
      .catch(() => {
        if (!cancelled) setDescribed({ target: bareTarget(objectType, objectId), ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, dashboardObject, objectType]);

  if (!objectId || !objectType) return { target: null, lookup: "ready" };

  // An answer for a previous object (the drawer stays mounted while the
  // Dashboard navigates) doesn't describe this one.
  if (described && described.target.objectId === objectId) {
    return { target: described.target, lookup: described.ok ? "ready" : "failed" };
  }
  return { target: bareTarget(objectType, objectId), lookup: "loading" };
}
