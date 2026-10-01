// src/views/CustomerNotes.tsx
//
// The `stripe.dashboard.customer.detail` view: the notes drawer on a
// customer's page. It lists every note about the customer — including the
// ones written on the customer's invoices and payments — and adds new ones
// to the customer. All of it lives in components/ObjectNotes.tsx, which
// reads the customer's id from `environment.objectContext`.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { ObjectNotes } from "../components/ObjectNotes";
import { withNavigation } from "../providers/withNavigation";

function CustomerNotes(context: ExtensionContextValue) {
  return <ObjectNotes context={context} />;
}

export default withNavigation(CustomerNotes);
