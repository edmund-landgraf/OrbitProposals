import { useEffect, useMemo, useState } from "react";
import "./proposalArchitecture.css";

type ToolSpec = {
  group: string;
  name: string;
  description: string;
  scope: string;
  operation: string;
  source: string;
};

type Inventory = {
  repository: string;
  count: number;
  tools: ToolSpec[];
};

const INVENTORY_URL = "/assets/proposal-arch/tools.json";
const DIAGRAM_URL = "/assets/proposal-arch/entities.svg";

export function ProposalArchitecturePage() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [operation, setOperation] = useState("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ Proposal: true, "Service & audit": true });

  useEffect(() => {
    const controller = new AbortController();
    fetch(INVENTORY_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Inventory unavailable");
        return response.json() as Promise<Inventory>;
      })
      .then((result) => {
        if (!Array.isArray(result.tools)) throw new Error("Invalid inventory");
        setInventory(result);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  const scopes = useMemo(() => {
    return Array.from(new Set(inventory?.tools.map((tool) => tool.scope) ?? [])).sort((a, b) => a.localeCompare(b));
  }, [inventory]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (inventory?.tools ?? []).filter((tool) =>
      (scope === "all" || tool.scope === scope) &&
      (operation === "all" || tool.operation === operation) &&
      (!term || [tool.name, tool.description, tool.group, tool.scope].some((value) => value.toLocaleLowerCase().includes(term))),
    );
  }, [inventory, search, scope, operation]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, ToolSpec[]>();
    filtered.forEach((tool) => byGroup.set(tool.group, [...(byGroup.get(tool.group) ?? []), tool]));
    return Array.from(byGroup.entries());
  }, [filtered]);

  function setAllGroups(open: boolean) {
    setExpanded(Object.fromEntries((inventory?.tools ?? []).map((tool) => [tool.group, open])));
  }

  return (
    <section className="proposal-architecture section route-section" aria-labelledby="proposal-architecture-title">
      <div className="container">
        <div className="proposal-architecture-hero">
          <div>
            <div className="eyebrow eyebrow-dark">UNWHELM / SYSTEM DESIGN</div>
            <h1 id="proposal-architecture-title">Proposal Architecture</h1>
            <p className="proposal-architecture-lead">From the client's AI assistant to a submitted proposal: the business objects, MCP tools, and enforced boundaries behind the workflow.</p>
            <div className="proposal-architecture-actions">
              <a className="button button-primary" href="/try">Watch the agent run</a>
              <a className="button button-secondary" href="/mcp">Explore the MCP server</a>
            </div>
          </div>
          <aside className="proposal-architecture-intro" aria-label="Architecture summary">
            <span className="proposal-architecture-kicker">THE WORKFLOW</span>
            <p>Agent → MCP server → API → Postgres</p>
            <span>The assistant gathers information and drafts; application rules determine access, pricing, review, and approval.</span>
          </aside>
        </div>

        <section className="proposal-architecture-block" aria-labelledby="proposal-entities-title">
          <div className="proposal-architecture-block-header">
            <div>
              <span className="proposal-architecture-kicker">01 / RELATIONSHIPS</span>
              <h2 id="proposal-entities-title">How the business objects connect</h2>
              <p>Organizations, proposals, reviews, contracts, billing, and projects are connected records. The illustration simplifies the key relationships; it is not a complete database schema.</p>
            </div>
            <a className="proposal-architecture-textlink" href={DIAGRAM_URL} target="_blank" rel="noopener noreferrer">Open full-size diagram ↗</a>
          </div>
          <a className="proposal-architecture-diagram" href={DIAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Open a full-size version of the proposal business entity relationship diagram">
            <img src={DIAGRAM_URL} alt="Entity relationship diagram linking an organization and proposal to proposal review, contract, invoices, project, and related records" />
          </a>
          <p className="proposal-architecture-annotation">An MCP tool is an operation on one or more objects; it is not necessarily a database table. The relationships above describe business data, while the explorer below describes what an agent can request.</p>
        </section>

        <section className="proposal-architecture-block" aria-labelledby="proposal-tools-title">
          <div className="proposal-architecture-block-header">
            <div>
              <span className="proposal-architecture-kicker">02 / OPERATIONS</span>
              <h2 id="proposal-tools-title">MCP tool explorer</h2>
              <p>Explore each registered tool by business area, its function, and the scope required to list or call it. Staff and admin tools also require the corresponding role, even when the token has the required scope. Every request is still subject to server-side authorization.</p>
            </div>
            {inventory && <span className="proposal-architecture-count">{inventory.count} registered tools</span>}
          </div>
          {loadError ? (
            <div className="proposal-architecture-empty" role="alert">The tool inventory could not be loaded. <a href={INVENTORY_URL}>Open the inventory JSON</a> instead.</div>
          ) : !inventory ? (
            <p role="status">Loading registered MCP tools…</p>
          ) : (
            <>
              <div className="proposal-architecture-toolbar">
                <label>
                  <span>Search tools</span>
                  <input type="search" placeholder="Tool name, function, or entity…" value={search} onChange={(event) => setSearch(event.target.value)} />
                </label>
                <label>
                  <span>Permission</span>
                  <select value={scope} onChange={(event) => setScope(event.target.value)}>
                    <option value="all">All permissions</option>
                    {scopes.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  <span>Operation</span>
                  <select value={operation} onChange={(event) => setOperation(event.target.value)}>
                    <option value="all">All operations</option>
                    {Array.from(new Set(inventory.tools.map((tool) => tool.operation))).sort().map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
              </div>
              <div className="proposal-architecture-results">
                <span role="status">{filtered.length} of {inventory.tools.length} tools shown</span>
                <div>
                  <button type="button" onClick={() => setAllGroups(true)}>Expand all</button>
                  <button type="button" onClick={() => setAllGroups(false)}>Collapse all</button>
                  {(search || scope !== "all" || operation !== "all") && (
                    <button type="button" onClick={() => { setSearch(""); setScope("all"); setOperation("all"); }}>Clear filters</button>
                  )}
                </div>
              </div>
              {groups.length === 0 ? <p className="proposal-architecture-empty">No tools match the current filters.</p> : (
                <div className="proposal-architecture-tool-groups">
                  {groups.map(([group, tools]) => {
                    const open = search.trim() || scope !== "all" || operation !== "all" ? expanded[group] !== false : !!expanded[group];
                    return (
                      <section className="proposal-architecture-tool-group" key={group}>
                        <h3>
                          <button type="button" aria-expanded={open} aria-controls={`proposal-tools-${group.replace(/[^a-z0-9]/gi, "-")}`} onClick={() => setExpanded((previous) => ({ ...previous, [group]: !open }))}>
                            <span className="proposal-architecture-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
                            {group}
                            <span className="proposal-architecture-group-count">{tools.length}</span>
                          </button>
                        </h3>
                        <div id={`proposal-tools-${group.replace(/[^a-z0-9]/gi, "-")}`} className="proposal-architecture-tool-list" hidden={!open}>
                          {tools.map((tool) => (
                            <article key={tool.name} className="proposal-architecture-tool">
                              <div className="proposal-architecture-tool-head">
                                <h4>{tool.name}</h4>
                                <div className="proposal-architecture-tool-tags">
                                  <span>{tool.operation}</span>
                                  <span>{tool.scope === "Not scope-gated in MCP listing" ? "Not scope-gated in listing" : tool.scope}</span>
                                </div>
                              </div>
                              <p>{tool.description}</p>
                            </article>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
              <div className="proposal-architecture-downloads">
                <a href={INVENTORY_URL} download>Download tool inventory JSON</a>
                <a href="/proposal-arch-tool-map.html" target="_blank" rel="noopener noreferrer">Open standalone explorer ↗</a>
              </div>
            </>
          )}
        </section>
        <p className="proposal-architecture-source">Source: UnwhelmNet20 — <code>unwh-mcp/src/createServer.ts</code>, <code>unwh-mcp/src/toolAccess.ts</code>, and <code>prisma/schema.prisma</code>. Inventory reflects the committed tool definitions, not a live caller's permissions.</p>
      </div>
    </section>
  );
}
