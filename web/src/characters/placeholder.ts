import { BS, type Blendshape } from '../shared/arkit';
import { clamp, clamp01, smoothstep, type FaceState } from '../shared/processing';
import type { CharacterDefinition, CharacterInstance, CharacterOptions } from './types';

/**
 * "Anchor", the placeholder: a flat cartoon newsreader drawn in SVG. It uses
 * most of the 52 channels, so it doubles as a visual check of the tracking
 * and tuning: blinks, gaze, brows, jaw, smile/frown per side, pucker and
 * funnel, lip stretch, teeth and tongue, cheeks, nose, and a pseudo-3D head
 * turn made from parallax between the head outline and the features.
 */

const NS = 'http://www.w3.org/2000/svg';
const INK = '#3b2a20';
const SKIN = '#ffcf70';
const SKIN_SHADE = '#f0b457';
let instances = 0;

type Attrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  parent?.appendChild(el);
  return el;
}

const f = (x: number) => x.toFixed(1);

class Eye {
  private readonly white: SVGEllipseElement;
  private readonly clipShape: SVGEllipseElement;
  private readonly pupil: SVGGElement;
  private readonly lid: SVGRectElement;
  private readonly lidEdge: SVGLineElement;
  private readonly lower: SVGRectElement;
  private readonly group: SVGGElement;

  constructor(
    parent: SVGElement,
    private readonly cx: number,
    private readonly cy: number,
    id: string,
  ) {
    this.group = svg('g', {}, parent);
    const clip = svg('clipPath', { id }, this.group);
    this.clipShape = svg('ellipse', { cx, cy, rx: 70, ry: 82 }, clip);
    this.white = svg('ellipse', { cx, cy, rx: 70, ry: 82, fill: '#fffdf8' }, this.group);
    const inside = svg('g', { 'clip-path': `url(#${id})` }, this.group);
    this.pupil = svg('g', {}, inside);
    svg('circle', { cx, cy, r: 34, fill: INK }, this.pupil);
    svg('circle', { cx: cx - 11, cy: cy - 13, r: 10, fill: '#fffdf8' }, this.pupil);
    this.lid = svg('rect', { x: cx - 80, y: cy - 100, width: 160, height: 0, fill: SKIN }, inside);
    this.lower = svg('rect', { x: cx - 80, y: cy + 90, width: 160, height: 0, fill: SKIN }, inside);
    this.lidEdge = svg('line', { x1: cx - 72, x2: cx + 72, stroke: INK, 'stroke-width': 9, 'stroke-linecap': 'round' }, inside);
    svg('ellipse', { cx, cy, rx: 70, ry: 82, fill: 'none', stroke: INK, 'stroke-width': 9 }, this.group);
  }

  update(blink: number, squint: number, wide: number, gazeX: number, gazeY: number, narrow: number): void {
    const ry = 82 * (1 + 0.14 * wide - 0.08 * squint);
    for (const shape of [this.white, this.clipShape]) shape.setAttribute('ry', f(ry));
    this.group.setAttribute('transform', `translate(${f(this.cx)} 0) scale(${f(1 - narrow)} 1) translate(${f(-this.cx)} 0)`);
    const closed = clamp01(blink + 0.25 * squint - 0.15 * wide);
    const top = this.cy - ry - 8;
    const height = (2 * ry + 16) * closed;
    this.lid.setAttribute('y', f(top));
    this.lid.setAttribute('height', f(height));
    this.lidEdge.setAttribute('y1', f(top + height));
    this.lidEdge.setAttribute('y2', f(top + height));
    this.lidEdge.setAttribute('opacity', closed > 0.04 ? '1' : '0');
    const lowerHeight = 2 * ry * 0.22 * squint;
    this.lower.setAttribute('y', f(this.cy + ry + 8 - lowerHeight));
    this.lower.setAttribute('height', f(lowerHeight));
    this.pupil.setAttribute('transform', `translate(${f(clamp(gazeX, -1, 1) * 34)} ${f(-clamp(gazeY, -1, 1) * 30)})`);
  }
}

