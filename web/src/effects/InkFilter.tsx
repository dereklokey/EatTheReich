/**
 * The #stamp-ink SVG filter — shared rubber-stamp ink texture used by every crimson
 * stamp in the app (the F.A.N.G. crew header, the pool-source selections in the action
 * screen, …). Edge displacement breaks the outline; a coarse noise mask knocks out ink
 * patches — so a stamp looks unevenly pressed, like the real thing, with the inconsistency
 * flowing continuously across the whole word rather than repeating per glyph.
 *
 * Mounted once at the app root so the filter id resolves on any screen. Hidden via 0×0
 * (NOT display:none, which disables filter rendering in Firefox). The filter is referenced
 * from CSS (`filter: url("#stamp-ink")`) and dropped under reduce-effects there, matching
 * the grain guardrail in theme.css.
 */
export function InkFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <filter id="stamp-ink" x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.75 0.85" numOctaves="2" seed="11" result="edge" />
        <feDisplacementMap in="SourceGraphic" in2="edge" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feTurbulence type="fractalNoise" baseFrequency="0.18" numOctaves="3" seed="4" result="blotch" />
        <feColorMatrix in="blotch" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="blotchA" />
        <feComponentTransfer in="blotchA" result="mask">
          <feFuncA type="discrete" tableValues="0 1 1 1 1" />
        </feComponentTransfer>
        <feComposite in="rough" in2="mask" operator="in" />
      </filter>
    </svg>
  );
}
