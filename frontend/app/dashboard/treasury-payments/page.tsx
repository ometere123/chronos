'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/services/api';

interface ScheduleSlot {
  slotIndex: number;
  releaseTimestamp: number;
  executed: boolean;
  due: boolean;
  reason: string;
}

interface Schedule {
  scheduleId: number;
  recipient: string;
  amount: string;
  minTreasuryBalanceAfter: string;
  active: boolean;
  slots: ScheduleSlot[];
}

function formatDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function slotStatusLabel(slot: ScheduleSlot) {
  if (slot.executed) return 'Executed';
  if (slot.due) return 'Due now';
  return 'Scheduled';
}

function slotStatusClass(slot: ScheduleSlot) {
  if (slot.executed) return 'bg-green-500/20 text-green-400';
  if (slot.due) return 'bg-yellow-500/20 text-yellow-300';
  return 'bg-light/10 text-light/60';
}

export default function TreasuryPaymentsPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['scheduledPayments'],
    queryFn: async () => {
      const response = await apiClient.get('/scheduled-payments');
      return response.data as { schedules: Schedule[]; keeperRunning: boolean; count: number };
    },
    refetchInterval: 15000,
  });

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-light mb-2">Treasury Payments</h1>
          <p className="text-light/60">
            Recurring/payroll payments funded from the Treasury, executed by an off-chain keeper
            once due (see ScheduledPayment.sol).
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="self-start rounded-lg border border-primary/40 px-4 py-2 text-primary transition-colors hover:bg-primary/10 disabled:opacity-50 md:self-auto"
        >
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="card mb-6 border-primary/20 bg-primary/5">
        <div className="flex flex-col gap-2 text-sm text-light/70 md:flex-row md:items-center md:justify-between">
          <div>
            Schedule creation is on-chain <span className="font-semibold text-light">owner-only</span>{' '}
            (ScheduledPayment.createSchedule is onlyOwner) - no connected user wallet can create a
            schedule directly. New schedules are created by backend/admin tooling
            (POST /api/scheduled-payments with an admin key), not from this page.
          </div>
          {data && (
            <div>
              Keeper:{' '}
              <span className={`font-semibold ${data.keeperRunning ? 'text-green-400' : 'text-yellow-300'}`}>
                {data.keeperRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          )}
        </div>
      </div>

      {isLoading && <div className="card text-light/60">Loading schedules...</div>}

      {!!error && (
        <div className="card border-red-500/30 bg-red-500/10">
          <div className="font-semibold text-red-400">Failed to load scheduled payments</div>
          <div className="mt-1 text-sm text-light/70">{(error as any)?.message || 'Unknown error'}</div>
        </div>
      )}

      {data && data.schedules.length === 0 && (
        <div className="card text-light/60">No payment schedules have been created yet.</div>
      )}

      {data && data.schedules.length > 0 && (
        <div className="space-y-6">
          {data.schedules.map((schedule) => (
            <div key={schedule.scheduleId} className="card">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-sm text-light/60">Schedule #{schedule.scheduleId}</div>
                  <div className="font-mono text-sm text-light">{schedule.recipient}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      schedule.active ? 'bg-green-500/20 text-green-400' : 'bg-light/10 text-light/60'
                    }`}
                  >
                    {schedule.active ? 'Active' : 'Cancelled'}
                  </span>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-primary/20 bg-dark/30 p-4">
                  <div className="text-xs text-light/60">Amount per slot</div>
                  <div className="mt-1 font-mono text-lg font-bold text-primary">${schedule.amount}</div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-dark/30 p-4">
                  <div className="text-xs text-light/60">Min Treasury balance after</div>
                  <div className="mt-1 font-mono text-lg font-bold text-light">${schedule.minTreasuryBalanceAfter}</div>
                </div>
                <div className="rounded-lg border border-primary/20 bg-dark/30 p-4">
                  <div className="text-xs text-light/60">Slots</div>
                  <div className="mt-1 font-mono text-lg font-bold text-light">{schedule.slots.length}</div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-primary/10 text-left text-light/60">
                      <th className="py-2 pr-4">Slot</th>
                      <th className="py-2 pr-4">Release Time</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.slots.map((slot) => (
                      <tr key={slot.slotIndex} className="border-b border-primary/5">
                        <td className="py-2 pr-4 text-light/80">{slot.slotIndex + 1}</td>
                        <td className="py-2 pr-4 text-light/80">{formatDate(slot.releaseTimestamp)}</td>
                        <td className="py-2 pr-4">
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${slotStatusClass(slot)}`}>
                            {slotStatusLabel(slot)}
                          </span>
                        </td>
                        <td className="py-2 text-light/60">{slot.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
