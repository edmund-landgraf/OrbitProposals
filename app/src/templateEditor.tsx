import { useEffect, useState, type FormEvent } from "react";

// Staff editor for proposal templates. Every value here is a database row; options never carry a price.
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Rule = { code: string; nodeKey: string; check: string; fieldPath: string | null; minChars: number | null; minItems: number | null; pattern: string | null; severity: string; weight: number; message: string; suggestion: string; active: boolean };
type Template = {
  code: string; name: string; description: string; active: boolean; suggestedPricingModel: string | null;
  nodes: { nodeKey: string; parentKey: string | null; node: { title: string } }[];
  samples: { nodeKey: string; content: unknown }[];
  options: { code: string; label: string; description: string }[];
  reviewRules: Rule[];
  _count: { proposals: number };
};
type Part = { key: string; title: string; kind: string; inLibrary: boolean };
type Editor = { templates: Template[]; parts: Part[]; pricingModels: string[] };

const base = "/api/v1/staff/proposal-templates";
const CHECKS = ["missing", "min_chars", "min_items", "pattern", "state_open"];

export function TemplateEditor({ api, onError }: { api: Api; onError: (reason: unknown) => void }) {
  const [data, setData] = useState<Editor | null>(null);
  const [selected, setSelected] = useState("");
  const [sampleKey, setSampleKey] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [saved, setSaved] = useState("");

  async function load(keep = selected) {
    const next = await api<Editor>(base);
    setData(next);
    setSelected(keep && next.templates.some((t) => t.code === keep) ? keep : next.templates[0]?.code ?? "");
  }
  useEffect(() => { void load().catch(onError); }, []);

  const template = data?.templates.find((t) => t.code === selected);
  async function send(path: string, method: string, body?: unknown, note = "Saved.") {
    try {
      await api(`${base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      setSaved(note);
      await load(selected);
    } catch (reason) { setSaved(""); onError(reason); }
  }

  if (!data) return <div role="tabpanel"><p>Loading templates…</p></div>;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code"));
    const copyFrom = String(form.get("copyFrom") || "");
    try {
      await api(base, { method: "POST", body: JSON.stringify({ code, name: form.get("name"), ...(copyFrom ? { copyFrom } : {}) }) });
      event.currentTarget.reset();
      await load(code);
    } catch (reason) { onError(reason); }
  }

  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const model = String(form.get("suggestedPricingModel") || "");
    void send(`/${selected}`, "PATCH", { name: form.get("name"), description: form.get("description"), active: form.get("active") === "on", suggestedPricingModel: model || null });
  }

  function toggleNode(key: string, on: boolean) {
    if (!template) return;
    const keys = template.nodes.map((n) => n.nodeKey);
    const nextKeys = on ? [...keys, key] : keys.filter((k) => k !== key);
    const parents = new Map(template.nodes.map((n) => [n.nodeKey, n.parentKey]));
    void send(`/${selected}/nodes`, "PUT", { nodes: nextKeys.map((nodeKey) => ({ nodeKey, parentKey: parents.get(nodeKey) && nextKeys.includes(parents.get(nodeKey)!) ? parents.get(nodeKey) : null })) });
  }

  function chooseSample(key: string) {
    setSampleKey(key);
    const sample = template?.samples.find((s) => s.nodeKey === key);
    setSampleText(sample ? JSON.stringify(sample.content, null, 2) : '{\n  "text": ""\n}');
  }
  function saveSample() {
    let content: unknown;
    try { content = JSON.parse(sampleText); } catch { onError(new Error("The sample must be valid JSON.")); return; }
    void send(`/${selected}/samples/${sampleKey}`, "PUT", { content });
  }

  function saveOptions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lines = String(new FormData(event.currentTarget).get("options") || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const options = lines.map((line) => { const [code, label, ...rest] = line.split("|").map((p) => p.trim()); return { code, label, description: rest.join(" | ") }; });
    void send(`/${selected}/options`, "PUT", { options });
  }

  function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const num = (name: string) => (form.get(name) ? Number(form.get(name)) : null);
    void send(`/${selected}/rules`, "POST", {
      code: form.get("code"), nodeKey: form.get("nodeKey"), check: form.get("check"), fieldPath: form.get("fieldPath") || null,
      minChars: num("minChars"), minItems: num("minItems"), pattern: form.get("pattern") || null,
      severity: form.get("severity"), weight: Number(form.get("weight") || 10), message: form.get("message"), suggestion: form.get("suggestion"),
    }, "Rule added.");
  }

  return (
    <div className="portal-grid" role="tabpanel">
      <div>
        <h2>Proposal templates</h2>
        <table className="admin-table">
          <thead><tr><th>Template</th><th>Parts</th><th>Status</th></tr></thead>
          <tbody>
            {data.templates.map((t) => (
              <tr key={t.code} className={t.code === selected ? "active" : ""}>
                <td><button type="button" onClick={() => { setSelected(t.code); setSampleKey(""); setSaved(""); }}>{t.name}</button> <code>{t.code}</code></td>
                <td>{t.nodes.length}</td>
                <td>{t.active ? "Active" : "Hidden"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>New template</h3>
        <form className="admin-form" onSubmit={create}>
          <label>Code <input name="code" required pattern="[a-z][a-z0-9_]{1,62}" /></label>
          <label>Name <input name="name" required maxLength={200} /></label>
          <label>Copy from
            <select name="copyFrom" defaultValue=""><option value="">Start empty</option>{data.templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
          </label>
          <button type="submit">Create (starts hidden)</button>
        </form>
      </div>

      {template && (
        <div>
          <h2>{template.name}</h2>
          <p>{template._count.proposals} proposals use this template. Changes apply to new proposals; existing ones keep their parts.</p>
          {saved && <p role="status">{saved}</p>}
          <form key={`d-${template.code}`} className="admin-form" onSubmit={saveDetails}>
            <label>Name <input name="name" defaultValue={template.name} required /></label>
            <label>Description <textarea name="description" defaultValue={template.description} rows={3} /></label>
            <label>Suggested pricing model
              <select name="suggestedPricingModel" defaultValue={template.suggestedPricingModel ?? ""}>
                <option value="">None</option>{data.pricingModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label><input type="checkbox" name="active" defaultChecked={template.active} /> Active (clients and the agent can pick it)</label>
            <button type="submit">Save details</button>
          </form>

          <h3>Parts</h3>
          <ul className="admin-checklist">
            {data.parts.map((p) => {
              const on = template.nodes.some((n) => n.nodeKey === p.key);
              return (
                <li key={p.key}>
                  <label><input type="checkbox" checked={on} onChange={(e) => toggleNode(p.key, e.target.checked)} /> {p.title} <code>{p.key}</code>{p.inLibrary ? " (library)" : ""}</label>
                  {on && <button type="button" onClick={() => chooseSample(p.key)}>{template.samples.some((s) => s.nodeKey === p.key) ? "Edit sample" : "Add sample"}</button>}
                </li>
              );
            })}
          </ul>
          {sampleKey && (
            <div>
              <h3>Sample for <code>{sampleKey}</code></h3>
              <p>Narrative parts use {"{ \"text\": \"...\" }"}. Never put hours or price in a sample.</p>
              <textarea value={sampleText} onChange={(e) => setSampleText(e.target.value)} rows={10} style={{ width: "100%", fontFamily: "monospace" }} />
              <button type="button" onClick={saveSample}>Save sample</button>
              <button type="button" onClick={() => { void send(`/${selected}/samples/${sampleKey}`, "DELETE", undefined, "Sample removed."); setSampleKey(""); }}>Remove sample</button>
            </div>
          )}

          <h3>Options</h3>
          <form key={`o-${template.code}`} className="admin-form" onSubmit={saveOptions}>
            <label>One per line as code | label | description (no prices)
              <textarea name="options" rows={4} defaultValue={template.options.map((o) => `${o.code} | ${o.label} | ${o.description}`).join("\n")} />
            </label>
            <button type="submit">Save options</button>
          </form>

          <h3>Review rules for this template</h3>
          <table className="admin-table">
            <thead><tr><th>Rule</th><th>Part</th><th>Check</th><th>Severity</th><th /></tr></thead>
            <tbody>
              {template.reviewRules.map((r) => (
                <tr key={r.code}>
                  <td><code>{r.code}</code><br />{r.message}</td>
                  <td>{r.nodeKey}{r.fieldPath ? ` (${r.fieldPath})` : ""}</td>
                  <td>{r.check}{r.minChars ? ` ≥${r.minChars} chars` : ""}{r.minItems ? ` ≥${r.minItems} items` : ""}{r.pattern ? ` /${r.pattern}/` : ""}</td>
                  <td>{r.severity} · {r.weight}</td>
                  <td>
                    <button type="button" onClick={() => void send(`/${selected}/rules/${r.code}`, "PATCH", { active: !r.active })}>{r.active ? "Turn off" : "Turn on"}</button>
                    <button type="button" onClick={() => void send(`/${selected}/rules/${r.code}`, "DELETE", undefined, "Rule removed.")}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form key={`r-${template.code}`} className="admin-form" onSubmit={addRule}>
            <label>Code <input name="code" required pattern="[a-z][a-z0-9_]{1,62}" /></label>
            <label>Part <select name="nodeKey">{template.nodes.map((n) => <option key={n.nodeKey} value={n.nodeKey}>{n.node.title}</option>)}</select></label>
            <label>Check <select name="check">{CHECKS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label>Field (scope, timeline, pricing, or blank for the part text) <input name="fieldPath" /></label>
            <label>Min characters <input name="minChars" type="number" min={1} /></label>
            <label>Min items <input name="minItems" type="number" min={1} /></label>
            <label>Pattern (fails when it matches) <input name="pattern" /></label>
            <label>Severity <select name="severity"><option>issue</option><option>suggestion</option></select></label>
            <label>Weight <input name="weight" type="number" min={0} max={100} defaultValue={10} /></label>
            <label>Message <input name="message" required /></label>
            <label>Suggestion <input name="suggestion" required /></label>
            <button type="submit">Add rule</button>
          </form>
        </div>
      )}
    </div>
  );
}
