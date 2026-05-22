import { useCallback, useSyncExternalStore } from "react";
import { parseRoute, routeToPath, type AppRoute } from "./app-url";

let cachedPathname = "";
let cachedRoute: AppRoute = { kind: "gallery-hub" };

function getRouteSnapshot(): AppRoute {
  const pathname = window.location.pathname;
  if (pathname !== cachedPathname) {
    cachedPathname = pathname;
    cachedRoute = parseRoute(pathname);
  }
  return cachedRoute;
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
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
