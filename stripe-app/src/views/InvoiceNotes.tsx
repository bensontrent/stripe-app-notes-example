// src/views/InvoiceNotes.tsx
//
// The `stripe.dashboard.invoice.detail` view: the notes drawer on an
// invoice's page. It lists and adds the notes on that invoice; each one is
// also filed under the invoice's customer, so it shows up on the customer's
// page too. See components/ObjectNotes.tsx.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { ObjectNotes } from "../components/ObjectNotes";
import { withNavigation } from "../providers/withNavigation";

function InvoiceNotes(context: ExtensionContextValue) {
  return <ObjectNotes context={context} />;
}

export default withNavigation(InvoiceNotes);
