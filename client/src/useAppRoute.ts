import { useCallback, useEffect, useState } from "react";
import { parseRoute, routeToPath, type AppRoute } from "./app-url";

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: AppRoute, replace = false) => {
    const path = routeToPath(next);
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    setRoute(next);
  }, []);

  return { route, navigate };
}
