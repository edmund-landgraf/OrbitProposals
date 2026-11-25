/**
 * Plain-language descriptions of MCP tool results, shared by the /try live run (server/demo.ts, on real
 * results) and the /try chat view (on its sample script). Only formatting lives here, never data.
 */
export type Described = { text: string; facts: string[] };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, max = 70) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const human = (code: string) => code.replace(/_/g, " ");

/** Minor units to a short price, e.g. 300000 USD -> $3,000. */
export function money(minor: unknown, currency: unknown = "USD"): string | undefined {
  const n = num(minor);
  if (n === undefined) return undefined;
  const code = str(currency) ?? "USD";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: n % 100 === 0 ? 0 : 2 }).format(n / 100); }
  catch { return `${(n / 100).toFixed(2)} ${code}`; }
}

/** A date or timestamp as e.g. Nov 26, 2026. */
export function day(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const names = (items: unknown[], ...keys: string[]) => items.map((item) => { const o = obj(item); for (const k of keys) { const s = str(o[k]); if (s) return clip(s); } return undefined; }).filter((s): s is string => Boolean(s));

function proposal(p: Obj, verb: string): Described {
  const pricing = obj(p.pricing);
  const scope = obj(p.scope);
  const timeline = obj(p.timeline);
  const facts: string[] = [];
  const price = money(pricing.amountMinor, pricing.currency);
  if (price) facts.push(`Price: ${price}${str(pricing.model) ? ` (${human(String(pricing.model))})` : ""}`);
  const deliverables = arr(scope.deliverables).filter((d): d is string => typeof d === "string");
  if (deliverables.length) facts.push(`Deliverables: ${deliverables.map((d) => clip(d, 50)).join("; ")}`);
  if (str(timeline.startDate) || str(timeline.targetDate)) facts.push(`Timeline: ${day(timeline.startDate) ?? "?"} to ${day(timeline.targetDate) ?? "?"}`);
  if (num(p.version) !== undefined) facts.push(`Version ${p.version}`);
  const title = str(p.title) ?? "The proposal";
  return { text: `${verb} “${clip(title)}”, status ${human(str(p.status) ?? "unknown")}.`, facts };
}

function list(items: unknown[], noun: string, keys: string[], emptyText: string): Described {
  if (items.length === 0) return { text: emptyText, facts: [] };
  return { text: `${plural(items.length, noun)}.`, facts: names(items, ...keys) };
}

const formatters: Record<string, (e: Obj, raw: unknown) => Described> = {
  unw_get_service_info: (e) => {
    const scopes = arr(e.scopes).filter((s): s is string => typeof s === "string");
    const hidden = arr(e.hiddenTools);
    return { text: `Connected to ${str(e.service) ?? "the server"} with ${plural(scopes.length, "scope")}; ${plural(hidden.length, "tool")} need more access and are hidden.`, facts: scopes };
  },
  unw_get_catalog: (e) => {
    const plans = arr(e.plans);
    return { text: `${plural(plans.length, "engagement type")}, hourly rate ${money((num(e.hourlyRate) ?? 0) * 100, e.currency)}.`, facts: plans.map((p) => { const o = obj(p); const price = obj(o.price); const kind = str(o.priceKind); return `${str(o.name) ?? str(o.id)}: ${kind === "minimum" ? "from " : ""}${money(price.amountMinor, price.currency) ?? "?"}${kind === "rate" ? " an hour" : ""}${num(o.hours) ? `, ${o.hours} h` : ""}`; }) };
  },
  unw_set_contact_preference: (e) => {
    const p = obj(e.preference);
    const channel = str(p.channel) ?? "none";
    const facts = [`Time zone: ${str(p.timezone) ?? "not set"}`];
    if (str(p.email)) facts.push(`Email: ${p.email}`);
    facts.push(p.consentAt ? `Consent recorded ${day(p.consentAt)}` : "No consent recorded");
    return { text: channel === "none" ? "Saved: no reminders." : `Saved: reminders by ${human(channel)}.`, facts };
  },
  unw_create_proposal: (e) => proposal(e, "Created"),
  unw_get_proposal: (e) => proposal(e, "Read"),
  unw_export_proposal: (e) => proposal(e, "Exported"),
  unw_update_proposal_section: (e) => proposal(e, "Saved"),
  unw_list_proposals: (e) => list(arr(e.items), "proposal", ["title"], "No proposals yet."),
  unw_list_proposal_templates: (e, raw) => list(Array.isArray(raw) ? raw : arr(e.items), "template", ["name", "code"], "No templates."),
  unw_set_proposal_template: (e) => ({ text: `Built from “${str(e.name) ?? str(e.code)}”: ${plural(arr(e.nodes).length, "part")} and ${plural(arr(e.options).length, "option")}.`, facts: names(arr(e.nodes), "title") }),
  unw_list_section_library: (e, raw) => list(Array.isArray(raw) ? raw : arr(e.items), "reusable section", ["title"], "No reusable sections."),
  unw_add_proposal_section: (e) => ({ text: `Added the “${str(e.title) ?? str(e.key)}” section.`, facts: [str(e.guidance) ? `Guidance: ${clip(String(e.guidance), 90)}` : "", num(e.maxChars) ? `Up to ${e.maxChars} characters` : ""].filter(Boolean) }),
  unw_list_proposal_sections: (e) => list(arr(e.sections), "section", ["title", "id"], "No sections."),
  unw_list_guidance_events: (e) => {
    const items = arr(e.items).map(obj);
    const latest = items[0];
    const moves = latest ? arr(latest.suggestedMoves).map(obj) : [];
    return { text: items.length ? `${plural(items.length, "guidance turn")}; latest action ${str(latest?.actionTaken) ?? "none yet"}.` : "No guidance turns yet.", facts: moves.map((move) => `${str(move.move) ?? "move"}: ${clip(str(move.clientPhrase) ?? "", 80)}`) };
  },
  unw_get_proposal_progress: (e) => {
    const facts: string[] = [];
    if (str(e.phrase)) facts.push(String(e.phrase));
    const next = obj(e.nextStep);
    if (str(next.text)) facts.push(`Next: ${clip(String(next.text), 90)}`);
    const open = obj(e.handoff).openSummary;
    if (str(open)) facts.push(clip(String(open), 110));
    return { text: `${num(e.settled) ?? 0} of ${num(e.total) ?? 0} parts settled (${num(e.percent) ?? 0}%).`, facts };
  },
  unw_mark_part_unsure: (e) => ({ text: `${str(e.key) ?? "The part"}: “${str(e.label) ?? human(str(e.state) ?? "")}”. Progress is now ${num(e.percent) ?? 0}%.`, facts: e.flagsForCall ? ["Flagged for the call with a person"] : [] }),
  unw_agree_part: (e) => ({ text: `${str(e.key) ?? "The part"} is now “${str(e.label) ?? human(str(e.state) ?? "agreed")}”. Progress is now ${num(e.percent) ?? 0}%.`, facts: [] }),
  unw_get_completion_tree: (e) => {
    const nodes = arr(e.nodes).map(obj);
    const counts = new Map<string, number>();
    for (const n of nodes) { const label = str(n.stateLabel) ?? str(n.stateCode) ?? "unknown"; counts.set(label, (counts.get(label) ?? 0) + 1); }
    return { text: `${plural(nodes.length, "part")}, ${num(e.percent) ?? 0}% complete.`, facts: [...counts].map(([label, n]) => `${label}: ${n}`).concat(nodes.filter((n) => n.lockedVersionId).map((n) => `${str(n.title)} is locked`)) };
  },
  unw_review_proposal: (e) => {
    const sections = arr(e.sections).map(obj);
    return { text: `Review score ${num(e.score) ?? 0}/100: ${num(e.readySections) ?? 0} of ${num(e.totalSections) ?? sections.length} sections ready, ${plural(num(e.issueCount) ?? 0, "issue")}.`, facts: sections.map((s) => `${str(s.title) ?? str(s.key)}: ${num(s.score) ?? 0}`) };
  },
  unw_submit_proposal_for_review: (e) => { const v = obj(e.version); return { text: `Submitted. Review state ${human(str(e.state) ?? "unknown")}, version ${num(v.number) ?? "?"} saved.`, facts: v.id ? [`Version id ${String(v.id).slice(0, 8)}`] : [] }; },
  unw_get_proposal_status: (e) => { const r = obj(e.review); return { text: `${str(r.clientLabel) ?? human(str(r.state) ?? "Unknown")} (${human(str(e.status) ?? "")}), version ${num(e.version) ?? "?"}.`, facts: [`Open comments: ${num(r.openComments) ?? 0}`, `Open flags: ${num(r.openFlags) ?? 0}`, `Blocking: ${(num(r.openBlockingFlags) ?? 0) + (num(r.openBlockingComments) ?? 0)}`] }; },
  unw_preview_change_impact: (e) => ({ text: str(e.sentence) ? clip(String(e.sentence), 160) : "No impact.", facts: [`Progress ${num(e.percentBefore) ?? 0}% → ${num(e.percentAfter) ?? 0}%`, `Reopens ${plural(arr(e.reopened).length, "part")}`, `Holds ${plural(arr(e.held).length, "part")}`] }),
  unw_park_change: (e) => ({ text: `Parked the change. Progress stays at ${num(e.percent) ?? 0}%, ${plural(arr(e.reopened).length, "part")} reopened.`, facts: [] }),
  unw_park_item: (e) => ({ text: `Saved for later: “${clip(str(e.summary) ?? "note", 90)}”.`, facts: [] }),
  unw_list_parked: (e) => list(arr(e.items), "parked item", ["summary"], "Nothing parked."),
  unw_lock_node: (e) => ({ text: `Locked ${str(e.key) ?? "the part"} on version ${String(str(e.lockedVersionId) ?? "?").slice(0, 8)}; progress is now ${num(e.percent) ?? 0}%.`, facts: [] }),
  unw_unlock_node: (e) => ({ text: `Unlocked. ${str(e.sentence) ? clip(String(e.sentence), 120) : ""}`.trim(), facts: [`Progress ${num(e.percentBefore) ?? 0}% → ${num(e.percentAfter) ?? 0}%`] }),
  unw_duplicate_proposal: (e) => { const p = obj(e.proposal); const c = obj(e.copied); return { text: `Copied into “${clip(str(p.title) ?? "a new draft")}”, status ${human(str(p.status) ?? "draft")}.`, facts: [`${plural(num(c.nodes) ?? 0, "part")} copied`, money(obj(p.pricing).amountMinor, obj(p.pricing).currency) ? `Price ${money(obj(p.pricing).amountMinor, obj(p.pricing).currency)}` : ""].filter(Boolean) }; },
  unw_recommend_handoff: (e) => ({ text: `Asked for a person (${human(str(e.reasonCode) ?? "handoff")}).`, facts: str(e.note) ? [clip(String(e.note), 110)] : [] }),
  unw_get_reminder_options: (e) => {
    const channels = names(arr(e.channels), "label");
    const options = names(arr(e.ticklerOptions), "label");
    const d = obj(e.defaults);
    return { text: `${plural(channels.length, "channel")} and ${plural(options.length, "timing")} on offer. Quiet hours ${str(d.quietStart) ?? "?"} to ${str(d.quietEnd) ?? "?"}.`, facts: [...channels.map((c) => `Channel: ${c}`), ...options.map((o) => `Timing: ${o}`)] };
  },
  unw_set_tickler: (e) => {
    if ("stopped" in e) return { text: num(e.stopped) ? `Stopped ${plural(Number(e.stopped), "reminder")}.` : "Nothing to stop.", facts: [] };
    const t = obj(e.tickler);
    const every = num(t.intervalDays);
    const next = str(t.nextAt) ? new Date(String(t.nextAt)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: str(e.timezone) ?? "UTC", timeZoneName: "short" }) : undefined;
    return { text: `Scheduled: ${every ? `every ${plural(every, "day")}` : human(str(t.optionCode) ?? "once")} at ${str(t.timeOfDay) ?? "?"}.`, facts: [next ? `First nudge ${next}` : "", `Sent so far: ${num(t.sentCount) ?? 0}`].filter(Boolean) };
  },
  unw_add_review_comment: (e) => ({ text: `Comment added, status ${human(str(e.status) ?? "open")}, visible to the ${str(e.visibility) ?? "client"}.`, facts: [] }),
  unw_resolve_review_comment: (e) => ({ text: `Comment ${human(str(e.status) ?? "resolved")}.`, facts: [] }),
  unw_add_review_flag: (e) => ({ text: `Flag raised, status ${human(str(e.status) ?? "open")}${e.blocksApproval ? "; it blocks approval until resolved" : ""}.`, facts: [] }),
  unw_list_review_feedback: (e) => {
    const comments = arr(e.comments).map(obj);
    const flags = arr(e.flags).map(obj);
    const open = comments.filter((c) => c.status === "open").length;
    return { text: `${plural(comments.length, "comment")} (${open} open), ${plural(flags.length, "flag")}, ${plural(arr(e.versions).length, "version")}. Review: ${str(e.clientLabel) ?? human(str(e.state) ?? "")}.`, facts: [...comments.map((c) => `${human(str(c.type) ?? "comment")} (${str(c.status)}): ${clip(str(c.body) ?? "", 70)}`), ...flags.map((f) => `flag (${str(f.status)}): ${clip(str(f.body) ?? str(f.reasonCode) ?? "", 70)}`)] };
  },
  unw_get_proposal_expiry: (e) => ({ text: `${str(e.label) ?? "Open"}: valid until ${day(e.validUntil) ?? "?"}, ${plural(num(e.daysRemaining) ?? 0, "day")} left.`, facts: [`Reminder window: last ${plural(num(e.nearExpiryDays) ?? 0, "day")}`] }),
  unw_select_proposal_options: (e) => { const opts = arr(e.options); return { text: opts.length ? `${plural(opts.length, "option")} selected; total ${money(e.totalMinor)}.` : `No add-on options on this draft; the total stays ${money(e.totalMinor) ?? "?"}.`, facts: names(opts, "label", "code") }; },
  unw_list_consult_offerings: (e) => ({ text: `${plural(arr(e.items).length, "offering")}.`, facts: arr(e.items).map(obj).map((o) => `${str(o.label)}: ${money(obj(o.price).amountMinor, obj(o.price).currency) === "$0" ? "free" : money(obj(o.price).amountMinor, obj(o.price).currency)}, ${num(o.durationMinutes) ?? "?"} min`) }),
  unw_request_free_consult: (e) => { const i = obj(e.intake); const o = obj(e.offering); return { text: `Requested a ${str(o.label)?.toLowerCase() ?? "consult"}: “${clip(str(i.topic) ?? "", 70)}”.`, facts: [`${num(o.durationMinutes) ?? "?"} minutes, not yet scheduled`, `Requests left: ${num(e.remaining) ?? 0}`] }; },
  unw_list_consult_intakes: (e) => list(arr(e.items), "consult request", ["topic"], "No consult requests."),
  unw_create_chat_session: (e) => ({ text: `Opened a chat with the ${str(e.agent) ?? "proposal"} agent, status ${str(e.status) ?? "open"}.`, facts: [] }),
  unw_send_chat_message: (e) => { const r = obj(e.reply); return { text: `Sent. Reply: “${clip(str(r.content) ?? "(none)", 120)}”`, facts: [] }; },
  unw_list_chat_messages: (e) => list(arr(e.items), "message", ["content"], "No messages."),
  unw_list_chat_sessions: (e) => list(arr(e.items), "chat", ["agent", "id"], "No chats."),
  unw_list_projects: (e) => list(arr(e.items), "project", ["title", "name"], "No projects yet. Accepted work will show up here."),
  unw_list_payment_terms: (e) => ({ text: `${plural(arr(e.items).length, "payment term")} on offer.`, facts: arr(e.items).map(obj).map((t) => `${str(t.label)}${t.isDefault ? " (default)" : ""}`) }),
  unw_list_invoices: (e) => list(arr(e.items), "invoice", ["number", "title"], "No invoices yet."),
};

