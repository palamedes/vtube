import type { FaceState } from '../shared/processing';

export interface CharacterOptions {
  /** A slow idle rise and fall, independent of tracking. */
  breathing: boolean;
}

/** A character drawn into a container element. The same instance code runs in the Studio and in OBS. */
export interface CharacterInstance {
  /** Called every animation frame. `now` is the page clock in seconds. */
  update(face: FaceState, now: number): void;
  setOptions(options: CharacterOptions): void;
  destroy(): void;
}

export interface CharacterDefinition {
  id: string;
  name: string;
  description: string;
  create(container: HTMLElement): CharacterInstance;
}
