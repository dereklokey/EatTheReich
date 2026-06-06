import { useState, type ReactNode } from "react";
import type { GameState } from "@shared/state/types.js";
import type { Intent } from "@shared/protocol/messages.js";
import type { CharId } from "@shared/events/types.js";
import { CHAR_IDS } from "@shared/events/types.js";
import { STATS } from "@shared/domain/types.js";
import type { Power } from "@shared/domain/character.js";
import { CHARACTERS_BY_ID } from "@shared/data/characters.js";
import { seatName } from "@/game/seats";

/**
 * Character sheet (CLAUDE.md §4). The owner (and the GM) get the controls; everyone
 * else sees it read-only. Healing costs 3 Blood (RULES §5), so a heal both clears the
 * box and spends the Blood. All edits are server intents — the sheet never mutates
 * state directly.
 */
const HEAL_COST = 3;

export function CharacterSheet({
  seat,
  state,
  send,
  canEdit,
  onClose,
}: {
  seat: CharId;
  state: GameState;
  send: (i: Intent) => void;
  canEdit: boolean;
  onClose: () => void;
}) {
  const sheet = CHARACTERS_BY_ID[seat];
  const char = state.characters[seat];
  const [flashback, setFlashback] = useState(false);
  if (!sheet) return null;

  return (
    <div className="fixed inset-0 z-[66] flex justify-end">
      <button className="flex-1 bg-night-deep/70" aria-label="close" onClick={onClose} />
      <div className="w-full max-w-md h-full overflow-y-auto bg-paper text-paper-ink p-4 pb-24" style={{ boxShadow: "-12px 0 30px rgba(0,0,0,0.5)" }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="display text-3xl underline-squiggle inline-block">{sheet.name}</h2>
            <p className="mono text-xs text-paper-fade mt-1">{sheet.blurb}</p>
          </div>
          <button className="mono text-sm underline text-paper-fade" onClick={onClose}>close</button>
        </div>
        {(char.downed || char.dead) && (
          <div className="stamp mt-2">{char.dead ? "DEAD" : "DOWNED"}</div>
        )}

        <BloodSection seat={seat} char={char} canEdit={canEdit} state={state} send={send} />

        <Section title="Stats">
          <div className="grid grid-cols-4 gap-1.5">
            {STATS.map((s) => (
              <div key={s} className="text-center border border-paper-shadow py-1">
                <div className="mono text-[0.6rem] text-paper-fade">{s}</div>
                <div className="display text-xl">{sheet.stats[s]}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Equipment">
          {sheet.equipment.map((e) => {
            const tracked = e.uses !== undefined;
            const remaining = char.equipmentUses[e.id] ?? e.uses ?? 0;
            return (
              <div key={e.id} className="mb-2 border-b border-paper-shadow/40 pb-2">
                <div className="flex items-center gap-2">
                  <span className="mono text-sm flex-1">{e.name}</span>
                  {tracked && <UsePips total={e.uses ?? 0} left={remaining} />}
                  {canEdit && tracked && remaining > 0 && (
                    <button className="mono text-xs underline text-blood" onClick={() => send({ kind: "use_equipment", seat, itemId: e.id })}>
                      use
                    </button>
                  )}
                </div>
                {e.bonus && <div className="mono text-[0.65rem] text-paper-fade">+{e.bonus.plus} when “{e.bonus.tag}”</div>}
                {e.note && <div className="mono text-[0.65rem] text-paper-fade italic">{e.note}</div>}
              </div>
            );
          })}
        </Section>

        <PowerSection title="Abilities" powers={sheet.abilities} seat={seat} char={char} canEdit={canEdit} send={send} />
        <PowerSection title="Advances" powers={sheet.advances} seat={seat} char={char} canEdit={canEdit} send={send} advances />

        <Section title="Injuries">
          {sheet.injuries.map((cat, ci) => {
            const marked = char.injuries[ci] ?? 0;
            const category = ci as 0 | 1 | 2;
            return (
              <div key={ci} className="mb-2">
                <div className="flex items-center gap-2">
                  <span className="mono text-[0.6rem] text-paper-fade w-7" title={`rolled ${cat.faces[0]}–${cat.faces[1]}`}>
                    {cat.faces[0]}–{cat.faces[1]}
                  </span>
                  <span className="mono text-sm flex-1">{cat.boxes[0]?.label}</span>
                  {cat.boxes.map((box, bi) => (
                    <span key={bi} className="grid place-items-center w-5 h-5 border border-paper-shadow text-blood" title={box.penalty ?? box.label}>
                      {marked >= bi + 1 ? "✕" : ""}
                    </span>
                  ))}
                  {canEdit && marked > 0 && (
                    <button
                      className="mono text-xs underline text-blood disabled:opacity-40"
                      disabled={char.blood < HEAL_COST}
                      title={`Spend ${HEAL_COST} Blood to clear a box`}
                      onClick={() => {
                        send({ kind: "change_blood", seat, delta: -HEAL_COST, reason: "heal" });
                        send({ kind: "heal", seat, category, box: marked as 1 | 2 });
                      }}
                    >
                      heal ({HEAL_COST})
                    </button>
                  )}
                </div>
                {cat.boxes[1]?.penalty && marked >= 2 && (
                  <div className="mono text-[0.65rem] text-blood">penalty: {cat.boxes[1].penalty}</div>
                )}
              </div>
            );
          })}
        </Section>

        <Section title="Loot">
          {char.loot.length === 0 ? (
            <p className="mono text-xs text-paper-fade italic">No loot yet. One active slot at a time (RULES §11).</p>
          ) : (
            char.loot.map((item) => {
              const active = char.activeLootSlot === item.id;
              return (
                <div key={item.id} className="flex items-center gap-2 mb-1">
                  <span className="mono text-sm flex-1">{item.name}</span>
                  {active ? (
                    <span className="stamp text-[0.6rem]">active</span>
                  ) : (
                    canEdit && (
                      <button className="mono text-xs underline text-blood" onClick={() => send({ kind: "loot_activate", seat, itemId: item.id })}>
                        activate
                      </button>
                    )
                  )}
                </div>
              );
            })
          )}
        </Section>

        <Section title="Flashback">
          {char.flashbackUsedThisSession ? (
            <p className="mono text-xs text-paper-fade italic">Used this session.</p>
          ) : canEdit && state.session.active ? (
            <button className="display bg-dusk-mauve text-paper px-3 py-1.5 text-sm" style={{ borderRadius: 2 }} onClick={() => setFlashback(true)}>
              Trigger a flashback (+2 dice reroll)
            </button>
          ) : (
            <p className="mono text-xs text-paper-fade italic">Available once the session has started.</p>
          )}
        </Section>

        <Section title="Last stand">
          <p className="mono text-xs text-paper-fade italic">{sheet.lastStand}</p>
        </Section>
      </div>

      {flashback && (
        <FlashbackModal
          onCancel={() => setFlashback(false)}
          onConfirm={(context, question) => {
            send({ kind: "trigger_flashback", seat, context, question });
            setFlashback(false);
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="display text-lg mb-2">{title}</h3>
      {children}
    </section>
  );
}

function UsePips({ total, left }: { total: number; left: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`${left}/${total} uses`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="w-2.5 h-2.5 border border-paper-shadow" style={{ background: i < left ? "var(--blood)" : "transparent" }} />
      ))}
    </span>
  );
}

function BloodSection({
  seat,
  char,
  canEdit,
  state,
  send,
}: {
  seat: CharId;
  char: GameState["characters"][CharId];
  canEdit: boolean;
  state: GameState;
  send: (i: Intent) => void;
}) {
  const [to, setTo] = useState<CharId | "">("");
  const [amount, setAmount] = useState(1);
  const mates = CHAR_IDS.filter((id) => id !== seat && state.seats[id]?.claimed && !state.characters[id]?.dead);

  return (
    <Section title={`Blood — ${char.blood}/10`}>
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="h-3 flex-1" style={{ background: i < char.blood ? "var(--blood)" : "var(--paper-shadow)", borderRadius: 1 }} />
        ))}
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="mono text-xs px-2 bg-paper-shadow/50" onClick={() => send({ kind: "change_blood", seat, delta: -1 })}>−1</button>
          <button className="mono text-xs px-2 bg-paper-shadow/50" onClick={() => send({ kind: "change_blood", seat, delta: 1 })}>+1</button>
          {mates.length > 0 && (
            <span className="flex items-center gap-1 ml-auto">
              <select className="mono text-xs px-1 py-0.5 bg-paper-shadow/40" value={to} onChange={(e) => setTo(e.target.value as CharId)}>
                <option value="">share to…</option>
                {mates.map((id) => <option key={id} value={id}>{seatName(id)}</option>)}
              </select>
              <input type="number" min={1} max={char.blood} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-12 mono text-xs px-1 py-0.5 bg-paper-shadow/40" />
              <button
                className="mono text-xs underline text-blood disabled:opacity-40"
                disabled={!to || amount < 1 || amount > char.blood}
                onClick={() => { if (to) send({ kind: "share_blood", from: seat, to, amount }); }}
              >
                give
              </button>
            </span>
          )}
        </div>
      )}
    </Section>
  );
}

