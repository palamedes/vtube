import { mascot } from './mascot';
import { placeholder } from './placeholder';
import type { CharacterDefinition } from './types';

export const CHARACTERS: CharacterDefinition[] = [placeholder, mascot];

export function findCharacter(id: string | null | undefined): CharacterDefinition {
  return CHARACTERS.find((c) => c.id === id) ?? placeholder;
}
