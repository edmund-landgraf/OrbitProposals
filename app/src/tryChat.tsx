import { useEffect, useMemo, useRef, useState } from "react";
import { describeRefusal, describeResult } from "../shared/tryFormat";
import type { SampleCall, SamplePlan } from "./tryChatSamples";
import { Check, JsonView } from "./tryMe";

/** How long each bubble waits before it shows, in ms: a readable base plus time for longer text, capped. */
export const REVEAL_MS = 2600;
export const REVEAL_MS_PER_CHAR = 20;
export const REVEAL_MS_MAX = 6000;
export const revealDelay = (chars: number) => Math.min(REVEAL_MS_MAX, REVEAL_MS + Math.max(0, chars - 60) * REVEAL_MS_PER_CHAR);
const FACTS_SHOWN = 4;

type Step = { section: number; call: number; side: "left" | "right" };

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s);
/** Short args for the call chip: ids shortened, long strings clipped. */
export function shortArgs(args: unknown): string {
  const walk = (v: unknown): unknown => typeof v === "string" ? (isUuid(v) ? `${v.slice(0, 8)}…` : v.length > 28 ? `${v.slice(0, 27)}…` : v)
    : Array.isArray(v) ? (v.length > 3 ? [...v.slice(0, 3).map(walk), `+${v.length - 3}`] : v.map(walk))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)])) : v;
  const text = JSON.stringify(walk(args ?? {}));
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function Answer({ call }: { call: SampleCall }) {
  const [more, setMore] = useState(false);
  const described = call.status === "ok" ? describeResult(call.tool, call.result) : { text: describeRefusal(call.error), facts: [] as string[] };
  const facts = more ? described.facts : described.facts.slice(0, FACTS_SHOWN);
  const raw = call.status === "ok" ? call.result : { error: call.errorRaw ?? call.error };
  return (
    <>
      <p className="try-chat-answer">{described.text}</p>
      {facts.length > 0 && <ul className="try-chat-facts">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
      {described.facts.length > FACTS_SHOWN && (
        <button type="button" className="try-chat-more" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? "Show less" : `Show more (${described.facts.length - FACTS_SHOWN})`}
        </button>
      )}
      <details className="try-chat-raw"><summary>Raw JSON</summary><div className="try-me-json" tabIndex={0}><JsonView value={raw} /></div></details>
    </>
  );
}

/**
 * The Chat view: a recorded sample conversation, every bubble rendered up front and hidden, then shown in order on
 * a timer. Only this component reads the sample script; the live run never does.
 */
