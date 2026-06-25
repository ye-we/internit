import { FormEvent, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { authClient, useAuthSession } from "./lib/auth-client";

type AuthMode = "signin" | "signup";

export function AuthPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isPending, refetch } = useAuthSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  const from = useMemo(() => {
    const value = new URLSearchParams(location.search).get("from");
    return value && value.startsWith("/") ? value : "/";
  }, [location.search]);
  const callbackURL = useMemo(() => new URL(from, window.location.origin).toString(), [from]);

  if (!isPending && isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const isSignup = mode === "signup";
  const title = isSignup ? "Create your Rue account" : "Sign in to Rue";
  const switchHref = isSignup ? "/signin" : "/signup";
  const switchText = isSignup ? "Already have an account?" : "New to Rue?";
  const switchAction = isSignup ? "Sign in" : "Create account";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = isSignup
        ? await authClient.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
            callbackURL,
          })
        : await authClient.signIn.email({
            email: email.trim(),
            password,
            callbackURL,
          });

      if (result.error) {
        throw new Error(result.error.message || "Authentication failed.");
      }

      await refetch();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setIsGoogleSubmitting(true);

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL,
        errorCallbackURL: `${window.location.origin}${location.pathname}`,
      });

      if (result.error) {
        throw new Error(result.error.message || "Google sign-in failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
      setIsGoogleSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="border-b border-ink/15 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4">
          <Link to="/" className="font-display text-3xl font-black leading-none">
            Rue
          </Link>
          <Link
            to={switchHref}
            className="inline-flex h-9 items-center border border-ink/20 px-3 text-sm font-black hover:border-ink"
          >
            {switchAction}
          </Link>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-65px)] max-w-[1080px] items-center px-4 py-10 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,440px)] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-em">
              {isSignup ? "Start tracking" : "Welcome back"}
            </p>
            <h1 className="mt-3 font-serif text-4xl leading-tight sm:text-6xl">
              {title}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-em">
              Keep your opportunity search tied to one account while Rue keeps cleaning,
              ranking, and organizing listings for Ethiopian candidates.
            </p>
          </div>

          <div className="border border-ink/15 bg-paper p-5 sm:p-6">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting || isGoogleSubmitting}
              className="flex h-11 w-full items-center justify-center border border-ink bg-ink px-4 text-sm font-black text-paper disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGoogleSubmitting ? "Opening Google..." : "Continue with Google"}
            </button>

            <div className="my-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs font-black uppercase tracking-[0.14em] text-em">
              <span className="h-px bg-ink/15" />
              <span>Email</span>
              <span className="h-px bg-ink/15" />
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {isSignup ? (
                <AuthField
                  label="Name"
                  value={name}
                  onChange={setName}
                  autoComplete="name"
                  required
                />
              ) : null}
              <AuthField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                required
              />
              <AuthField
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={8}
                required
              />

              {error ? (
                <p className="border border-ink/20 px-3 py-2 text-sm font-medium text-ink">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting || isGoogleSubmitting}
                className="flex h-11 w-full items-center justify-center border border-ink bg-ink px-4 text-sm font-black text-paper disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Working..." : isSignup ? "Create account" : "Sign in"}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-em">
              {switchText}{" "}
              <Link to={switchHref} className="font-black text-ink underline underline-offset-4">
                {switchAction}
              </Link>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function AuthField({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  minLength,
  required,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-em">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        className="mt-2 h-11 w-full border border-ink/20 bg-paper px-3 text-sm font-medium outline-none focus:border-ink"
      />
    </label>
  );
}
