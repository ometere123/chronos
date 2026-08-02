import { ReactNode } from 'react';
import DashboardLayoutClient from './DashboardLayoutClient';

// Everything under /dashboard requires a connected wallet at runtime, so it can never be
// meaningfully static. Force dynamic rendering here rather than letting Next.js try to prerender
// these pages at build time - Privy's useWallets() crashes during that server-side prerender pass
// since it expects a real browser mount before its internal refs are populated. Route segment
// config like `dynamic` is only honored in Server Components, hence splitting the actual
// client-side layout logic into DashboardLayoutClient.
export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
