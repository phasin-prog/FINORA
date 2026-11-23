'use client';

import { useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';

export function PwaSupport() {
  const [showIosBanner, setShowIosBanner] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as { standalone?: boolean }).standalone);
    const dismissed = localStorage.getItem('finora_ios_install_dismissed') === '1';

    if (isIos && !isStandalone && !dismissed) {
      setShowIosBanner(true);
    }
  }, []);

  if (!showIosBanner) return null;

  return (
    <div className="mb-4 p-3.5 rounded-[14px] bg-surface border border-border flex items-start justify-between gap-3">
      <div className="text-xs text-primary leading-relaxed">
        <p className="font-semibold">ติดตั้ง FINORA บนหน้าจอหลัก iPhone</p>
        <p className="text-muted mt-0.5 flex items-center flex-wrap gap-1">
          แตะปุ่ม <Share className="w-3.5 h-3.5 inline text-accent" /> Share แล้วเลือก
          <span className="font-medium text-primary">“Add to Home Screen”</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem('finora_ios_install_dismissed', '1');
          setShowIosBanner(false);
        }}
        className="p-1 text-muted hover:text-primary"
        aria-label="ปิดคำแนะนำการติดตั้ง"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
