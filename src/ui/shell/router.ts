import { useCallback, useEffect, useState } from "preact/hooks";

export interface BrowserLocation {
  pathname: string;
  search: string;
}

export interface NavigationOptions {
  replace?: boolean;
}

function readLocation(): BrowserLocation {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function useBrowserRouter(): [BrowserLocation, (target: string, options?: NavigationOptions) => void] {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((target: string, options: NavigationOptions = {}) => {
    if (options.replace) {
      window.history.replaceState(null, "", target);
      setLocation(readLocation());
      return;
    }
    window.history.pushState(null, "", target);
    setLocation(readLocation());
    window.scrollTo(0, 0);
  }, []);

  return [location, navigate];
}
