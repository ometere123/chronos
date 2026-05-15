import { ReactNode } from 'react';
import Providers from '@/components/Providers';
import './globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/chronos-logo.png" />
        <link rel="apple-touch-icon" href="/chronos-logo.png" />
        <meta
          name="description"
          content="CHRONOS - Multi-Token Time-Locked Savings & Vesting Infrastructure"
        />
        <title>CHRONOS | Time-Locked Vaults on Arc Testnet</title>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
