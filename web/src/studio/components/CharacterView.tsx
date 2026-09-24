import { useCallback, useEffect, useRef } from 'react';
import { findCharacter } from '../../characters';
import type { CharacterInstance } from '../../characters/types';
import type { SourceId } from '../../shared/protocol';
import { store } from '../store';
import { useStudio, useTick } from '../useStudio';

/**
 * Mounts a character and drives it exactly as the OBS page does: from the
 * active source's face, or from a given source's (for Compare and Framing).
 */
export function CharacterView({ characterId = 'placeholder', source }: { characterId?: string; source?: SourceId }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<CharacterInstance | null>(null);
  const { settings } = useStudio();

  useEffect(() => {
    const created = findCharacter(characterId).create(host.current!);
    instance.current = created;
    return () => {
      created.destroy();
      instance.current = null;
    };
  }, [characterId]);

  useEffect(() => {
    instance.current?.setOptions({ breathing: settings.motion.breathing });
  }, [settings.motion.breathing, characterId]);

  useTick(
    useCallback(
      (now: number) => {
        const driver = source ? store.driverFor(source) : store.driver;
        instance.current?.update(driver.face, now);
      },
      [source],
    ),
  );

  return <div className="character-view" ref={host} />;
}
