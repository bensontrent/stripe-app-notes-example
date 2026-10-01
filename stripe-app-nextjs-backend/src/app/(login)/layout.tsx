// The (login) route group collects every page in the auth flow — /login,
// /register, /reset-password, /confirm, and the Stripe App handshake pages
// (/stripe, /stripe-logout, /end-session, /complete-setup) — under one
// shared centered-card layout. The group name doesn't appear in URLs.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white text-gray-900 shadow-md rounded-lg p-8">{children}</div>
      </div>
    </div>
  );
}
