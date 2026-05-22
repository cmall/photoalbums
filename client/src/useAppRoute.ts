import { useCallback, useSyncExternalStore } from "react";
import { parseRoute, routeToPath, type AppRoute } from "./app-url";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getRouteSnapshot(): AppRoute {
  return parseRoute(window.location.pathname);
}

/** URL is the source of truth — pathname and React state stay in sync. */
export function useAppRoute() {
  const route = useSyncExternalStore(subscribe, getRouteSnapshot, getRouteSnapshot);

  const navigate = useCallback((next: AppRoute, replace = false) => {
    const path = routeToPath(next);
    if (window.location.pathname === path) return;
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return { route, navigate };
}
