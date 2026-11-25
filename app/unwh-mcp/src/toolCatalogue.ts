/** Tools that accept, sign, or move money. Everything else that writes is an edit. */
export const COMMIT_TOOLS: ReadonlySet<string> = new Set([
  "unw_accept_proposal",
  "unw_sign_contract",
  "unw_create_invoice",
  "unw_send_invoice",
  "unw_pay_invoice",
  "unw_charge_invoice",
  "unw_void_invoice",
  "unw_invoice_hours",
]);

export type ToolRisk = "read" | "edit" | "commit";

export function toolRisk(name: string, scope?: string): ToolRisk {
  if (COMMIT_TOOLS.has(name)) return "commit";
  if (!scope || scope.endsWith(":read")) return "read";
  return "edit";
}
