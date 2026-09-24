import { BS, type Blendshape } from '../shared/arkit';
import { clamp, clamp01, smoothstep, type FaceState } from '../shared/processing';
import type { CharacterDefinition, CharacterInstance, CharacterOptions } from './types';

/**
 * "Mascot": a gruff streamer with a backwards red cap, a headset with a boom
 * mic, small round glasses, heavy brows, a big nose, and a blond goatee,
 * drawn in the bold outlined style of esports mascot logos. Animated from the
 * same 52 face channels as every character: the brows scowl or lift, the
 * slit eyes blink, the grimace opens with the jaw, and the goatee drops with it.
 *
 * Proportions follow the reference art: a broad, jowly head with the cap on
 * its top third, eyes peering over the glasses, the goatee reaching the chest.
 */

const NS = 'http://www.w3.org/2000/svg';
const INK = '#0a1142';
const SKIN = '#fcc69c';
const SKIN_SHADE = '#e89b70';
const SKIN_DARK = '#d98459';
const STRAP_SKIN = '#f2b184';
const RED = '#e8302f';
const RED_DARK = '#a31f35';
const BEARD_LIGHT = '#faf6a7';
const BEARD_MID = '#f3d77c';
const BEARD_DARK = '#e9bb57';
const CYAN = '#55e8ff';
const STRIPE = '#c5ced9';
const MOUTH = '#4a1426';
let instances = 0;

type Attrs = Record<string, string | number>;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  parent?.appendChild(el);
  return el;
}

