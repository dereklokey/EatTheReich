import { useEffect, useMemo, useRef, useState } from "react";
import type { DieFace } from "@shared/domain/types.js";
import { useGoDice } from "./GoDiceContext.js";
import type { GoDiceRawFrame } from "./GoDice.js";
import "./godice.css";

/**
 * GoDice diagnostic harness (issue #50). We don't own GoDice and the tester is remote, so we can't
 * coach a capture in real time — the harness has to produce trustworthy data on its own. The earlier
 * "set face N up, click N" design failed that: the captured face was just whichever button got
 * clicked, so a tester clicking the highlighted "next" button while a different face was up produced
 * a misleading "face 1 -> app read 5" with no way to tell a mislabel from a real bug.
 *
 * This is a ground-truth THROW LOG instead. The tester rolls a die; the moment it settles, the app's
 * emitted value appears and they tap the number that's ACTUALLY face-up. We record {physical, app
 * read, xyz, flat} per throw and flag mismatches. No ordering, no presupposed face — they just report
 * what they see after each throw, so the label can't drift from reality. The raw frame log is kept
 * underneath as forensics (it's where a tilt/move read clobbering a flat rest would show up).
 *
 * It reads the manager's roll + raw-frame channels; both only fire while this panel is subscribed, so
 * normal play is unaffected.
 */

const FACES: DieFace[] = [1, 2, 3, 4, 5, 6];
/** Plenty of frames to capture a dozen-plus throws, while staying small enough to paste in a message. */
const MAX_LOG = 200;

type LoggedFrame = GoDiceRawFrame & { t: number };

/** A settled throw still awaiting the tester's "what's actually face-up" label. */
interface PendingThrow {
  appRead: DieFace;
  xyz: [number, number, number] | null;
  flat: boolean | null;
}

