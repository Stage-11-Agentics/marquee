import { useCallback, useEffect, useState } from "preact/hooks";

export interface BrowserLocation {
  pathname: string;
  search: string;
}

function readLocation(): BrowserLocation {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function useBrowserRouter(): [BrowserLocation, (target: string) => void] {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((target: string) => {
    window.history.pushState(null, "", target);
    setLocation(readLocation());
    window.scrollTo(0, 0);
  }, []);

  return [location, navigate];
}
