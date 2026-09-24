/**
 * Character sheet: one character in a grid of fixed poses, for designing and
 * checking characters without a tracker. /sheet?character=mascot
 */
import { CHARACTERS, findCharacter } from '../characters';
import { BS, type Blendshape } from '../shared/arkit';
import { createFaceState, type FaceState } from '../shared/processing';

type Pose = {
  name: string;
  bs?: Partial<Record<Blendshape, number>>;
  yaw?: number;
  pitch?: number;
  roll?: number;
  gaze?: [number, number];
  /** The body's follow-through turn and lean (radians). */
  body?: [number, number];
};

const POSES: Pose[] = [
  { name: 'neutral' },
  { name: 'blink', bs: { eyeBlinkLeft: 1, eyeBlinkRight: 1 } },
  { name: 'talking (jaw 0.5)', bs: { jawOpen: 0.5, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3 } },
  { name: 'jaw wide open', bs: { jawOpen: 1 } },
  { name: 'smile', bs: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.6, cheekSquintRight: 0.6 } },
  { name: 'frown', bs: { mouthFrownLeft: 0.8, mouthFrownRight: 0.8, browDownLeft: 0.6, browDownRight: 0.6 } },
  { name: '"oo" (funnel + pucker)', bs: { mouthFunnel: 0.8, mouthPucker: 0.6, jawOpen: 0.25 } },
  { name: '"oh" (round, jaw half open)', bs: { mouthFunnel: 0.9, mouthPucker: 0.4, jawOpen: 0.5 } },
  { name: 'brows up (surprised)', bs: { browInnerUp: 0.9, browOuterUpLeft: 0.8, browOuterUpRight: 0.8, eyeWideLeft: 0.6, eyeWideRight: 0.6, jawOpen: 0.3 } },
  { name: 'worried', bs: { browInnerUp: 0.9, mouthFrownLeft: 0.4, mouthFrownRight: 0.4 } },
  { name: 'wink (left)', bs: { eyeBlinkLeft: 1, mouthSmileLeft: 0.6 } },
  { name: 'turn right', yaw: 0.45 },
  { name: 'turn right, held (body follows)', yaw: 0.45, body: [0.22, 0] },
  { name: 'tilt + look up', roll: 0.25, pitch: 0.25 },
];

function face(pose: Pose): FaceState {
  const state = createFaceState();
  state.present = true;
  for (const [name, value] of Object.entries(pose.bs ?? {})) state.bs[BS[name as Blendshape]] = value;
  state.head.yaw = pose.yaw ?? 0;
  state.head.pitch = pose.pitch ?? 0;
  state.head.roll = pose.roll ?? 0;
  [state.gaze.x, state.gaze.y] = pose.gaze ?? [0, 0];
  [state.body.yaw, state.body.roll] = pose.body ?? [0, 0];
  return state;
}

const params = new URLSearchParams(location.search);
const definition = findCharacter(params.get('character'));
const sheet = document.getElementById('sheet')!;
document.title = `${definition.name}: character sheet`;
const header = document.createElement('h1');
header.textContent = `${definition.name} · ${CHARACTERS.map((c) => c.id).join(' / ')}`;
sheet.appendChild(header);
const grid = document.createElement('div');
grid.className = 'grid';
sheet.appendChild(grid);

for (const pose of POSES) {
  const cell = document.createElement('figure');
  const box = document.createElement('div');
  box.className = 'box';
  const caption = document.createElement('figcaption');
  caption.textContent = pose.name;
  cell.append(box, caption);
  grid.appendChild(cell);
  const instance = definition.create(box);
  instance.setOptions({ breathing: false });
  instance.update(face(pose), 0);
}

const style = document.createElement('style');
style.textContent = `
  body { margin: 0; background: #1a1b23; color: #e8e8ee; font: 14px system-ui, sans-serif; }
  h1 { font-size: 16px; font-weight: 600; margin: 14px 18px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 0 18px 18px; }
  figure { margin: 0; background: radial-gradient(circle at 70% 35%, #3566b5, #1a2c57 55%, #0b1328); border-radius: 8px; overflow: hidden; }
  .box { aspect-ratio: 1; }
  figcaption { padding: 6px 10px; background: rgba(0,0,0,.35); font-size: 12px; }
`;
document.head.appendChild(style);
