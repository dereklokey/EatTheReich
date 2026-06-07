import { useCallback, useEffect, useState } from "react";
import { Entry } from "@/screens/Entry";
import { Game } from "@/screens/Game";
import { InkFilter } from "@/effects/InkFilter";
import { cleanCode } from "@/net/api";

/**
 * Tiny hash router: `#/` is create/join, `#/g/<CODE>` is the game room. The code lives
 * in the URL so it survives refresh and can be shared/bookmarked; seat ownership is
 * recovered separately from the localStorage seatToken on reconnect (§3A).
 */
function codeFromHash(): string | null {
  const m = /^#\/g\/([^/]+)/.exec(location.hash);
  return m ? cleanCode(decodeURIComponent(m[1]!)) : null;
}

export function App() {
  const [code, setCode] = useState<string | null>(codeFromHash);

  useEffect(() => {
    const onHash = () => setCode(codeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const enter = useCallback((c: string) => {
    location.hash = `#/g/${c}`;
  }, []);

  const exit = useCallback(() => {
    location.hash = "#/";
  }, []);

  return (
    <>
      <InkFilter />
      {code ? <Game code={code} onExit={exit} /> : <Entry onEnter={enter} />}
    </>
  );
}
