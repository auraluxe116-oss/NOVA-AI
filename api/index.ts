import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/app.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const app = createApp();

export function normalizeVercelRequestUrl(rawUrl: string | undefined): string {
  const urlObj = new URL(rawUrl || '/api', 'http://localhost');
  const rewrittenSite = urlObj.searchParams.get('__vercel_site');
  if (rewrittenSite !== null) {
    urlObj.searchParams.delete('__vercel_site');
    const cleanSiteSlug = rewrittenSite.replace(/^\/+/, '');
    const qs = urlObj.searchParams.toString();
    return `/sites${cleanSiteSlug ? `/${cleanSiteSlug}` : ''}${qs ? `?${qs}` : ''}`;
  }

  const rewrittenPath = urlObj.searchParams.get('__vercel_path');

  if (rewrittenPath !== null) {
    urlObj.searchParams.delete('__vercel_path');
    const cleanSubPath = rewrittenPath.replace(/^\/+/, '');
    const qs = urlObj.searchParams.toString();
    return `/api${cleanSubPath ? `/${cleanSubPath}` : ''}${qs ? `?${qs}` : ''}`;
  }

  if (urlObj.pathname.startsWith('/sites/')) {
    return `${urlObj.pathname}${urlObj.search}`;
  }

  if (!urlObj.pathname.startsWith('/api')) {
    const cleanPath = urlObj.pathname.replace(/^\/+/, '');
    const qs = urlObj.searchParams.toString();
    return `/api${cleanPath ? `/${cleanPath}` : ''}${qs ? `?${qs}` : ''}`;
  }

  return `${urlObj.pathname}${urlObj.search}`;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  req.url = normalizeVercelRequestUrl(req.url);
  app(req, res);
}
