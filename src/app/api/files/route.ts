import { extractText } from "@/lib/files";
import { getSettings } from "@/lib/bootstrap";
import { routeChain } from "@/lib/router";
import { chatCompletion } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * FILE ASSISTANT
 * Accepts a multipart upload (file + optional question), extracts the real text server-side, and
 * asks the routed LLM to answer/summarize over ONLY that text. The file is never stored. If no
 * LLM is configured, the extracted text is returned so nothing is faked.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data with a 'file' field" }, { status: 400 });
  }
  const file = form.get("file");
  const question = String(form.get("question") ?? "").trim() || "Summarize this document and list the key points.";
  if (!(file instanceof File)) return Response.json({ error: "no file uploaded" }, { status: 400 });
  if (file.size > 20_000_000) return Response.json({ error: "file too large (max 20 MB)" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ex = await extractText(file.name, file.type, bytes);
  if (!ex.ok) return Response.json({ error: ex.error }, { status: 422 });

  const st = await getSettings();
  const chain = await routeChain({ settings: st, message: question, historyChars: ex.text.length, systemPromptChars: 400 });
  const llm = chain.find((c) => c.tier !== "offline");
  if (!llm) {
    // No model configured — return the extracted text truthfully instead of a fake summary.
    return Response.json({
      answer: `I extracted ${ex.chars} characters from ${file.name} but no AI model is configured to summarize it. Add a provider key in Settings.\n\n${ex.text.slice(0, 2000)}`,
      extractedChars: ex.chars,
      kind: ex.kind,
      model: "none",
    });
  }

  try {
    const r = await chatCompletion({
      spec: llm.spec,
      apiKey: llm.apiKey,
      messages: [
        {
          role: "system",
          content:
            "You are given the extracted text of a document the user uploaded. Answer the user's request using ONLY this text. Be concise and accurate. If the answer isn't in the document, say so. Never invent facts, figures or quotes that aren't present.",
        },
        { role: "user", content: `DOCUMENT: ${file.name} (${ex.kind}, ${ex.chars} chars)\n\n---\n${ex.text}\n---\n\nREQUEST: ${question}` },
      ],
      temperature: 0.3,
      maxTokens: 800,
      timeoutMs: 45000,
    });
    return Response.json({ answer: r.content.trim() || "(the model returned nothing)", extractedChars: ex.chars, kind: ex.kind, model: llm.spec.model });
  } catch (e) {
    return Response.json({ error: `Model failed to process the document: ${e instanceof Error ? e.message : "unknown"}`, extractedChars: ex.chars }, { status: 502 });
  }
}
