import { expect, test } from "@playwright/test";

const clients = [
  {
    path: "/chatgpt",
    title: "Connect ChatGPT to Unwhelm — UnwhelmNet",
    h1: "Connect ChatGPT to Unwhelm.",
    diagram: "/assets/chatgpt-connect-diagram.svg",
    snippet: "Add custom MCP server",
  },
  {
    path: "/cursor",
    title: "Connect Cursor to Unwhelm — UnwhelmNet",
    h1: "Connect Cursor to Unwhelm.",
    diagram: "/assets/cursor-connect-diagram.svg",
    snippet: '"url": "https://mcp.unwhelm.net/mcp"',
  },
  {
    path: "/vscode",
    title: "Connect VS Code to Unwhelm — UnwhelmNet",
    h1: "Connect VS Code to Unwhelm.",
    diagram: "/assets/vscode-connect-diagram.svg",
    snippet: '"type": "http"',
  },
  {
    path: "/windsurf",
    title: "Connect Windsurf to Unwhelm — UnwhelmNet",
    h1: "Connect Windsurf to Unwhelm.",
    diagram: "/assets/windsurf-connect-diagram.svg",
    snippet: '"serverUrl": "https://mcp.unwhelm.net/mcp"',
  },
  {
    path: "/gemini-cli",
    title: "Connect Gemini CLI to Unwhelm — UnwhelmNet",
    h1: "Connect Gemini CLI to Unwhelm.",
    diagram: "/assets/gemini-cli-connect-diagram.svg",
    snippet: "gemini mcp add --transport http unwhelm https://mcp.unwhelm.net/mcp",
  },
  {
    path: "/codex",
    title: "Connect Codex to Unwhelm — UnwhelmNet",
    h1: "Connect Codex to Unwhelm.",
    diagram: "/assets/codex-connect-diagram.svg",
    snippet: "codex mcp login unwhelm",
  },
];

test("/connect hub compares each client and links to the dedicated guides", async ({ page }) => {
  await page.goto("/connect");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect an MCP client.");
  await expect(page).toHaveTitle("Connect an MCP client — UnwhelmNet");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText("Home");
  await expect(crumbs).toContainText("Connect");
  const main = page.locator("main");
  await expect(main.getByRole("button", { name: "Copy the Unwhelm MCP server URL" })).toBeVisible();
  for (const name of ["Claude", "ChatGPT", "Cursor", "VS Code", "Windsurf", "Gemini CLI", "Codex"]) {
    await expect(main.getByRole("heading", { level: 2, name })).toBeVisible();
    await expect(main.getByRole("link", { name: `Open the ${name} guide` })).toBeVisible();
  }
  await expect(main).toContainText("Setup method");
  await expect(main).toContainText("Config snippet");
  await expect(main).toContainText("Sign-in / OAuth");
  await expect(main).toContainText("Plans");
  await expect(main.getByRole("link", { name: "How to connect" }).first()).toHaveAttribute("href", "/mcp/connect");
  for (const name of ["Claude", "ChatGPT", "Cursor", "VS Code", "Windsurf", "Gemini CLI", "Codex"]) {
    await expect(main.getByRole("img", { name: `${name} logo` })).toBeVisible();
  }
  await expect(main).toContainText("Product names and logos are trademarks of their respective owners; used to identify compatible clients. No endorsement implied.");
});

test("footer and /demo link to the connect hub", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("link", { name: "connect hub" })).toHaveAttribute("href", "/connect");
  await expect(page.locator('footer a[href="/connect"]')).toHaveText("Connect");
});

for (const client of clients) {
  test(`${client.path}: title, diagram, URL copy, documented config, and hub link`, async ({ page }) => {
    await page.goto(client.path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(client.h1);
    await expect(page).toHaveTitle(client.title);
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs).toContainText("Connect");
    const logoName = client.h1.replace("Connect ", "").replace(" to Unwhelm.", "") + " logo";
    const logo = page.getByRole("img", { name: logoName });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("src", `/assets/logos/${client.path.slice(1)}.svg`);
    const diagram = page.getByRole("img", { name: /Four numbered steps/ });
    await expect(diagram).toHaveAttribute("src", client.diagram);
    await expect(diagram).toHaveAttribute("alt", /Four numbered steps/);
    await expect(page.getByRole("button", { name: "Copy the Unwhelm MCP server URL" })).toBeVisible();
    await expect(page.locator("main")).toContainText("https://mcp.unwhelm.net/mcp");
    await expect(page.locator("main")).toContainText(client.snippet);
    await expect(page.getByRole("button", { name: /Copy/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "connect hub" })).toHaveAttribute("href", "/connect");
    await expect(page.getByRole("link", { name: "Request access" }).first()).toHaveAttribute("href", "/request-access");
    await expect(page.getByRole("link", { name: "demo account" })).toHaveAttribute("href", "/demo");
  });
}
