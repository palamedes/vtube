import { useEffect, useSyncExternalStore } from 'react';
import { store, type Snapshot } from './store';

export function useStudio(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Run `callback` on every animation frame while the component is mounted. */
export function useTick(callback: (now: number) => void): void {
  useEffect(() => store.onTick(callback), [callback]);
}
