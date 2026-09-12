import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { exportArtifact, validateArtifact } from "../src/lib/artifact-export.ts";

const input = { title: "Research brief", content: "Verified content", format: "md" };

test("exports exact UTF-8 text with a reproducible checksum and safe filename", async () => {
  const artifact = await exportArtifact({ ...input, title: "../../Résumé", content: "Hindi: नमस्ते" });
  assert.equal(new TextDecoder().decode(artifact.bytes), "Hindi: नमस्ते");
  assert.equal(artifact.filename, "Re-sume.md");
  assert.equal(artifact.sha256, createHash("sha256").update(artifact.bytes).digest("hex"));
});

test("rejects unknown fields, excessive content and unsupported executable formats", () => {
  for (const value of [null, { ...input, path: "/etc/passwd" }, { ...input, content: "x".repeat(20001) }, { ...input, format: "html" }, { ...input, title: "bad\nheader" }]) assert.throws(() => validateArtifact(value));
});

test("XLSX parses back as real rows and formula-looking text stays literal", async () => {
  const rows = [["Name", "Value"], ["Milk", 3], ["Formula", "=HYPERLINK(\"https://example.com\")"]];
  const artifact = await exportArtifact({ ...input, format: "xlsx", content: JSON.stringify(rows) });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(artifact.bytes));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("B2").value, 3);
  assert.equal(sheet.getCell("B3").value, rows[2][1]);
  assert.equal(sheet.getCell("B3").formula, undefined);
  assert.equal(sheet.views[0].ySplit, 1);
});

test("spreadsheet objects, ragged rows and excessive rows are rejected", async () => {
  for (const rows of [[["a"], [{ formula: "1+1" }]], [["a"], [1, 2]], Array.from({ length: 201 }, () => ["a"])]) await assert.rejects(exportArtifact({ ...input, format: "xlsx", content: JSON.stringify(rows) }));
});

test("PDF has a real header and readable page tree", async () => {
  const artifact = await exportArtifact({ ...input, format: "pdf", content: "Long line ".repeat(500) });
  assert.equal(Buffer.from(artifact.bytes).subarray(0, 5).toString(), "%PDF-");
  const pdf = await PDFDocument.load(artifact.bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), input.title);
});

test("PDF rejects unsupported characters without silently dropping text", async () => {
  await assert.rejects(exportArtifact({ ...input, format: "pdf", content: "नमस्ते" }), /Markdown or text/);
});
