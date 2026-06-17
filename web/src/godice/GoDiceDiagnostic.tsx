import { useEffect, useMemo, useRef, useState } from "react";
import type { DieFace } from "@shared/domain/types.js";
import { useGoDice } from "./GoDiceContext.js";
import type { GoDiceRawFrame } from "./GoDice.js";
import "./godice.css";

/**
 * GoDice diagnostic harness (issue #50). We don't own GoDice, so we can't see why a remote tester's
 * dice read the wrong face. This panel turns that into a one-shot, copy-pasteable data capture: the
 * GM connects a die, sets each physical face up and clicks the matching button, then copies a dump
 * that pins down whether our vector table matches their hardware (and, from the frame log, how a
 * throw actually sequences). No devtools, works on any device — just copy and paste back.
 *
 * It reads the raw-frame channel exposed by the manager; that channel only emits while this panel
 * is mounted/subscribed, so normal play is unaffected.
 */

const FACES: DieFace[] = [1, 2, 3, 4, 5, 6];
/** Plenty of frames to capture several throws, while staying small enough to paste in a message. */
const MAX_LOG = 200;

type LoggedFrame = GoDiceRawFrame & { t: number };

function frameDetail(f: GoDiceRawFrame): string {
  if (f.kind === "stable") {
    return `stable value=${f.value} flat=${f.flat} xyz=[${f.xyz?.join(",") ?? ""}]`;
  }
  return f.kind;
}

export function GoDiceDiagnostic() {
  const goDice = useGoDice();
  const [open, setOpen] = useState(false);
  const [frames, setFrames] = useState<LoggedFrame[]>([]);
  const [latest, setLatest] = useState<LoggedFrame | null>(null);
  const [captures, setCaptures] = useState<Record<number, LoggedFrame>>({});
  const [copied, setCopied] = useState(false);
  const t0 = useRef<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Only listen while the panel is open — keeps the raw-frame channel (and React churn) idle
  // during normal play.
  useEffect(() => {
    if (!open) return;
    return goDice.subscribeRawFrames((f) => {
      const now = performance.now();
      if (t0.current === null) t0.current = now;
      const logged: LoggedFrame = { ...f, t: Math.round(now - t0.current) };
      setFrames((cur) => {
        const next = [...cur, logged];
        return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
      });
      // A "rest" read (any stable variant) is what we capture against a known face.
      if (f.kind === "stable") setLatest(logged);
    });
  }, [open, goDice]);

  const nextFace = useMemo<DieFace | null>(() => FACES.find((f) => !captures[f]) ?? null, [captures]);

  const dump = useMemo(() => {
    const lines: string[] = [];
    lines.push(`=== GoDice diagnostic — ${new Date().toISOString()} ===`);
    lines.push(`ua: ${navigator.userAgent}`);
    const connected = goDice.dice.filter((d) => d.connected).map((d) => d.name).join(", ");
    lines.push(`connected dice: ${connected || "(none)"}`);
    lines.push("");
    lines.push("# Face mapping — physical face UP -> what the app read");
    lines.push("# physical -> app read | xyz | ascii | bytes(unsigned)");
    for (const face of FACES) {
      const c = captures[face];
      if (!c) {
        lines.push(`face ${face} -> (not captured)`);
        continue;
      }
      lines.push(
        `face ${face} -> app read ${c.value} | xyz=[${c.xyz?.join(",") ?? ""}] | "${c.ascii}" | [${c.bytes.join(",")}]`,
      );
    }
    lines.push("");
    lines.push(`# Frame log (${frames.length} frames, oldest first; t = ms since first frame)`);
    for (const f of frames) {
      lines.push(`t=${String(f.t).padStart(6, " ")}  ${f.ascii.padEnd(4, " ")}  ${frameDetail(f)}  bytes=[${f.bytes.join(",")}]`);
    }
    return lines.join("\n");
  }, [captures, frames, goDice.dice]);

  const capture = (face: DieFace) => {
    if (!latest) return;
    setCaptures((cur) => ({ ...cur, [face]: latest }));
  };

  const reset = () => {
    setCaptures({});
    setFrames([]);
    setLatest(null);
    t0.current = null;
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dump);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard permission (or insecure context) — select the text so it can be copied by hand.
      taRef.current?.select();
    }
  };

  // Local-only preview row so the harness can be eyeballed (format + copy) with no hardware.
  const addSample = () => {
    const now = performance.now();
    if (t0.current === null) t0.current = now;
    const sample: LoggedFrame = {
      deviceId: "sample",
      bytes: [83, 0, 64, 0],
      signed: [83, 0, 64, 0],
      ascii: "S.@.",
      kind: "stable",
      xyz: [0, 64, 0],
      value: 3,
      flat: true,
      t: Math.round(now - t0.current),
    };
    setFrames((cur) => [...cur, sample]);
    setLatest(sample);
  };

  const connectedCount = goDice.dice.filter((d) => d.connected).length;

  return (
    <div className="godice-diag">
      <button className="reichroll__link godice-diag__toggle" onClick={() => setOpen((o) => !o)}>
        🔬 {open ? "hide diagnostic" : "diagnose dice"}
      </button>

      {open && (
        <div className="godice-diag__body">
          <p className="reichroll__hint godice-diag__intro">
            Helps fix wrong-face reads. Set a die so a known number is face-up and resting, then click that
            number below. Do all six if you can, give the dice a few normal rolls, then <b>Copy</b> and send it
            over.
          </p>

          {connectedCount === 0 && (
            <p className="reichroll__hint">Connect a die above first — the live read appears here.</p>
          )}

          <div className="godice-diag__latest">
            <span>latest rest read:&nbsp;</span>
            {latest ? (
              <b>
                {latest.value} <span className="godice-diag__dim">· xyz=[{latest.xyz?.join(",")}] · {latest.ascii}{latest.flat ? "" : " (tilt/move)"}</span>
              </b>
            ) : (
              <span className="godice-diag__dim">— roll or place a die —</span>
            )}
          </div>

          <div className="godice-diag__faces" role="group" aria-label="capture a physical face">
            {FACES.map((face) => {
              const c = captures[face];
              return (
                <button
                  key={face}
                  className={`godice-diag__face ${c ? "is-captured" : ""} ${nextFace === face ? "is-next" : ""}`}
                  onClick={() => capture(face)}
                  disabled={!latest}
                  title={c ? `face ${face}: app read ${c.value} — click to recapture` : `set face ${face} up, then click`}
                >
                  <span className="godice-diag__face-n">{face}</span>
                  <span className="godice-diag__face-read">{c ? `→ ${c.value}` : "—"}</span>
                </button>
              );
            })}
          </div>

          <textarea ref={taRef} className="godice-diag__dump" readOnly value={dump} rows={8} spellCheck={false} />

          <div className="godice-diag__actions">
            <button className="reichroll__btn" onClick={() => void copy()}>
              {copied ? "copied ✓" : "Copy data dump"}
            </button>
            <button className="reichroll__link" onClick={reset}>
              clear
            </button>
            <button className="reichroll__link" onClick={addSample} title="Add a fake row to preview the format without hardware">
              + sample (preview)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