function PowerSection({
  title,
  powers,
  seat,
  char,
  canEdit,
  send,
  advances,
}: {
  title: string;
  powers: Power[];
  seat: CharId;
  char: GameState["characters"][CharId];
  canEdit: boolean;
  send: (i: Intent) => void;
  advances?: boolean;
}) {
  if (powers.length === 0) return null;
  return (
    <Section title={title}>
      {powers.map((p) => {
        const locked = advances ? !char.unlockedAdvances.includes(p.id) : false;
        return (
          <div key={p.id} className={`mb-2 border-b border-paper-shadow/40 pb-2 ${locked ? "opacity-50" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="mono text-sm font-bold flex-1">{p.name}</span>
              <span className="mono text-[0.6rem] uppercase text-paper-fade">{p.mechanic}{p.bloodCost ? ` · ${p.bloodCost} blood` : ""}</span>
              {advances && locked && canEdit && (
                <button className="mono text-xs underline text-blood" title="Drank Übermensch blood" onClick={() => send({ kind: "unlock_advance", seat, advanceId: p.id })}>
                  unlock
                </button>
              )}
              {!locked && canEdit && p.mechanic === "active" && p.bloodCost && char.blood >= p.bloodCost && (
                <button className="mono text-xs underline text-blood" onClick={() => send({ kind: "change_blood", seat, delta: -(p.bloodCost ?? 0), reason: p.name })}>
                  spend {p.bloodCost}
                </button>
              )}
            </div>
            <div className="mono text-[0.7rem] text-paper-fade">{p.text}</div>
            {p.bonus && <div className="mono text-[0.65rem] text-paper-fade">+{p.bonus.plus} when “{p.bonus.tag}”</div>}
          </div>
        );
      })}
    </Section>
  );
}

function FlashbackModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (context: string, question: string) => void }) {
  const [context, setContext] = useState("");
  const [question, setQuestion] = useState("");
  return (
    <div className="fixed inset-0 z-[74] grid place-items-center bg-night-deep/90 p-4" style={{ filter: "sepia(0.3)" }}>
      <div className="paper w-full max-w-md">
        <h3 className="display text-xl">Flashback</h3>
        <p className="mono text-xs text-paper-fade mt-1">A scene from before. Answer it, then reroll with +2 dice.</p>
        <input className="mono w-full mt-3 px-2 py-1.5 bg-paper-shadow/40" placeholder="context (where/when)" value={context} onChange={(e) => setContext(e.target.value)} />
        <input className="mono w-full mt-2 px-2 py-1.5 bg-paper-shadow/40" placeholder="the question the table asks you" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <button className="mono text-sm underline text-paper-fade" onClick={onCancel}>cancel</button>
          <button className="display bg-blood text-paper px-4 py-1.5" style={{ borderRadius: 2 }} disabled={!context.trim() || !question.trim()} onClick={() => onConfirm(context.trim(), question.trim())}>
            Cut to it
          </button>
        </div>
      </div>
    </div>
  );
}
