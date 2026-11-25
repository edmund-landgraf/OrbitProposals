import { crc32 as crcTable } from "node:zlib";

export type RedlinePart = { kind: "same" | "del" | "ins"; text: string };

/** Word-level diff. Shared words stay; removals and additions become tracked changes. */
export function redlineParts(before: string, after: string): RedlinePart[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const parts: RedlinePart[] = [];
  const push = (kind: RedlinePart["kind"], text: string) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push("same", a[i]!); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { push("del", a[i]!); i++; }
    else { push("ins", b[j]!); j++; }
  }
  while (i < a.length) push("del", a[i++]!);
  while (j < b.length) push("ins", b[j++]!);
  return parts;
}

function xml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function documentXml(parts: readonly RedlinePart[], author: string, when: string) {
  let id = 1;
  const runs = parts.map((part) => {
    const mark = `w:id="${id++}" w:author="${xml(author)}" w:date="${when}"`;
    if (part.kind === "del") return `<w:del ${mark}><w:r><w:delText xml:space="preserve">${xml(part.text)}</w:delText></w:r></w:del>`;
    if (part.kind === "ins") return `<w:ins ${mark}><w:r><w:t xml:space="preserve">${xml(part.text)}</w:t></w:r></w:ins>`;
    return `<w:r><w:t xml:space="preserve">${xml(part.text)}</w:t></w:r>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${runs}</w:p></w:body></w:document>`;
}

function storedZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = crcTable(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, data);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** A .docx whose body is the tracked-change diff of two proposal texts. */
export function redlineDocx(before: string, after: string, options: { author?: string; when?: string } = {}): Buffer {
  const when = options.when ?? new Date().toISOString();
  const author = options.author ?? "Unwhelm";
  return storedZip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`,
    "word/settings.xml": `<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>`,
    "word/document.xml": documentXml(redlineParts(before, after), author, when),
  });
}

/** Plain text of a proposal snapshot for the redline. */
export function snapshotText(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object") return "";
  const row = snapshot as Record<string, unknown>;
  const scope = row.scope && typeof row.scope === "object" ? row.scope as Record<string, unknown> : {};
  const deliverables = Array.isArray(scope.deliverables) ? scope.deliverables.filter((item) => typeof item === "string").join(", ") : "";
  const pricing = row.pricing && typeof row.pricing === "object" ? row.pricing as Record<string, unknown> : {};
  return [`Title: ${typeof row.title === "string" ? row.title : ""}`, `Summary: ${typeof scope.summary === "string" ? scope.summary : ""}`, `Deliverables: ${deliverables}`, `Price minor: ${typeof pricing.amountMinor === "number" ? pricing.amountMinor : ""}`].join("\n");
}
