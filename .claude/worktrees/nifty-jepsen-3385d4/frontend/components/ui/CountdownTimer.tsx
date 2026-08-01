'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

interface CountdownTimerProps {
  unlockAt: number;
  vaultId: string;
}

export default function CountdownTimer({ unlockAt, vaultId }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    total: number;
  } | null>(null);

  const [isMature, setIsMature] = useState(false);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = Math.floor(Date.now() / 1000);
      const unlockSeconds = unlockAt;
      const difference = unlockSeconds - now;

      if (difference <= 0) {
        setIsMature(true);
        setTimeLeft({
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          total: 0,
        });
        return;
      }

      setIsMature(false);

      const days = Math.floor(difference / (60 * 60 * 24));
      const hours = Math.floor((difference % (60 * 60 * 24)) / (60 * 60));
      const minutes = Math.floor((difference % (60 * 60)) / 60);
      const seconds = difference % 60;

      setTimeLeft({
        days,
        hours,
        minutes,
        seconds,
        total: difference,
      });
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(interval);
  }, [unlockAt, vaultId]);

  if (!timeLeft) {
    return <div className="text-light/40 text-sm">Loading...</div>;
  }

  if (isMature) {
    return (
      <div className="text-yellow-400 font-mono text-sm font-bold flex items-center gap-1.5">
        <Sparkles className="w-4 h-4" /> Vault is Mature!
      </div>
    );
  }

  return (
    <div className="text-primary font-mono text-sm font-bold">
      {timeLeft.days > 0 && `${timeLeft.days}d `}
      {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s
    </div>
  );
}
