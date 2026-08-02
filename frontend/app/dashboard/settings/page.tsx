'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { useThemeStore } from '@/store/themeStore';

export default function SettingsPage() {
  const { address, disconnect } = useWallet();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const darkMode = theme === 'dark';

  const shortAddress = address ? `${address.slice(0, 10)}...${address.slice(-8)}` : '';

  const handleLogout = () => {
    disconnect();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-light mb-2">Settings</h1>
        <p className="text-light/60">Manage your account and preferences</p>
      </div>

      {/* Account Section */}
      <div className="card">
        <h2 className="text-xl font-bold text-light mb-6">Account</h2>

        <div className="space-y-4">
          <div className="flex justify-between items-center py-4 border-b border-primary/10">
            <div>
              <div className="font-semibold text-light">Wallet Address</div>
              <div className="text-light/60 text-sm mt-1">{address ?? 'Not connected'}</div>
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(address || '')}
              className="px-4 py-2 text-primary text-sm border border-primary rounded hover:bg-primary/10 transition-colors"
            >
              Copy
            </button>
          </div>

          <div className="flex justify-between items-center py-4 border-b border-primary/10">
            <div>
              <div className="font-semibold text-light">Display Name</div>
              <div className="text-light/60 text-sm mt-1">{shortAddress}</div>
            </div>
            <button className="px-4 py-2 text-primary text-sm border border-primary rounded hover:bg-primary/10 transition-colors">
              Edit
            </button>
          </div>

          <div className="flex justify-between items-center py-4">
            <div>
              <div className="font-semibold text-light">Authentication</div>
              <div className="text-light/60 text-sm mt-1">Injected wallet signature</div>
            </div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="card">
        <h2 className="text-xl font-bold text-light mb-6">Preferences</h2>

        <div className="space-y-4">
          <div className="flex justify-between items-center py-4 border-b border-primary/10">
            <div>
              <div className="font-semibold text-light">Notifications</div>
              <div className="text-light/60 text-sm mt-1">Get alerts for vault maturity and claims</div>
            </div>
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={`w-12 h-6 rounded-full transition-all ${
                notificationsEnabled ? 'bg-primary' : 'bg-primary/30'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-dark transition-all ${notificationsEnabled ? 'ml-6' : 'ml-0.5'}`} />
            </button>
          </div>

          <div className="flex justify-between items-center py-4">
            <div>
              <div className="font-semibold text-light">Dark Mode</div>
              <div className="text-light/60 text-sm mt-1">
                {darkMode ? 'Dark theme active' : 'Light theme active'}
              </div>
            </div>
            <button
              onClick={toggleTheme}
              className={`w-12 h-6 rounded-full transition-all ${
                darkMode ? 'bg-primary' : 'bg-primary/30'
              }`}
            >
              <div className={`w-5 h-5 rounded-full bg-dark transition-all ${darkMode ? 'ml-6' : 'ml-0.5'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Network */}
      <div className="card">
        <h2 className="text-xl font-bold text-light mb-6">Network</h2>

        <div className="space-y-3">
          <div className="flex justify-between items-center py-3 border-b border-primary/10">
            <div className="font-semibold text-light">Primary Network</div>
            <div className="text-light/60">Arc Testnet (5042002)</div>
          </div>

          <div className="flex justify-between items-center py-3">
            <div className="font-semibold text-light">API Version</div>
            <div className="text-light/60 font-mono text-sm">v1.0.0</div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card bg-red-500/5 border border-red-500/30">
        <h2 className="text-xl font-bold text-red-400 mb-6">Danger Zone</h2>

        <button
          onClick={handleLogout}
          className="w-full px-6 py-3 bg-red-500/20 text-red-400 font-bold rounded-lg hover:bg-red-500/30 transition-colors"
        >
          Logout
        </button>

        <p className="text-light/60 text-sm mt-4">
          Logging out will disconnect your wallet. You'll need to reconnect to access your vaults.
        </p>
      </div>

      {/* About */}
      <div className="card bg-primary/5 border border-primary/30">
        <h2 className="text-xl font-bold text-primary mb-4">About CHRONOS</h2>
        <ul className="space-y-2 text-light/70 text-sm">
          <li>Non-custodial time-locked vaults</li>
          <li>Multi-chain USDC bridge support through Circle CCTP</li>
          <li>FIXED and FLEXIBLE vault types</li>
          <li>Open-source and auditable</li>
          <li>Real-time proof of reserves</li>
        </ul>
      </div>
    </div>
  );
}