class Anchor implements CharacterInstance {
  private readonly root: SVGSVGElement;
  private readonly body: SVGGElement;
  private readonly head: SVGGElement;
  private readonly headShape: SVGEllipseElement;
  private readonly ears: SVGGElement;
  private readonly hair: SVGGElement;
  private readonly features: SVGGElement;
  private readonly eyeScreenLeft: Eye;
  private readonly eyeScreenRight: Eye;
  private readonly browScreenLeft: SVGPathElement;
  private readonly browScreenRight: SVGPathElement;
  private readonly cheekScreenLeft: SVGEllipseElement;
  private readonly cheekScreenRight: SVGEllipseElement;
  private readonly nose: SVGEllipseElement;
  private readonly mouth: SVGPathElement;
  private readonly mouthClip: SVGPathElement;
  private readonly mouthOutline: SVGPathElement;
  private readonly teeth: SVGRectElement;
  private readonly tongue: SVGEllipseElement;
  private readonly tongueOut: SVGEllipseElement;
  private options: CharacterOptions = { breathing: true };

  constructor(container: HTMLElement) {
    const id = `anchor${++instances}`;
    this.root = svg('svg', { viewBox: '0 0 1000 1000', preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%' });
    this.root.style.display = 'block';
    this.root.style.overflow = 'visible';

    // Body: jacket, shirt, tie.
    this.body = svg('g', {}, this.root);
    svg('rect', { x: 452, y: 690, width: 96, height: 130, rx: 34, fill: SKIN_SHADE, stroke: INK, 'stroke-width': 9 }, this.body);
    svg(
      'path',
      {
        d: 'M 130 1010 C 140 880 230 810 380 790 L 500 860 L 620 790 C 770 810 860 880 870 1010 Z',
        fill: '#2d3e70',
        stroke: INK,
        'stroke-width': 10,
        'stroke-linejoin': 'round',
      },
      this.body,
    );
    svg('path', { d: 'M 400 786 L 500 872 L 600 786 L 560 770 L 500 820 L 440 770 Z', fill: '#f7f4ef', stroke: INK, 'stroke-width': 8, 'stroke-linejoin': 'round' }, this.body);
    svg('path', { d: 'M 486 832 L 514 832 L 524 868 L 500 968 L 476 868 Z', fill: '#d64545', stroke: INK, 'stroke-width': 7, 'stroke-linejoin': 'round' }, this.body);
    svg('path', { d: 'M 380 790 L 455 900 L 420 1010 M 620 790 L 545 900 L 580 1010', fill: 'none', stroke: '#24325a', 'stroke-width': 12, 'stroke-linecap': 'round' }, this.body);

    // Head.
    this.head = svg('g', {}, this.root);
    this.ears = svg('g', {}, this.head);
    for (const cx of [212, 788]) {
      svg('ellipse', { cx, cy: 440, rx: 44, ry: 66, fill: SKIN, stroke: INK, 'stroke-width': 10 }, this.ears);
    }
    this.headShape = svg('ellipse', { cx: 500, cy: 420, rx: 290, ry: 312, fill: SKIN, stroke: INK, 'stroke-width': 10 }, this.head);
    this.hair = svg('g', {}, this.head);
    svg(
      'path',
      {
        d: 'M 420 128 Q 450 40 500 104 Q 530 30 578 112 Q 628 70 626 142',
        fill: 'none',
        stroke: INK,
        'stroke-width': 18,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      this.hair,
    );

    this.features = svg('g', {}, this.head);
    this.cheekScreenLeft = svg('ellipse', { cx: 305, cy: 545, rx: 58, ry: 34, fill: '#ff8f7a', opacity: 0.15 }, this.features);
    this.cheekScreenRight = svg('ellipse', { cx: 695, cy: 545, rx: 58, ry: 34, fill: '#ff8f7a', opacity: 0.15 }, this.features);
    this.eyeScreenLeft = new Eye(this.features, 385, 420, `${id}-eyeL`);
    this.eyeScreenRight = new Eye(this.features, 615, 420, `${id}-eyeR`);
    const brow = { fill: 'none', stroke: INK, 'stroke-width': 22, 'stroke-linecap': 'round' };
    this.browScreenLeft = svg('path', brow, this.features);
    this.browScreenRight = svg('path', brow, this.features);
    this.nose = svg('ellipse', { cx: 500, cy: 508, rx: 25, ry: 17, fill: '#f2ae4c', stroke: INK, 'stroke-width': 6 }, this.features);

    const clip = svg('clipPath', { id: `${id}-mouth` }, this.features);
    this.mouthClip = svg('path', {}, clip);
    this.mouth = svg('path', { fill: '#6e1f2a' }, this.features);
    const inside = svg('g', { 'clip-path': `url(#${id}-mouth)` }, this.features);
    this.tongue = svg('ellipse', { fill: '#e8596f' }, inside);
    this.teeth = svg('rect', { fill: '#fffdf8', rx: 6 }, inside);
    this.tongueOut = svg('ellipse', { fill: '#e8596f', stroke: INK, 'stroke-width': 7 }, this.features);
    this.mouthOutline = svg('path', { fill: 'none', stroke: INK, 'stroke-width': 9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, this.features);

    container.appendChild(this.root);
  }

  setOptions(options: CharacterOptions): void {
    this.options = options;
  }

  update(face: FaceState, now: number): void {
    const v = (name: Blendshape) => face.bs[BS[name]];
    const { yaw, pitch, roll } = face.head;
    const rollDeg = (roll * 180) / Math.PI;
    const breathe = this.options.breathing ? Math.sin((now * 2 * Math.PI) / 4.2) : 0;

    this.body.setAttribute(
      'transform',
      `translate(${f(yaw * 24)} ${f(breathe * -2)}) rotate(${f(rollDeg * 0.25)} 500 1000)`,
    );
    this.head.setAttribute(
      'transform',
      `translate(${f(yaw * 90)} ${f(-pitch * 70 - breathe * 4)}) rotate(${f(rollDeg)} 500 740)`,
    );
    this.ears.setAttribute('transform', `translate(${f(-yaw * 40)} ${f(pitch * 12)})`);
    this.hair.setAttribute('transform', `translate(${f(yaw * 30)} ${f(-pitch * 20)})`);
    this.features.setAttribute('transform', `translate(${f(yaw * 120)} ${f(-pitch * 90)})`);

    const puff = v('cheekPuff');
    this.headShape.setAttribute('rx', f(290 * (1 - Math.min(0.1, Math.abs(yaw) * 0.22)) + puff * 16));

    // Eyes: the character's left eye is on screen right. The far eye narrows as the head turns.
    this.eyeScreenLeft.update(v('eyeBlinkRight'), v('eyeSquintRight'), v('eyeWideRight'), face.gaze.x, face.gaze.y, Math.max(0, -yaw) * 0.45);
    this.eyeScreenRight.update(v('eyeBlinkLeft'), v('eyeSquintLeft'), v('eyeWideLeft'), face.gaze.x, face.gaze.y, Math.max(0, yaw) * 0.45);

    // Brows: inner end rises with browInnerUp, outer end with browOuterUp, both drop with browDown.
    const brow = (outerX: number, innerX: number, outerUp: number, down: number) => {
      const innerY = 304 - v('browInnerUp') * 50 + down * 36;
      const outerY = 296 - outerUp * 46 + down * 12;
      const midX = (outerX + innerX) / 2;
      const midY = Math.min(innerY, outerY) - 26 + down * 10;
      return `M ${f(outerX)} ${f(outerY)} Q ${f(midX)} ${f(midY)} ${f(innerX)} ${f(innerY)}`;
    };
    this.browScreenLeft.setAttribute('d', brow(318, 442, v('browOuterUpRight'), v('browDownRight')));
    this.browScreenRight.setAttribute('d', brow(682, 558, v('browOuterUpLeft'), v('browDownLeft')));

    const smileL = v('mouthSmileLeft');
    const smileR = v('mouthSmileRight');
    this.cheekScreenLeft.setAttribute('opacity', f(0.12 + 0.55 * Math.max(v('cheekSquintRight'), smileR * 0.8)));
    this.cheekScreenRight.setAttribute('opacity', f(0.12 + 0.55 * Math.max(v('cheekSquintLeft'), smileL * 0.8)));
    for (const cheek of [this.cheekScreenLeft, this.cheekScreenRight]) cheek.setAttribute('rx', f(58 + puff * 16));
    this.nose.setAttribute('transform', `translate(0 ${f(-(v('noseSneerLeft') + v('noseSneerRight')) * 7)})`);

    this.updateMouth(v);
  }

  private updateMouth(v: (name: Blendshape) => number): void {
    const open = clamp01(v('jawOpen') - 0.6 * v('mouthClose'));
    const smileL = v('mouthSmileLeft');
    const smileR = v('mouthSmileRight');
    const smile = (smileL + smileR) / 2;
    const frown = (v('mouthFrownLeft') + v('mouthFrownRight')) / 2;
    const funnel = v('mouthFunnel');
    const pucker = v('mouthPucker');
    const stretch = (v('mouthStretchLeft') + v('mouthStretchRight')) / 2;
    const press = (v('mouthPressLeft') + v('mouthPressRight')) / 2;
    const round = clamp01(funnel * 0.9 + pucker * 0.7);

    const width = 190 * clamp(1 + 0.3 * smile + 0.22 * stretch - 0.5 * pucker - 0.35 * funnel - 0.1 * press, 0.3, 1.6);
    const cx = 500 + (v('mouthLeft') - v('mouthRight')) * 46;
    const cy = 602;
    // Screen-left corner belongs to the character's right side.
    const left = { x: cx - width / 2, y: cy - (smileR - v('mouthFrownRight')) * 38 };
    const right = { x: cx + width / 2, y: cy - (smileL - v('mouthFrownLeft')) * 38 };
    const upper = open * 26 + (v('mouthUpperUpLeft') + v('mouthUpperUpRight')) * 6 + funnel * 12 + smile * 4;
    const lower = open * 122 + (v('mouthLowerDownLeft') + v('mouthLowerDownRight')) * 10 + funnel * 18 + smile * 18 - frown * 8;
    const inset = width * (0.3 - 0.3 * round);
    const cornerY = (left.y + right.y) / 2;
    const top = cornerY - Math.max(0, upper) * 1.33;
    const bottom = cornerY + Math.max(0, lower) * 1.33;
    const d =
      `M ${f(left.x)} ${f(left.y)} ` +
      `C ${f(left.x + inset)} ${f(top)} ${f(right.x - inset)} ${f(top)} ${f(right.x)} ${f(right.y)} ` +
      `C ${f(right.x - inset)} ${f(bottom)} ${f(left.x + inset)} ${f(bottom)} ${f(left.x)} ${f(left.y)} Z`;
    this.mouth.setAttribute('d', d);
    this.mouthClip.setAttribute('d', d);
    this.mouthOutline.setAttribute('d', d);

    const teethOpacity = smoothstep(0.06, 0.22, open);
    this.teeth.setAttribute('x', f(left.x));
    this.teeth.setAttribute('y', f(cornerY - upper - 6));
    this.teeth.setAttribute('width', f(width));
    this.teeth.setAttribute('height', '22');
    this.teeth.setAttribute('opacity', f(teethOpacity));
    this.tongue.setAttribute('cx', f(cx));
    this.tongue.setAttribute('cy', f(cornerY + lower * 0.95));
    this.tongue.setAttribute('rx', f(width * 0.32));
    this.tongue.setAttribute('ry', f(18 + lower * 0.22));

    const tongueOut = v('tongueOut');
    this.tongueOut.setAttribute('cx', f(cx));
    this.tongueOut.setAttribute('cy', f(cornerY + lower + 8 + tongueOut * 30));
    this.tongueOut.setAttribute('rx', '42');
    this.tongueOut.setAttribute('ry', f(12 + tongueOut * 36));
    this.tongueOut.setAttribute('opacity', tongueOut > 0.05 ? '1' : '0');
  }

  destroy(): void {
    this.root.remove();
  }
}

export const placeholder: CharacterDefinition = {
  id: 'placeholder',
  name: 'Anchor (placeholder)',
  description: 'A flat cartoon newsreader that exercises most of the 52 face channels.',
  create: (container) => new Anchor(container),
};
