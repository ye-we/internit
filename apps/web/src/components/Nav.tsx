import { Link, useLocation } from "react-router-dom";
import { useAuthSession, authClient } from "../lib/auth-client.js";

export function Nav() {
  const { user, isAuthenticated } = useAuthSession();
  const location = useLocation();

  function isActive(path: string) {
    return path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-ink/15 bg-paper/95 px-4 sm:px-6">
      <div className="mx-auto flex h-12 max-w-[1500px] items-center gap-5">
        <Link to="/" className="font-display text-2xl font-black leading-none">
          Rue
        </Link>

        <nav className="flex items-center gap-0">
          <NavLink to="/" active={isActive("/")}>
            Discover
          </NavLink>
          <NavLink to="/saved" active={isActive("/saved")}>
            Saved
          </NavLink>
          <NavLink to="/reminders" active={isActive("/reminders")}>
            Reminders
          </NavLink>
          <NavLink to="/orgs" active={isActive("/orgs")}>
            Orgs
          </NavLink>
          {(user as { role?: string } | null)?.role === "admin" && (
            <NavLink to="/admin/scrape" active={isActive("/admin")}>
              Scraping
            </NavLink>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {isAuthenticated ? (
            <>
              <span className="hidden text-xs font-medium text-em sm:inline">{user?.email}</span>
              <button
                type="button"
                onClick={() => authClient.signOut()}
                className="text-xs font-black text-em hover:text-ink"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/signin"
              className="inline-flex h-8 items-center border border-ink/20 px-3 text-xs font-black hover:border-ink"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: string }) {
  return (
    <Link
      to={to}
      className={`px-3 py-1 text-sm font-black ${
        active ? "text-ink" : "text-em hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
