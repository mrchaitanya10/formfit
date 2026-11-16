import { useEffect, useState } from 'react';

export type RoutePath = '' | 'photo' | 'compress' | 'images-to-pdf' | 'merge' | 'presets' | 'kit';

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parseHash(): Route {
  const [path, query = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  return { path, params: new URLSearchParams(query) };
}

/** Minimal hash router: works on any static host without server rewrites. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function href(path: RoutePath, params?: Record<string, string>): string {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  return `#/${path}${query}`;
}
