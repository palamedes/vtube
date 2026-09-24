import { useState } from 'react';
import { useStudio } from '../useStudio';

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy">
      <code>{text}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

export function Setup({ onClose }: { onClose: () => void }) {
  const { hub, status } = useStudio();
  const link = status?.livelink;
  const port = hub?.network.livelinkPort ?? 11111;
  const lan = hub?.network.addresses.find((a) => /^(192\.168|10\.|172\.)/.test(a.address)) ?? hub?.network.addresses[0];
  const subnet = lan ? `${lan.address.split('.').slice(0, 3).join('.')}.0/24` : '192.168.1.0/24';
  const origin = `http://127.0.0.1:${hub?.network.httpPort ?? 8750}`;
  const firewalls = hub?.network.firewalls ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Setup">
        <header className="modal-head">
          <h2>Setup</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <section>
          <h3>iPhone: Live Link Face</h3>
          <ol>
            <li>Install <strong>Live Link Face</strong> (free, by Unreal Engine) on the iPhone.</li>
            <li>
              In the app: settings (gear) → <strong>Live Link</strong> → <strong>Add Target</strong>. Enter this PC's
              address and port:
              <div className="addresses">
                {(hub?.network.addresses ?? []).map((a) => (
                  <span key={a.address + a.iface}>
                    <Copy text={a.address} /> <span className="help small">({a.iface})</span>
                  </span>
                ))}
                <span>
                  port <Copy text={String(port)} />
                </span>
              </div>
            </li>
            <li>Use the <strong>Live Link (ARKit)</strong> capture mode, and turn on <strong>Stream Head Rotation</strong> if your version has it.</li>
            {firewalls.includes('ufw') && (
              <li>
                Let the phone through this PC's firewall (ufw is running), once:
                <div>
                  <Copy text={`sudo ufw allow proto udp from ${subnet} to any port ${port}`} />
                </div>
              </li>
            )}
            {firewalls.includes('firewalld') && (
              <li>
                Let the phone through this PC's firewall (firewalld is running), once:
                <div>
                  <Copy text={`sudo firewall-cmd --permanent --add-port=${port}/udp && sudo firewall-cmd --reload`} />
                </div>
              </li>
            )}
            <li>Keep the phone on its charger, mounted right next to where your script is, with Auto-Lock set to Never.</li>
          </ol>
          <div className="diag">
            <h4>What the hub sees</h4>
            {link ? (
              <dl>
                <dt>Listening</dt>
                <dd>{link.listening ? `UDP ${link.port}` : link.bindError ?? 'no'}</dd>
                <dt>Packets</dt>
                <dd>{link.receiving ? `${link.packetsPerSec}/s from ${link.sender}` : link.lastPacketAgo !== null ? `last one ${link.lastPacketAgo}s ago` : 'none yet'}</dd>
                <dt>Device</dt>
                <dd>{link.subject ? `${link.subject} (packet v${link.version})` : '—'}</dd>
                <dt>Face</dt>
                <dd>{link.faceDetected ? 'tracked' : link.receiving ? 'not in view' : '—'}</dd>
                <dt>Head rotation</dt>
                <dd>{link.headRotation ? 'streaming' : 'not seen yet (turn on Stream Head Rotation)'}</dd>
                <dt>Dropped frames</dt>
                <dd>{link.droppedFrames}</dd>
                <dt>Unreadable packets</dt>
                <dd>{link.parseErrors ? `${link.parseErrors}: ${link.lastError}` : 'none'}</dd>
              </dl>
            ) : (
              <p className="help">Waiting for the hub…</p>
            )}
            {link?.lastBadPacket && (
              <details>
                <summary>Last unreadable packet (for debugging)</summary>
                <code className="hex">{link.lastBadPacket}</code>
              </details>
            )}
          </div>
        </section>

        <section>
          <h3>OBS (for going live)</h3>
          <p className="help">For recorded videos you don't need OBS: open a take and use the Export tab.</p>
          <ol>
            <li>
              Add a <strong>Browser</strong> source per canvas. It shows your Studio scene: the character placed as in the Scene tab,
              the headline, and the background.
              <div>
                16:9 canvas, 1920 × 1080: <Copy text={`${origin}/render?view=wide&full=1`} />
              </div>
              <div>
                9:16 canvas (Aitum Vertical), 1080 × 1920: <Copy text={`${origin}/render?view=tall&full=1`} />
              </div>
            </li>
            <li>
              To build the rest of the scene in OBS instead, drop <code>&amp;full=1</code>: you get just the character, placed the same
              way, on a transparent background.
            </li>
            <li>Add your mic (the same RODE) as the audio source in OBS. These pages make no sound.</li>
          </ol>
          <p className="help small">
            Add <code>&amp;bg=checker</code> to a URL to see the transparency in a normal browser.
          </p>
        </section>
      </div>
    </div>
  );
}
