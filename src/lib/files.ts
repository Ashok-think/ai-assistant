import "server-only";

/**
 * FILE TEXT EXTRACTION
 * --------------------
 * Real, server-side extraction of readable text from uploaded documents. No fabrication: if a
 * format can't be parsed we return an error the assistant reports honestly.
 *
 *  - PDF  → pdf-parse (text layer; scanned/image PDFs yield little text — we say so)
 *  - DOCX → mammoth (raw text)
 *  - TXT / MD / CSV / JSON → decoded directly
 *
 * Parsers are dynamically imported so they never bloat the client bundle and a missing optional
 * dep degrades to a clear message instead of crashing the app.
 */

export type ExtractResult = { ok: true; text: string; kind: string; chars: number } | { ok: false; error: string };

const MAX_CHARS = 60_000; // plenty for a summary; keeps token cost sane.

export async function extractText(filename: string, mime: string, bytes: Uint8Array): Promise<ExtractResult> {
  const name = filename.toLowerCase();
  const ext = name.slice(name.lastIndexOf(".") + 1);

  try {
    if (ext === "pdf" || mime === "application/pdf") {
      // pdf-parse v2 exposes a PDFParse class with getText().
      const { PDFParse } = (await import("pdf-parse")) as unknown as {
        PDFParse: new (opts: { data: Uint8Array }) => { getText: () => Promise<{ text: string }> };
      };
      const parser = new PDFParse({ data: bytes });
      const out = await parser.getText();
      const text = (out.text || "").trim();
      if (!text) return { ok: false, error: "That PDF has no extractable text (it may be scanned images). I can read it as an image if you screenshot a page." };
      return { ok: true, text: text.slice(0, MAX_CHARS), kind: "pdf", chars: text.length };
    }
    if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      const text = (out.value || "").trim();
      if (!text) return { ok: false, error: "That DOCX appears to be empty." };
      return { ok: true, text: text.slice(0, MAX_CHARS), kind: "docx", chars: text.length };
    }
    if (["txt", "md", "csv", "json", "log", "tsv"].includes(ext) || mime.startsWith("text/")) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
      if (!text) return { ok: false, error: "That file is empty." };
      return { ok: true, text: text.slice(0, MAX_CHARS), kind: ext || "text", chars: text.length };
    }
    return { ok: false, error: `I can't read ".${ext}" files yet. I support PDF, DOCX, TXT, MD, CSV and JSON.` };
  } catch (e) {
    return { ok: false, error: `Failed to parse ${filename}: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}
