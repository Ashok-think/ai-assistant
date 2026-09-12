import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";

export type ArtifactInput = { title: string; format: "md" | "txt" | "xlsx" | "pdf"; content: string };

export function validateArtifact(value: unknown): ArtifactInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a document object.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["title", "format", "content"].includes(key))) throw new Error("Unknown document field.");
  if (typeof data.title !== "string" || !data.title.trim() || data.title.length > 100 || /[\r\n\x00]/.test(data.title)) throw new Error("Use a title of 1–100 characters without line breaks.");
  if (!["md", "txt", "xlsx", "pdf"].includes(String(data.format))) throw new Error("Supported formats: Markdown, text, XLSX and PDF.");
  if (typeof data.content !== "string" || !data.content.trim() || data.content.length > 20000) throw new Error("Content must contain 1–20,000 characters.");
  return { title: data.title.trim(), format: data.format as ArtifactInput["format"], content: data.content };
}

export async function exportArtifact(value: unknown) {
  const data = validateArtifact(value);
  const basename = data.title.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "document";
  let bytes: Uint8Array;
  let mime: string;
  if (data.format === "xlsx") {
    let rows: unknown;
    try { rows = JSON.parse(data.content); } catch { throw new Error("XLSX content must be a JSON array of rows, with the first row as headers."); }
    if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw new Error("Supply 1–200 spreadsheet rows.");
    const width = Array.isArray(rows[0]) ? rows[0].length : 0;
    if (!width || width > 30 || rows.some((row) => !Array.isArray(row) || row.length !== width || row.some((cell: unknown) => !["string", "number", "boolean"].includes(typeof cell) || (typeof cell === "number" && !Number.isFinite(cell))))) throw new Error("Rows must have equal width (1–30 columns), using only text, numbers and booleans. Formulas and objects are not accepted.");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length, column: width } };
    sheet.columns.forEach((column) => { column.width = 24; });
    bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else if (data.format === "pdf") {
    const pdf = await PDFDocument.create();
    pdf.setTitle(data.title);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const content = `${data.title}\n\n${data.content}`.replace(/\t/g, "    ").replace(/\r\n?/g, "\n");
    try { font.encodeText(content.replace(/\n/g, "")); } catch { throw new Error("This PDF renderer cannot represent one or more characters. Download Markdown or text to preserve them; no characters were silently removed."); }
    let page = pdf.addPage([595, 842]), y = 794;
    const line = (text: string) => {
      if (y < 48) { page = pdf.addPage([595, 842]); y = 794; }
      page.drawText(text, { x: 48, y, font, size: 11 }); y -= 16;
    };
    for (const paragraph of content.split("\n")) {
      let buffer = "";
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(buffer + char, 11) > 499) { line(buffer); buffer = ""; }
        buffer += char;
      }
      line(buffer);
    }
    bytes = await pdf.save();
    mime = "application/pdf";
  } else {
    bytes = new TextEncoder().encode(data.content);
    mime = data.format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8";
  }
  return { bytes, mime, filename: `${basename}.${data.format}`, sha256: createHash("sha256").update(bytes).digest("hex") };
}
