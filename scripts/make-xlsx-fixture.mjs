// Builds a realistic .xlsx fixture — cells + cell-anchored images — so the
// roster import can be tested without shipping a binary into the repo.
// Run:  node scripts/make-xlsx-fixture.mjs <out.xlsx>

import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

function makeZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8"), raw = Buffer.from(e.data);
    const comp = zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// a 1x1 PNG in each colour we need
function png(r, g, b) {
  const sig = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.concat([
    Buffer.from("0000000d4948445200000001000000010806000000", "hex"),
    Buffer.from("1f15c489", "hex"),
  ]);
  const raw = Buffer.from([0x00, r, g, b, 0xff]);
  const idat = zlib.deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  return Buffer.concat([sig, chunk("IHDR", ihdr.slice(4)), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
let T = null;
function crc32(buf) {
  if (!T) { T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; } }
  let c = 0xffffffff;
  for (const b of buf) c = T[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const ROSTER = [
  ["photo", "name", "gamer_id", "pot"],
  [null, "Arjun", "ARJUN01", 1],
  [null, "Bhavya", "BHAVYA02", 1],
  [null, "Chirag", "CHIRAG03", 1],
  [null, "Divya", "DIVYA04", 1],
  [null, "Esha", "ESHA05", 1],
  [null, "Farah", "FARAH06", 1],
  [null, "Gaurav", "GAURAV07", 1],
  [null, "Hina", "HINA08", 1],
];

const strings = [];
const sIdx = new Map();
const sid = (s) => {
  if (sIdx.has(s)) return sIdx.get(s);
  strings.push(s);
  sIdx.set(s, strings.length - 1);
  return sIdx.get(s);
};

let sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>`;
ROSTER.forEach((row, r) => {
  const cells = row.map((v, c) => {
    const ref = String.fromCharCode(65 + c) + (r + 1);
    if (v === null) return "";                          // cell holds an image, no text
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="s"><v>${sid(String(v))}</v></c>`;
  }).join("");
  sheet += `<row r="${r + 1}">${cells}</row>`;
});
sheet += `</sheetData><drawing r:id="rId1"/></worksheet>`;

// one image per data row, anchored in the photo column (col A = 0, row = r+1)
const colours = [[234,88,12],[34,197,94],[234,179,8],[59,130,246],[236,72,153],[20,184,166],[249,115,22],[168,85,247]];
const media = [], rels = [], drawingAnchors = [];
ROSTER.slice(1).forEach((_, i) => {
  const n = i + 1;
  const [r, g, b] = colours[i % colours.length];
  media.push({ name: `xl/media/image${n}.png`, data: png(r, g, b) });
  rels.push(`<Relationship Id="rIdImg${n}" Target="../media/image${n}.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"/>`);
  drawingAnchors.push(
    `<xdr:twoCellAnchor editAs="oneCell">` +
    `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${i + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${i + 2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${n + 1}" name="Image ${n}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImg${n}"/></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`
  );
});

const drawing = `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">${drawingAnchors.join("")}</xdr:wsDr>`;
const sst = `<?xml version="1.0"?><sst count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`;

const out = process.argv[2] || "scripts/fixtures/roster.xlsx";
const zip = makeZip([
  { name: "[Content_Types].xml", data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>` },
  { name: "_rels/.rels", data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
  { name: "xl/workbook.xml", data: `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Players" sheetId="1" r:id="rIdWb"/></sheets></workbook>` },
  { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWb" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
  { name: "xl/worksheets/sheet1.xml", data: sheet },
  { name: "xl/worksheets/_rels/sheet1.xml.rels", data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>` },
  { name: "xl/drawings/drawing1.xml", data: drawing },
  { name: "xl/drawings/_rels/drawing1.xml.rels", data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>` },
  { name: "xl/sharedStrings.xml", data: sst },
  ...media,
]);

writeFileSync(out, zip);
console.log(`wrote ${out} — ${ROSTER.length - 1} players, ${media.length} cell-anchored images, ${zip.length} bytes`);