/** The answer for one successful call: a sentence from the data plus short facts. */
export function describeResult(toolName: string, structured: unknown): Described {
  const outer = obj(structured);
  const raw = "entity" in outer ? outer.entity : structured;
  const entity = Array.isArray(raw) ? { items: raw } : obj(raw);
  const format = formatters[toolName];
  if (format) { try { return format(entity, raw); } catch { /* fall through to the generic answer */ } }
  const items = arr(entity.items);
  if (Array.isArray(raw) || "items" in entity) return items.length ? { text: `${plural(items.length, "item")}.`, facts: names(items, "title", "name", "label", "code") } : { text: "Nothing yet.", facts: [] };
  const label = str(entity.title) ?? str(entity.name) ?? str(entity.label);
  const state = str(entity.status) ?? str(entity.state);
  return { text: label ? `${label}${state ? `, ${human(state)}` : ""}.` : state ? `Status ${human(state)}.` : "Done.", facts: [] };
}

/** The answer for a refused call, from the server's message. */
export function describeRefusal(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (/disabled/i.test(m)) return "Refused: this tool is hidden from a client token.";
  if (/403|forbidden|scope|permission/i.test(m)) return `Refused: the client token lacks the scope. ${clip(m, 120)}`;
  if (/404|not found/i.test(m)) return `Refused: nothing to act on yet. ${clip(m, 120)}`;
  return m ? `Refused: ${clip(m, 160)}` : "Refused.";
}

/** One line for the live run's call row: the sentence and the first few facts. */
export function summaryLine(d: Described, maxFacts = 3): string {
  if (!d.facts.length) return d.text;
  const shown = d.facts.slice(0, maxFacts).join(" · ");
  const more = d.facts.length - maxFacts;
  return `${d.text} ${shown}${more > 0 ? ` · and ${more} more` : ""}`;
}