const f = (x: number) => x.toFixed(1);
const ink = (width: number): Attrs => ({ stroke: INK, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
/** Mirror an x coordinate around the face's center line (x = 500). */
const mirrorX = (x: number) => 1000 - x;
/** Mirror a path made of absolute "x y" pairs. */
const mirrorPath = (d: string) => d.replace(/(\d+) (\d+)/g, (_, x: string, y: string) => `${mirrorX(Number(x))} ${y}`);

class Mascot implements CharacterInstance {
  private readonly root: SVGSVGElement;
  private readonly body: SVGGElement;
  private readonly head: SVGGElement;
  private readonly skull: SVGPathElement;
  private readonly cap: SVGGElement;
  private readonly temples: SVGPathElement;
  private readonly cups: SVGGElement;
  private readonly features: SVGGElement;
  private readonly wrinkles: SVGGElement;
  private readonly browScreenLeft: SVGPathElement;
  private readonly browScreenRight: SVGPathElement;
  private readonly eyeScreenLeft: SVGPathElement;
  private readonly eyeScreenRight: SVGPathElement;
  private readonly glasses: SVGGElement;
  private readonly nose: SVGGElement;
  private readonly beard: SVGGElement;
  private readonly lowerLip: SVGPathElement;
  private readonly mouth: SVGPathElement;
  private readonly mouthClip: SVGPathElement;
  private readonly teethTop: SVGRectElement;
  private readonly teethBottom: SVGRectElement;
  private readonly tongue: SVGEllipseElement;
  private readonly mouthOutline: SVGPathElement;
  private readonly mustache: SVGPathElement;
  private readonly micArm: SVGPathElement;
  private readonly micTrim: SVGPathElement;
  private readonly micHead: SVGCircleElement;
  private options: CharacterOptions = { breathing: true };

  constructor(container: HTMLElement) {
    const id = `mascot${++instances}`;
    this.root = svg('svg', { viewBox: '0 0 1000 1000', preserveAspectRatio: 'xMidYMid meet', width: '100%', height: '100%' });
    this.root.style.display = 'block';
    this.root.style.overflow = 'visible';

    // Everything is cut off at the bottom of the frame like a bust, so the
    // jacket can sway without its hem showing.
    const cut = svg('clipPath', { id: `${id}-cut` }, this.root);
    svg('rect', { x: -1000, y: -1000, width: 3000, height: 2000 }, cut);
    const figure = svg('g', { 'clip-path': `url(#${id}-cut)` }, this.root);

    // Body: red track jacket, big pointed shirt collar, a zip, and two light
    // stripes over each shoulder and down the sleeve.
    this.body = svg('g', {}, figure);
    svg('path', { d: 'M 40 1100 L 56 1010 C 64 860 150 728 330 688 L 670 688 C 850 728 936 860 944 1010 L 960 1100 Z', fill: RED, ...ink(12) }, this.body);
    svg('path', { d: 'M 344 692 C 420 742 580 742 656 692 L 646 800 C 566 826 434 826 354 800 Z', fill: RED_DARK }, this.body);
    const stripe = { fill: 'none', stroke: STRIPE, 'stroke-width': 14 };
    for (const d of ['M 86 1100 L 90 1010 C 98 866 176 756 336 722', 'M 110 1100 L 114 1010 C 122 872 194 778 342 748']) {
      svg('path', { d, ...stripe }, this.body);
      svg('path', { d: mirrorPath(d), ...stripe }, this.body);
    }
    svg('path', { d: 'M 356 686 L 296 792 L 426 752 L 446 700 Z', fill: RED, ...ink(10) }, this.body);
    svg('path', { d: `M ${mirrorX(356)} 686 L ${mirrorX(296)} 792 L ${mirrorX(426)} 752 L ${mirrorX(446)} 700 Z`, fill: RED, ...ink(10) }, this.body);
    svg('path', { d: 'M 500 820 L 500 1100', fill: 'none', ...ink(10) }, this.body);

    // Head.
    this.head = svg('g', {}, figure);
    svg('rect', { x: 420, y: 600, width: 160, height: 110, rx: 30, fill: SKIN_SHADE, ...ink(10) }, this.head);
    this.skull = svg('path', { fill: SKIN, ...ink(12) }, this.head);
    // Shadow planes down the sides of the face.
    svg('path', { d: 'M 306 400 C 300 480 318 566 366 626 L 398 560 C 366 524 346 470 342 404 Z', fill: SKIN_SHADE }, this.head);
    svg('path', { d: `M ${mirrorX(306)} 400 C ${mirrorX(300)} 480 ${mirrorX(318)} 566 ${mirrorX(366)} 626 L ${mirrorX(398)} 560 C ${mirrorX(366)} 524 ${mirrorX(346)} 470 ${mirrorX(342)} 404 Z`, fill: SKIN_SHADE }, this.head);

    // Backwards cap on the top third of the head: dome, darker side panels,
    // the strap opening with a peek of forehead, three snap holes, a button.
    this.cap = svg('g', {}, this.head);
    svg('path', { d: 'M 292 322 C 280 200 380 106 500 104 C 620 106 720 200 708 322 C 660 288 586 264 500 264 C 414 264 340 288 292 322 Z', fill: RED, ...ink(12) }, this.cap);
    svg('path', { d: 'M 302 300 C 296 222 330 160 392 126 C 352 180 342 240 348 284 Z', fill: RED_DARK }, this.cap);
    svg('path', { d: `M ${mirrorX(302)} 300 C ${mirrorX(296)} 222 ${mirrorX(330)} 160 ${mirrorX(392)} 126 C ${mirrorX(352)} 180 ${mirrorX(342)} 240 ${mirrorX(348)} 284 Z`, fill: RED_DARK }, this.cap);
    svg('path', { d: 'M 422 178 C 422 150 578 150 578 178 L 574 254 C 540 248 460 248 426 254 Z', fill: STRAP_SKIN, ...ink(9) }, this.cap);
    svg('path', { d: 'M 426 216 C 470 207 530 207 574 216 L 573 252 C 530 245 470 245 427 252 Z', fill: '#ffffff', ...ink(8) }, this.cap);
    for (const [cx, cy] of [
      [462, 231],
      [500, 228],
      [538, 231],
    ]) {
      svg('circle', { cx, cy, r: 6.5, fill: INK }, this.cap);
    }
    svg('path', { d: 'M 468 108 C 468 88 532 88 532 108 Z', fill: RED, ...ink(9) }, this.cap);

    // Glasses' temple arms, tucked under the ear cups (rebuilt each frame).
    this.temples = svg('path', { fill: 'none', ...ink(8) }, this.head);

    // Headset: big ear cups over the sides of the head, a cyan accent on each.
    this.cups = svg('g', {}, this.head);
    for (const side of [-1, 1]) {
      const x = (dx: number) => f(side < 0 ? 500 - dx : 500 + dx);
      svg('path', { d: `M ${x(212)} 318 C ${x(206)} 300 ${x(196)} 296 ${x(188)} 306`, fill: 'none', ...ink(11) }, this.cups);
      svg('path', { d: `M ${x(196)} 326 C ${x(238)} 322 ${x(262)} 360 ${x(264)} 402 C ${x(266)} 444 ${x(244)} 480 ${x(200)} 478 Z`, fill: INK }, this.cups);
      svg('path', { d: `M ${x(200)} 342 C ${x(206)} 380 ${x(206)} 430 ${x(198)} 466`, fill: 'none', stroke: CYAN, 'stroke-width': 8, 'stroke-linecap': 'round' }, this.cups);
    }

    // Face features: they get extra parallax when the head turns.
    this.features = svg('g', {}, this.head);
    this.wrinkles = svg('g', { fill: 'none', stroke: SKIN_DARK, 'stroke-width': 5, 'stroke-linecap': 'round' }, this.features);
    svg('path', { d: 'M 432 286 C 466 278 534 278 568 286' }, this.wrinkles);
    svg('path', { d: 'M 412 304 C 456 294 544 294 588 304' }, this.wrinkles);
    for (const [cx, cy, r] of [
      [612, 318, 10],
      [632, 310, 5.5],
      [620, 336, 6.5],
    ]) {
      svg('circle', { cx, cy, r, fill: SKIN_DARK }, this.features);
    }
    this.browScreenLeft = svg('path', { fill: INK }, this.features);
    this.browScreenRight = svg('path', { fill: INK }, this.features);
    this.eyeScreenLeft = svg('path', { fill: '#ffffff', ...ink(6) }, this.features);
    this.eyeScreenRight = svg('path', { fill: '#ffffff', ...ink(6) }, this.features);

    // Small round glasses, sitting below the eyes.
    this.glasses = svg('g', {}, this.features);
    svg('path', { d: 'M 444 450 C 470 434 530 434 556 450', fill: 'none', ...ink(8) }, this.glasses);
    for (const cx of [404, 596]) {
      svg('circle', { cx, cy: 452, r: 40, fill: 'rgba(253, 222, 195, 0.45)', ...ink(8) }, this.glasses);
      svg('path', { d: `M ${cx - 16} 476 L ${cx + 10} 432 M ${cx + 2} 482 L ${cx + 24} 446`, fill: 'none', stroke: 'rgba(255,255,255,0.8)', 'stroke-width': 6, 'stroke-linecap': 'round' }, this.glasses);
    }

    // A big bulb of a nose.
    this.nose = svg('g', {}, this.features);
    svg('path', { d: 'M 444 530 C 422 516 434 482 462 486 C 466 456 534 456 538 486 C 566 482 578 516 556 530 C 542 546 522 540 500 548 C 478 540 458 546 444 530 Z', fill: SKIN, ...ink(9) }, this.nose);
    svg('ellipse', { cx: 504, cy: 500, rx: 19, ry: 10, fill: '#ffe2cc' }, this.nose);
    svg('path', { d: 'M 468 534 C 474 527 482 527 488 534 M 512 534 C 518 527 526 527 532 534', fill: 'none', ...ink(5) }, this.nose);

    // The goatee wraps the mouth and hangs to the chest; it drops with the jaw.
    this.beard = svg('g', {}, this.features);
    svg('path', { d: 'M 370 548 C 352 646 380 766 440 852 C 462 884 486 914 500 936 C 514 914 538 884 560 852 C 620 766 648 646 630 548 C 606 598 566 626 500 630 C 434 626 394 598 370 548 Z', fill: BEARD_DARK, ...ink(10) }, this.beard);
    svg('path', { d: 'M 398 610 C 400 690 428 776 470 842 C 482 862 492 880 500 894 C 508 880 518 862 530 842 C 572 776 600 690 602 610 C 578 634 544 650 500 652 C 456 650 422 634 398 610 Z', fill: BEARD_MID }, this.beard);
    svg('path', { d: 'M 446 656 C 448 720 468 790 492 844 L 500 862 L 508 844 C 532 790 552 720 554 656 C 536 664 518 668 500 668 C 482 668 464 664 446 656 Z', fill: BEARD_LIGHT }, this.beard);
    svg('path', { d: 'M 416 640 C 420 700 434 750 456 796 M 584 640 C 580 700 566 750 544 796 M 390 600 C 394 660 408 716 428 760 M 610 600 C 606 660 592 716 572 760 M 470 700 C 474 740 482 772 492 800 M 530 700 C 526 740 518 772 508 800', fill: 'none', stroke: BEARD_DARK, 'stroke-width': 6, 'stroke-linecap': 'round' }, this.beard);
    this.lowerLip = svg('path', { fill: SKIN, ...ink(8) }, this.beard);

    const clip = svg('clipPath', { id: `${id}-mouth` }, this.features);
    this.mouthClip = svg('path', {}, clip);
    this.mouth = svg('path', { fill: MOUTH }, this.features);
    const inside = svg('g', { 'clip-path': `url(#${id}-mouth)` }, this.features);
    this.tongue = svg('ellipse', { fill: '#e8596f' }, inside);
    this.teethBottom = svg('rect', { fill: '#ffffff', rx: 5 }, inside);
    this.teethTop = svg('rect', { fill: '#ffffff', rx: 5 }, inside);
    this.mouthOutline = svg('path', { fill: 'none', ...ink(8) }, this.features);
    this.mustache = svg('path', { fill: INK }, this.features);

    // Boom mic from the right ear cup to the corner of the mouth (rebuilt each frame).
    this.micArm = svg('path', { fill: 'none', ...ink(10) }, this.head);
    this.micTrim = svg('path', { fill: 'none', stroke: CYAN, 'stroke-width': 3.5, 'stroke-linecap': 'round' }, this.head);
    this.micHead = svg('circle', { r: 13, fill: INK }, this.head);

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
    const jaw = clamp01(v('jawOpen') - 0.5 * v('mouthClose'));

    // Layers slide by different amounts as the head turns, nearest the most:
    // the face over the skull, the ear cups (at the sides) least.
    const cupX = -yaw * 22;
    const cupY = pitch * 8;
    const faceX = yaw * 100;
    const faceY = -pitch * 72;
    this.body.setAttribute('transform', `translate(${f(yaw * 22)} ${f(-breathe * 2)}) rotate(${f(rollDeg * 0.2)} 500 1000)`);
    this.head.setAttribute('transform', `translate(${f(yaw * 76)} ${f(-pitch * 60 - breathe * 4)}) rotate(${f(rollDeg)} 500 690)`);
    this.cap.setAttribute('transform', `translate(${f(yaw * 14)} ${f(-pitch * 14)})`);
    this.cups.setAttribute('transform', `translate(${f(cupX)} ${f(cupY)})`);
    this.features.setAttribute('transform', `translate(${f(faceX)} ${f(faceY)})`);

    // Broad, jowly head; wider with puffed cheeks, longer as the jaw drops.
    const w = 1 + v('cheekPuff') * 0.05 - Math.min(0.07, Math.abs(yaw) * 0.14);
    const x = (dx: number) => f(500 + dx * w);
    const low = jaw * 26;
    this.skull.setAttribute(
      'd',
      `M 500 118 C ${x(110)} 118 ${x(190)} 190 ${x(200)} 300 C ${x(212)} 380 ${x(216)} 470 ${x(200)} ${f(540 + low * 0.3)} ` +
        `C ${x(188)} ${f(600 + low * 0.6)} ${x(150)} ${f(640 + low)} ${x(100)} ${f(660 + low)} C ${x(70)} ${f(672 + low)} ${x(30)} ${f(678 + low)} 500 ${f(678 + low)} ` +
        `C ${x(-30)} ${f(678 + low)} ${x(-70)} ${f(672 + low)} ${x(-100)} ${f(660 + low)} C ${x(-150)} ${f(640 + low)} ${x(-188)} ${f(600 + low * 0.6)} ${x(-200)} ${f(540 + low * 0.3)} ` +
        `C ${x(-216)} 470 ${x(-212)} 380 ${x(-200)} 300 C ${x(-190)} 190 ${x(-110)} 118 500 118 Z`,
    );

    // Heavy brows: a scowl at rest. browInnerUp lifts the inner ends (worried),
    // browDown sinks them (angrier), browOuterUp lifts the outer ends.
    // The character's right brow is on screen left.
    const brow = (sign: number, outerUp: number, down: number) => {
      const inner = -v('browInnerUp') * 44 + down * 24;
      const outer = -outerUp * 36 + down * 8;
      const mid = (inner + outer) / 2;
      const px = (dx: number) => f(500 + sign * dx);
      return (
        `M ${px(-172)} ${f(352 + outer)} C ${px(-164)} ${f(326 + outer)} ${px(-126)} ${f(314 + mid)} ${px(-90)} ${f(324 + mid)} ` +
        `C ${px(-60)} ${f(332 + mid)} ${px(-36)} ${f(356 + inner)} ${px(-22)} ${f(390 + inner)} ` +
        `C ${px(-40)} ${f(392 + inner)} ${px(-60)} ${f(382 + inner)} ${px(-78)} ${f(372 + mid)} ` +
        `C ${px(-106)} ${f(358 + mid)} ${px(-138)} ${f(360 + outer)} ${px(-160)} ${f(374 + outer)} ` +
        `C ${px(-176)} ${f(380 + outer)} ${px(-180)} ${f(366 + outer)} ${px(-172)} ${f(352 + outer)} Z`
      );
    };
    this.browScreenLeft.setAttribute('d', brow(1, v('browOuterUpRight'), v('browDownRight')));
    this.browScreenRight.setAttribute('d', brow(-1, v('browOuterUpLeft'), v('browDownLeft')));
    this.wrinkles.setAttribute('opacity', f(0.7 + 0.3 * clamp01(v('browInnerUp') + (v('browOuterUpLeft') + v('browOuterUpRight')) / 2)));

    // Pupil-less slit eyes under the brows (so reading a script never shows).
    // The inner corner sits lower, following the scowl.
    const eye = (sign: number, blink: number, squint: number, wide: number) => {
      const open = clamp(1 - blink - squint * 0.35 + wide * 0.45, 0, 1.6);
      const outerX = 500 + sign * -134;
      const innerX = 500 + sign * -66;
      const cx = (outerX + innerX) / 2;
      return (
        `M ${f(outerX)} 398 Q ${f(cx)} ${f(398 - 20 * open)} ${f(innerX)} 406 ` +
        `Q ${f(cx)} ${f(406 + 10 * open)} ${f(outerX)} 398 Z`
      );
    };
    this.eyeScreenLeft.setAttribute('d', eye(1, v('eyeBlinkRight'), v('eyeSquintRight'), v('eyeWideRight')));
    this.eyeScreenRight.setAttribute('d', eye(-1, v('eyeBlinkLeft'), v('eyeSquintLeft'), v('eyeWideLeft')));

    const sneer = v('noseSneerLeft') + v('noseSneerRight');
    this.glasses.setAttribute('transform', `translate(0 ${f(-sneer * 4)})`);
    this.nose.setAttribute('transform', `translate(0 ${f(-sneer * 7)})`);

    // The temple arms join the glasses (face layer) to the ear cups, so they
    // stretch on the near side and tuck away on the far side as the head turns.
    const hingeY = 444 + faceY - sneer * 4;
    this.temples.setAttribute(
      'd',
      `M ${f(366 + faceX)} ${f(hingeY)} L ${f(282 + cupX)} ${f(404 + cupY)} ` +
        `M ${f(mirrorX(366) + faceX)} ${f(hingeY)} L ${f(mirrorX(282) + cupX)} ${f(404 + cupY)}`,
    );
    // Likewise the mic boom runs from the right ear cup to the mouth.
    const sx = 722 + cupX;
    const sy = 452 + cupY;
    const ex = 640 + faceX;
    const ey = 552 + faceY;
    this.micArm.setAttribute('d', `M ${f(sx)} ${f(sy)} C ${f(sx + 2)} ${f(sy + 48)} ${f(ex + 50)} ${f(ey - 12)} ${f(ex)} ${f(ey)}`);
    this.micTrim.setAttribute('d', `M ${f(sx - 4)} ${f(sy + 10)} C ${f(sx - 6)} ${f(sy + 48)} ${f(ex + 48)} ${f(ey - 20)} ${f(ex + 6)} ${f(ey - 8)}`);
    this.micHead.setAttribute('cx', f(ex - 8));
    this.micHead.setAttribute('cy', f(ey + 2));

    this.updateMouth(v, jaw);
  }

  private updateMouth(v: (name: Blendshape) => number, jaw: number): void {
    const smileL = v('mouthSmileLeft');
    const smileR = v('mouthSmileRight');
    const smile = (smileL + smileR) / 2;
    const frown = (v('mouthFrownLeft') + v('mouthFrownRight')) / 2;
    const funnel = v('mouthFunnel');
    const pucker = v('mouthPucker');
    const stretch = (v('mouthStretchLeft') + v('mouthStretchRight')) / 2;
    const round = clamp01(funnel * 0.9 + pucker * 0.7);

    const width = 106 * clamp(1 + 0.25 * smile + 0.2 * stretch - 0.45 * pucker - 0.3 * funnel, 0.35, 1.5);
    const cx = 500 + (v('mouthLeft') - v('mouthRight')) * 34;
    const top = 566 - smile * 3 - (v('mouthUpperUpLeft') + v('mouthUpperUpRight')) * 4;
    const drop = jaw * 70 + (v('mouthLowerDownLeft') + v('mouthLowerDownRight')) * 7 + funnel * 9;
    const bottom = 586 + drop + smile * 4;
    // Screen-left corner belongs to the character's right side.
    const leftY = 574 - (smileR - v('mouthFrownRight')) * 22;
    const rightY = 574 - (smileL - v('mouthFrownLeft')) * 22;
    const lx = cx - width / 2;
    const rx = cx + width / 2;
    const inset = width * (0.12 - 0.12 * round);
    const d =
      `M ${f(lx)} ${f(leftY)} C ${f(lx + inset)} ${f(top - 5)} ${f(rx - inset)} ${f(top - 5)} ${f(rx)} ${f(rightY)} ` +
      `C ${f(rx - inset * 0.5)} ${f(bottom + 6 - frown * 5)} ${f(lx + inset * 0.5)} ${f(bottom + 6 - frown * 5)} ${f(lx)} ${f(leftY)} Z`;
    this.mouth.setAttribute('d', d);
    this.mouthClip.setAttribute('d', d);
    this.mouthOutline.setAttribute('d', d);

    // A grimace shows teeth even when closed; opening reveals the lower teeth and tongue.
    this.teethTop.setAttribute('x', f(lx));
    this.teethTop.setAttribute('y', f(top - 7));
    this.teethTop.setAttribute('width', f(width));
    this.teethTop.setAttribute('height', f(Math.max(15, 22 - jaw * 6)));
    this.teethBottom.setAttribute('x', f(lx));
    this.teethBottom.setAttribute('y', f(bottom - 10));
    this.teethBottom.setAttribute('width', f(width));
    this.teethBottom.setAttribute('height', '18');
    this.teethBottom.setAttribute('opacity', f(smoothstep(0.15, 0.4, jaw)));
    this.tongue.setAttribute('cx', f(cx));
    this.tongue.setAttribute('cy', f(bottom - 3));
    this.tongue.setAttribute('rx', f(width * 0.3));
    this.tongue.setAttribute('ry', f(8 + drop * 0.16));

    // The lower lip and goatee ride the jaw.
    this.beard.setAttribute('transform', `translate(0 ${f(drop * 0.85)})`);
    const lip = bottom - drop * 0.85; // in the beard's own coordinates
    this.lowerLip.setAttribute(
      'd',
      `M ${f(cx - width * 0.6)} ${f(lip - 4)} C ${f(cx - width * 0.46)} ${f(lip + 32)} ${f(cx + width * 0.46)} ${f(lip + 32)} ${f(cx + width * 0.6)} ${f(lip - 4)} Z`,
    );

    // A heavy, dark mustache on the upper lip, its ends drooping into the goatee.
    const my = top - 12 - smile * 3;
    const mw = 1 + smile * 0.08 - pucker * 0.18;
    const mx = (dx: number) => f(cx + dx * mw);
    this.mustache.setAttribute(
      'd',
      `M ${mx(-62)} ${f(my + 6)} C ${mx(-40)} ${f(my - 8)} ${mx(-18)} ${f(my - 4)} ${mx(0)} ${f(my + 6)} C ${mx(18)} ${f(my - 4)} ${mx(40)} ${f(my - 8)} ${mx(62)} ${f(my + 6)} ` +
        `C ${mx(84)} ${f(my + 16)} ${mx(92)} ${f(my + 38)} ${mx(84)} ${f(my + 60)} C ${mx(72)} ${f(my + 38)} ${mx(56)} ${f(my + 26)} ${mx(36)} ${f(my + 22)} ` +
        `C ${mx(22)} ${f(my + 20)} ${mx(9)} ${f(my + 23)} ${mx(0)} ${f(my + 27)} C ${mx(-9)} ${f(my + 23)} ${mx(-22)} ${f(my + 20)} ${mx(-36)} ${f(my + 22)} ` +
        `C ${mx(-56)} ${f(my + 26)} ${mx(-72)} ${f(my + 38)} ${mx(-84)} ${f(my + 60)} C ${mx(-92)} ${f(my + 38)} ${mx(-84)} ${f(my + 16)} ${mx(-62)} ${f(my + 6)} Z`,
    );
  }

  destroy(): void {
    this.root.remove();
  }
}

export const mascot: CharacterDefinition = {
  id: 'mascot',
  name: 'Mascot (cap, headset, goatee)',
  description: 'A gruff streamer in a backwards cap and headset, drawn in an esports-mascot style.',
  create: (container) => new Mascot(container),
};
