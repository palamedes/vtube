import { placeholder } from './placeholder';
import type { CharacterDefinition } from './types';

// Characters kept out of the public repo live in characters/private/<name>/character.ts
// (gitignored, default export) and are picked up here when present.
const privateCharacters = Object.values(
  import.meta.glob<{ default: CharacterDefinition }>('../../../characters/private/*/character.ts', { eager: true }),
).map((module) => module.default);

export const CHARACTERS: CharacterDefinition[] = [placeholder, ...privateCharacters];

export function findCharacter(id: string | null | undefined): CharacterDefinition {
  return CHARACTERS.find((c) => c.id === id) ?? placeholder;
}