export function TryChatView({ planCode, playKey }: { planCode: string; playKey: number }) {
  const [plans, setPlans] = useState<SamplePlan[] | null>(null);
  const code = planCode;
  const [shown, setShown] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const lastY = useRef(0);
  const ours = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { void import("./tryChatSamples").then((m) => setPlans(m.samplePlans)); }, []);
  const plan = plans?.find((p) => p.code === code) ?? null;
  const steps = useMemo<Step[]>(() => plan ? plan.sections.flatMap((s, si) => s.calls.flatMap((_, ci) => [{ section: si, call: ci, side: "left" as const }, { section: si, call: ci, side: "right" as const }])) : [], [plan]);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const play = () => { setFollow(true); if (reduced) { setShown(steps.length - 1); setPlaying(false); } else { setShown(0); setPlaying(true); } };
  useEffect(() => {
    if (!playing) return;
    if (shown >= steps.length - 1) { setPlaying(false); return; }
    // The bubble on screen gets reading time in proportion to its text.
    const el = root.current?.querySelector<HTMLElement>(`[data-step="${shown}"]`);
    const t = window.setTimeout(() => setShown((n) => n + 1), revealDelay(el?.innerText.length ?? 0));
    return () => window.clearTimeout(t);
  }, [playing, shown, steps.length]);
  useEffect(() => { setShown(-1); setPlaying(false); }, [code]);
  // The page's Start button plays the selected plan's conversation.
  useEffect(() => { if (playKey > 0 && steps.length) play(); }, [playKey, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the newest bubble, unless the visitor scrolled up; scrolling back to the bottom resumes.
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
      if (Date.now() - ours.current > 400) { if (y < lastY.current - 4) setFollow(false); else if (atBottom) setFollow(true); }
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (shown < 0 || !follow || reduced) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-step="${shown}"]`);
    if (el) { ours.current = Date.now(); el.scrollIntoView({ block: "nearest" }); }
  }, [shown, follow, reduced]);

  if (!plans) return <p>Loading the sample conversation…</p>;
  const stepIndex = (si: number, ci: number, side: "left" | "right") => steps.findIndex((s) => s.section === si && s.call === ci && s.side === side);
  const next = steps[shown + 1];
  const current = shown < 0 ? 0 : next ? next.section : (plan?.sections.length ?? 1) - 1;
  const finished = shown >= steps.length - 1 && steps.length > 0;
  
  return (
    <div className="try-chat" ref={root} data-shown={shown} data-total={steps.length}>
      <div className="try-chat-head">
        <span className="try-chat-sample" data-testid="sample-tag">Sample data</span>
      </div>
      <p className="try-chat-note">A recorded sample conversation, not a live run. Pick a plan above and press Start to play it, or switch to Live run to call the sandbox for real.</p>
      {!plan && <p className="try-chat-note">There's no sample conversation for this plan yet.</p>}
      {plan && shown >= 0 && (
        <ol className="try-chat-sections" aria-live="polite">
          {plan.sections.map((section, si) => {
            const state = finished ? "final" : si < current ? "done" : si === current ? "current" : si === current + 1 ? "next" : "later";
            const visible = state !== "later";
            const body = section.calls.map((call, ci) => {
              const l = stepIndex(si, ci, "left"); const r = stepIndex(si, ci, "right");
              const answered = shown >= r;
              return (
                <li key={ci} className="try-chat-exchange" data-call={ci + 1}>
                  <div className="try-chat-bubble is-left" data-step={l} hidden={shown < l}>
                    <p className="try-chat-request">{call.request}</p>
                    <p className="try-chat-call" data-check={answered ? "done" : "pending"}>
                      <Check state={answered ? "done" : "pending"} label={answered ? (call.status === "refused" ? "Done, refused as expected" : "Done") : "Pending"} />
                      <span>Call {ci + 1}</span> <code>{call.tool}</code> <small>{shortArgs(call.args)}</small>
                    </p>
                  </div>
                  <div className={`try-chat-bubble is-right${call.status === "refused" ? " is-refused" : ""}`} data-step={r} hidden={!answered}>
                    <Answer call={call} />
                  </div>
                </li>
              );
            });
            if (state === "done") return (
              <li key={si} className="try-chat-section is-done" data-seq={si + 1}>
                <details><summary><Check state="done" label="Done" /> <span className="try-chat-title">{section.title}</span> <small>{section.calls.length} {section.calls.length === 1 ? "call" : "calls"}</small></summary>
                  <ol className="try-chat-exchanges">{body}</ol></details>
              </li>
            );
            return (
              <li key={si} className={`try-chat-section is-${state}`} data-seq={si + 1} hidden={!visible}>
                <h2 className="try-chat-title">{section.title}</h2>
                <p className="try-chat-narration">{section.narration}</p>
                <ol className="try-chat-exchanges">{body}</ol>
              </li>
            );
          })}
        </ol>
      )}
      {plan && shown >= 0 && !finished && current + 2 < plan.sections.length && <p className="try-me-chunk-later">{plan.sections.length - current - 2} more {plan.sections.length - current - 2 === 1 ? "section" : "sections"} after these</p>}
      {finished && <p className="try-chat-done">That's the whole sample conversation.</p>}
      <div className="try-chat-actions">
        <button type="button" className="button button-secondary" disabled>Continue in web chat (coming soon)</button>
        {!follow && playing && <button type="button" className="button button-secondary" onClick={() => setFollow(true)}>Follow the newest message</button>}
      </div>
    </div>
  );
}
