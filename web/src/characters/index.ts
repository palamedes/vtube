import { placeholder } from './placeholder';
import type { CharacterDefinition } from './types';

export const CHARACTERS: CharacterDefinition[] = [placeholder];

export function findCharacter(id: string | null | undefined): CharacterDefinition {
  return CHARACTERS.find((c) => c.id === id) ?? placeholder;
}
