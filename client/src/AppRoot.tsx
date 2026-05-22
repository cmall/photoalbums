import { useCallback, useEffect, useState } from "react";
import { AppErrorBoundary } from "./ErrorBoundary";
import { App } from "./App";
import { AuthRequiredError, fetchAuthStatus } from "./api";
import { LoginScreen } from "./LoginScreen";

export function AppRoot() {
  const [auth, setAuth] = useState<{
    loading: boolean;
    required: boolean;
    authenticated: boolean;
  }>({ loading: true, required: false, authenticated: true });

  const refreshAuth = useCallback(async () => {
    const status = await fetchAuthStatus();
    setAuth({
      loading: false,
      required: status.required,
      authenticated: status.authenticated,
    });
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    function onAuthRequired() {
      setAuth((a) => ({ ...a, authenticated: false }));
    }
    window.addEventListener("albums:auth-required", onAuthRequired);
    return () => window.removeEventListener("albums:auth-required", onAuthRequired);
  }, []);

  if (auth.loading) {
    return <div className="auth-screen auth-screen-minimal">Loading…</div>;
  }

  if (auth.required && !auth.authenticated) {
    return <LoginScreen onSuccess={() => void refreshAuth()} />;
  }

  return (
    <AppErrorBoundary>
      <App
        onAuthLost={() => setAuth((a) => ({ ...a, authenticated: false }))}
      />
    </AppErrorBoundary>
  );
}

export function notifyAuthRequired(err: unknown) {
  if (err instanceof AuthRequiredError) {
    window.dispatchEvent(new Event("albums:auth-required"));
    return true;
  }
  return false;
}
