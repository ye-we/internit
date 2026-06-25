import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthSession } from "../lib/auth-client.js";

export function RequireAuth() {
  const { isAuthenticated, isPending } = useAuthSession();
  const location = useLocation();

  if (isPending) return null;
  if (!isAuthenticated) {
    return (
      <Navigate
        to={`/signin?from=${encodeURIComponent(location.pathname)}`}
        replace
      />
    );
  }
  return <Outlet />;
}
