import 'server-only';

import { headers } from 'next/headers';

/**
 * Absolute origin of the current deployment, used to build auth redirect links.
 * Derived from the request so it works on localhost, Vercel previews and production
 * without extra configuration.
 */
export async function getSiteUrl(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'localhost:3000';
  const protocol =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}