/** A labelled throw: the app's emitted value vs the face the tester says is really up. */
interface ThrowRecord extends PendingThrow {
  physical: DieFace;
}

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
  const [throws, setThrows] = useState<ThrowRecord[]>([]);
  const [pending, setPending] = useState<PendingThrow | null>(null);
  const [copied, setCopied] = useState(false);
  const t0 = useRef<number | null>(null);
  // The most recent stable frame — used to attach xyz/flat to a settled roll (which only carries a
  // value). A ref so the roll subscription reads the latest without re-subscribing.
  const lastStable = useRef<LoggedFrame | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Only listen while the panel is open — keeps the roll + raw-frame channels (and React churn) idle
  // during normal play. One effect owns both subscriptions so they tear down together.
  useEffect(() => {
    if (!open) return;
    const unsubFrames = goDice.subscribeRawFrames((f) => {
      const now = performance.now();
      if (t0.current === null) t0.current = now;
      const logged: LoggedFrame = { ...f, t: Math.round(now - t0.current) };
      if (f.kind === "stable") lastStable.current = logged;
      setFrames((cur) => {
        const next = [...cur, logged];
        return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
      });
    });
    // A settled throw is the app's emitted value — the same number play would show. Park it as the
    // pending throw (replacing any unlabelled one) for the tester to ground-truth against the die.
    const unsubRolls = goDice.subscribeRolls((roll) => {
      const s = lastStable.current;
      setPending({
        appRead: roll.value,
        xyz: s && s.value === roll.value ? s.xyz : (s?.xyz ?? null),
        flat: s?.flat ?? null,
      });
    });
    return () => {
      unsubFrames();
      unsubRolls();
    };
  }, [open, goDice]);

  const mismatches = useMemo(() => throws.filter((t) => t.physical !== t.appRead).length, [throws]);

  const dump = useMemo(() => {
    const lines: string[] = [];
    lines.push(`=== GoDice diagnostic — ${new Date().toISOString()} ===`);
    lines.push(`ua: ${navigator.userAgent}`);
    const connected = goDice.dice.filter((d) => d.connected).map((d) => d.name).join(", ");
    lines.push(`connected dice: ${connected || "(none)"}`);
    lines.push("");
    lines.push("# Throws — physical face (tester-reported, actually up) vs what the app read");
    lines.push("# n | physical -> app | rest | xyz | match");
    if (throws.length === 0) {
      lines.push("(none logged yet)");
    } else {
      throws.forEach((t, i) => {
        const ok = t.physical === t.appRead ? "ok" : "MISMATCH";
        const rest = t.flat === null ? "?" : t.flat ? "flat" : "tilt";
        lines.push(`${String(i + 1).padStart(2, " ")} | ${t.physical} -> ${t.appRead} | ${rest} | [${t.xyz?.join(",") ?? ""}] | ${ok}`);
      });
      lines.push(`summary: ${throws.length} throws, ${mismatches} mismatch${mismatches === 1 ? "" : "es"}`);
    }
    lines.push("");
    lines.push(`# Frame log (${frames.length} frames, oldest first; t = ms since first frame)`);
    for (const f of frames) {
      lines.push(`t=${String(f.t).padStart(6, " ")}  ${f.ascii.padEnd(4, " ")}  ${frameDetail(f)}  bytes=[${f.bytes.join(",")}]`);
    }
    return lines.join("\n");
  }, [throws, mismatches, frames, goDice.dice]);

  const label = (physical: DieFace) => {
    if (!pending) return;
    setThrows((cur) => [...cur, { ...pending, physical }]);
    setPending(null);
  };

  const undoLast = () => setThrows((cur) => cur.slice(0, -1));

  const reset = () => {
    setThrows([]);
    setPending(null);
    setFrames([]);
    lastStable.current = null;
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

  // Local-only preview: fire a synthetic roll through the real path so the pending → label flow can be
  // eyeballed (and the dump format checked) with no hardware. It carries no xyz (no stable frame).
  const addSample = () => goDice.simulateRoll();

  const connectedCount = goDice.dice.filter((d) => d.connected).length;

  return (
    <div className="godice-diag">
      <button className="reichroll__link godice-diag__toggle" onClick={() => setOpen((o) => !o)}>
        🔬 {open ? "hide diagnostic" : "diagnose dice"}
      </button>

      {open && (
        <div className="godice-diag__body">
          <p className="reichroll__hint godice-diag__intro">
            Helps fix wrong-face reads. <b>Roll a die.</b> When it stops, the app's read appears below — tap the
            number that's <b>actually face-up</b>. Do a dozen-plus throws across different faces, then <b>Copy</b> and
            send it over.
          </p>

          {connectedCount === 0 && (
            <p className="reichroll__hint">Connect a die above first — rolls will show up here.</p>
          )}

          {pending ? (
            <div className="godice-diag__pending">
              <div className="godice-diag__pending-read">
                app read <b>{pending.appRead}</b>
                <span className="godice-diag__dim">
                  {" "}
                  · xyz=[{pending.xyz?.join(",") ?? "—"}]{pending.flat === false ? " (tilt/move)" : pending.flat ? "" : ""}
                </span>
              </div>
              <div className="godice-diag__pending-ask">Which face is actually up?</div>
              <div className="godice-diag__faces" role="group" aria-label="report the face that is actually up">
                {FACES.map((face) => (
                  <button
                    key={face}
                    className={`godice-diag__face ${face === pending.appRead ? "is-next" : ""}`}
                    onClick={() => label(face)}
                    title={`the die is actually showing ${face}`}
                  >
                    <span className="godice-diag__face-n">{face}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="reichroll__hint godice-diag__waiting">— roll a die; its read will appear here to confirm —</p>
          )}

          {throws.length > 0 && (
            <div className="godice-diag__tally">
              <div className="godice-diag__tally-row">
                {throws.map((t, i) => (
                  <span
                    key={i}
                    className={`godice-diag__chip ${t.physical === t.appRead ? "is-ok" : "is-bad"}`}
                    title={`throw ${i + 1}: physical ${t.physical} → app ${t.appRead}`}
                  >
                    {t.physical}→{t.appRead}
                  </span>
                ))}
              </div>
              <div className="godice-diag__tally-sum">
                {throws.length} throws · <b className={mismatches ? "godice-diag__bad-text" : ""}>{mismatches} mismatch{mismatches === 1 ? "" : "es"}</b>
                {" · "}
                <button className="reichroll__link" onClick={undoLast}>undo last</button>
              </div>
            </div>
          )}

          <textarea ref={taRef} className="godice-diag__dump" readOnly value={dump} rows={8} spellCheck={false} />

          <div className="godice-diag__actions">
            <button className="reichroll__btn" onClick={() => void copy()}>
              {copied ? "copied ✓" : "Copy data dump"}
            </button>
            <button className="reichroll__link" onClick={reset}>
              clear
            </button>
            <button className="reichroll__link" onClick={addSample} title="Fire a fake roll to preview the flow without hardware">
              + sample (preview)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
