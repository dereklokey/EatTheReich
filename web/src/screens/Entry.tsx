import { useState } from "react";
import { createGame, cleanCode } from "@/net/api";

/**
 * Create / join (CLAUDE.md §3.6). Create mints a code via the Worker; join takes a
 * code the GM read out. The code IS the access key — no accounts. Tone leans pulp
 * (DESIGN.md §7), but stays out of the way of the two buttons that matter.
 */
export function Entry({ onEnter }: { onEnter: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      onEnter(await createGame());
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not create game");
      setBusy(false);
    }
  }

  function join() {
    const c = cleanCode(code);
    if (c.length < 4) {
      setError("that doesn't look like a game code");
      return;
    }
    onEnter(c);
  }

  return (
    <div className="substrate grain min-h-full grid place-items-center p-6">
      <div className="paper w-full max-w-md">
        <h1 className="display text-4xl text-paper-ink underline-squiggle inline-block">Eat the Reich</h1>
        <p className="mono text-paper-fade mt-3 text-sm">
          Paris, 1943. Six vampires, one war file. Pour a drink and pick up the table.
        </p>

        <button
          className="mt-6 w-full display tracking-wide text-paper bg-blood py-3 disabled:opacity-50"
          style={{ borderRadius: 2 }}
          onClick={create}
          disabled={busy}
        >
          {busy ? "minting…" : "Start a new game"}
        </button>

        <div className="mono text-center text-paper-fade my-4 text-xs">— or join one —</div>

        <div className="flex gap-2">
          <input
            className="mono flex-1 px-3 py-3 bg-paper-shadow/40 text-paper-ink uppercase tracking-widest outline-none"
            style={{ borderRadius: 2 }}
            placeholder="GAME CODE"
            value={code}
            maxLength={10}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button className="stamp" onClick={join}>
            join
          </button>
        </div>

        {error && <p className="mono text-blood mt-3 text-sm">{error}</p>}
      </div>
    </div>
  );
}
