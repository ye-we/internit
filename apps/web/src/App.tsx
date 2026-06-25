import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Nav } from "./components/Nav.js";
import { RequireAuth } from "./components/RequireAuth.js";
import { AuthPage } from "./AuthPage.js";
import { Discover } from "./pages/Discover.js";
import { OrgsPage } from "./pages/OrgsPage.js";
import { SavedPage } from "./pages/SavedPage.js";
import { RemindersPage } from "./pages/RemindersPage.js";
import { AdminScrapePage } from "./pages/AdminScrapePage.js";

export default function App() {
  return (
    <Routes>
      <Route path="/signin" element={<AuthPage mode="signin" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route element={<AppShell />}>
        <Route path="/" element={<Discover />} />
        <Route path="/orgs" element={<OrgsPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/saved" element={<SavedPage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/admin/scrape" element={<AdminScrapePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AppShell() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <Nav />
      <Outlet />
    </div>
  );
}
