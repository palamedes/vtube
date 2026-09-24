import type { CameraMetrics } from '../shared/protocol';

export interface Advice {
  ok: boolean;
  text: string;
}

/**
 * Targets for a tracking shot: head and shoulders, face centered, eyes a
 * little above the middle. Trackers crop the face and resize it, so what
 * matters is how many pixels the face gets, with room left for nods and a
 * wide-open mouth.
 */
export const TARGET = {
  faceHeight: [0.3, 0.5] as const, // share of the frame height
  centerX: 0.08, // allowed distance from the middle, share of the frame width
  eyeY: [0.28, 0.5] as const, // eye line, share of the frame height from the top
  brightness: [80, 215] as const, // mean face brightness, 0..255
  fps: 50, // below this, suggest a faster camera mode
  restAngle: 12, // degrees; more than this at rest means the tracker sits off to one side
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const deg = (radians: number) => (radians * 180) / Math.PI;

/**
 * Plain-language checks for the camera, from the hub's framing measurements.
 * `mirrored`: the preview is shown mirrored. `expectedFps`: the rate the
 * camera agreed to deliver.
 */
export function cameraAdvice(m: CameraMetrics | null, mirrored: boolean, expectedFps = 60): Advice[] {
  if (!m) return [{ ok: false, text: 'No camera data yet.' }];
  const advice: Advice[] = [];
  if (!m.face) {
    advice.push({ ok: false, text: 'No face found. Face the camera and make sure nothing covers it.' });
  } else {
    const h = m.faceHeight ?? 0;
    if (h < TARGET.faceHeight[0]) {
      advice.push({ ok: false, text: `Face fills ${pct(h)} of the frame height. Move closer or zoom in (aim for 30 to 50%).` });
    } else if (h > TARGET.faceHeight[1]) {
      advice.push({ ok: false, text: `Face fills ${pct(h)} of the frame height. Move back or zoom out, so nods and a wide-open mouth stay in frame.` });
    } else {
      advice.push({ ok: true, text: `Face size is good (${pct(h)} of the frame height).` });
    }

    const shown = mirrored ? 1 - (m.centerX ?? 0.5) : (m.centerX ?? 0.5);
    const off = shown - 0.5;
    if (Math.abs(off) > TARGET.centerX) {
      advice.push({ ok: false, text: `You're ${pct(Math.abs(off))} ${off < 0 ? 'left' : 'right'} of center in the preview. Center yourself or pan.` });
    } else {
      advice.push({ ok: true, text: 'Centered.' });
    }

    const eyes = m.eyeY ?? 0.4;
    if (eyes < TARGET.eyeY[0]) {
      advice.push({ ok: false, text: 'Your eyes sit near the top of the frame. Aim the camera a little higher, or tilt it up.' });
    } else if (eyes > TARGET.eyeY[1]) {
      advice.push({ ok: false, text: 'Your eyes sit low in the frame. Aim the camera a little lower, or tilt it down.' });
    }

    if (m.brightness != null) {
      if (m.brightness < TARGET.brightness[0]) {
        advice.push({ ok: false, text: 'Your face is dark. Add soft light in front of you, not behind you.' });
      } else if (m.brightness > TARGET.brightness[1]) {
        advice.push({ ok: false, text: 'Your face is washed out. Dim or diffuse the light.' });
      } else {
        advice.push({ ok: true, text: 'Lighting is fine.' });
      }
    }
  }
  if (m.fps > 0 && m.fps < expectedFps * 0.85) {
    advice.push({
      ok: false,
      text: `The camera is delivering ${Math.round(m.fps)} of ${Math.round(expectedFps)} fps. Turn off "Slow down in low light" below, or add light.`,
    });
  } else if (expectedFps < TARGET.fps) {
    advice.push({ ok: false, text: `The camera mode is ${Math.round(expectedFps)} fps; 60 fps tracks mouths more smoothly.` });
  }
  return advice;
}

/**
 * Where the tracker sits relative to where you look, from the head angle it
 * measures while you look at your script. Works for the phone and the camera.
 * Yaw > 0 means your head points to your left of the tracker (shared conventions).
 */
export function restAngleAdvice(yaw: number, pitch: number, tracker: string): Advice[] {
  const advice: Advice[] = [];
  const y = deg(yaw);
  const p = deg(pitch);
  if (p > TARGET.restAngle) advice.push({ ok: false, text: `The ${tracker} looks up at you (${Math.round(p)}°). Raise it closer to eye level.` });
  else if (p < -TARGET.restAngle) advice.push({ ok: false, text: `The ${tracker} looks down at you (${Math.round(-p)}°). Lower it closer to eye level.` });
  if (y > TARGET.restAngle) advice.push({ ok: false, text: `The ${tracker} is off to your right (${Math.round(y)}°). Move it toward the middle, next to your script.` });
  else if (y < -TARGET.restAngle) advice.push({ ok: false, text: `The ${tracker} is off to your left (${Math.round(-y)}°). Move it toward the middle, next to your script.` });
  if (advice.length === 0) advice.push({ ok: true, text: `The ${tracker} is square to you while you read.` });
  return advice;
}
