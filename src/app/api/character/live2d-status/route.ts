import "server-only";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Detects whether a real Live2D model has been placed in public/character/live2d.
 * Returns the model3.json path (served statically) so the renderer can load it, or a clear
 * "rig required" signal when no model exists. We NEVER invent a model — this only reports what
 * actually exists on disk.
 */
const DIR = path.join(process.cwd(), "public", "character", "live2d");

async function findModelJson(dir: string, depth = 0): Promise<string | null> {
  if (depth > 3) return null;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null; // folder doesn't exist yet
  }
  // Prefer a *.model3.json at this level.
  const model = entries.find((e) => e.toLowerCase().endsWith(".model3.json"));
  if (model) return path.join(dir, model);
  // Otherwise recurse into subfolders.
  for (const e of entries) {
    const full = path.join(dir, e);
    try {
      if ((await stat(full)).isDirectory()) {
        const found = await findModelJson(full, depth + 1);
        if (found) return found;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function GET() {
  const found = await findModelJson(DIR);
  if (!found) {
    return Response.json({
      present: false,
      modelUrl: null,
      message:
        "No Live2D model found. Place a rigged model at public/character/live2d/<name>.model3.json (+ .moc3, textures/, physics3.json). The app will auto-detect it.",
    });
  }
  // Convert the absolute path to a public URL under /character/live2d/...
  const rel = found.split(path.join("public") + path.sep)[1]?.split(path.sep).join("/");
  return Response.json({ present: true, modelUrl: `/${rel}`, message: "Live2D model detected." });
}
