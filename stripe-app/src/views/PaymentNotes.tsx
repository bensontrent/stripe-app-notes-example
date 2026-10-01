// src/views/PaymentNotes.tsx
//
// The `stripe.dashboard.payment.detail` view: the notes drawer on a
// payment's page. The Dashboard's payment page is about a PaymentIntent, or
// about a bare Charge for payments made without one; both are a "payment"
// to this app. Notes are also filed under the payment's customer, when it
// has one. See components/ObjectNotes.tsx.

import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { ObjectNotes } from "../components/ObjectNotes";
import { withNavigation } from "../providers/withNavigation";

function PaymentNotes(context: ExtensionContextValue) {
  return <ObjectNotes context={context} />;
}

export default withNavigation(PaymentNotes);
