'use client';

import { createContext, useContext, useState } from 'react';
import { useFinoraStore, type FinoraStoreState } from '@/hooks/useFinoraStore';

interface FinoraContextValue extends FinoraStoreState {
  isEntryOpen: boolean;
  openEntry: () => void;
  closeEntry: () => void;
}

const FinoraContext = createContext<FinoraContextValue | null>(null);

export function FinoraProvider({ children }: { children: React.ReactNode }) {
  const store = useFinoraStore();
  const [isEntryOpen, setIsEntryOpen] = useState(false);

  return (
    <FinoraContext.Provider
      value={{
        ...store,
        isEntryOpen,
        openEntry: () => setIsEntryOpen(true),
        closeEntry: () => setIsEntryOpen(false),
      }}
    >
      {children}
    </FinoraContext.Provider>
  );
}

export function useFinora(): FinoraContextValue {
  const ctx = useContext(FinoraContext);
  if (!ctx) {
    throw new Error('useFinora must be used inside FinoraProvider');
  }
  return ctx;
}
