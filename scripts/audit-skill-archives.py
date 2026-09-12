import hashlib
import io
import json
import re
import stat
import sys
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE = 12_000_000
MAX_EXPANDED = 30_000_000
PATTERNS = {
    "shell_or_process": r"\b(subprocess|os\.system|child_process|execSync|shell=True|curl\s|pip install|npm install|npx\s)",
    "dynamic_execution": r"\b(eval|exec)\s*\(",
    "external_service": r"https?://|API_KEY|access_token|oauth",
    "possible_credential": r"(?:sk-[a-zA-Z0-9]{24,}|ghp_[a-zA-Z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)",
    "renderer_dependency": r"\b(manim|ffmpeg|typst|playwright|chromium|openpyxl|remotion|GPU|CUDA)\b",
}


def inspect(blob, label, seen, budget=None, depth=0):
    budget = budget if budget is not None else {"bytes": 0, "entries": 0}
    if depth > 3:
        return {"archive": label, "files": [], "rejected": ["nested archive depth limit"]}
    report = {"archive": label, "sha256": hashlib.sha256(blob).hexdigest(), "files": [], "rejected": []}
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        entries = archive.infolist()
        budget["entries"] += len(entries)
        budget["bytes"] += sum(e.file_size for e in entries)
        if budget["entries"] > 500 or budget["bytes"] > MAX_EXPANDED:
            report["rejected"].append("archive expansion limit")
            return report
        names = set()
        for entry in entries:
            name = entry.filename
            path = PurePosixPath(name)
            if (path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name
                    or name in names or stat.S_ISLNK(entry.external_attr >> 16)
                    or entry.flag_bits & 1 or entry.file_size > 2_000_000
                    or entry.file_size / max(1, entry.compress_size) > 150):
                report["rejected"].append(name)
                continue
            names.add(name)
            if entry.is_dir():
                continue
            raw = archive.read(entry)
            digest = hashlib.sha256(raw).hexdigest()
            text = raw.decode("utf-8", errors="replace")
            findings = [key for key, pattern in PATTERNS.items() if re.search(pattern, text, re.I)]
            item = {"path": name, "bytes": len(raw), "sha256": digest, "findings": findings}
            if digest in seen:
                item["duplicate_of"] = seen[digest]
            else:
                seen[digest] = label + ":" + name
            if path.suffix == ".zip":
                item["nested"] = inspect(raw, label + ":" + name, seen, budget, depth + 1)
            if path.suffix in [".pyc", ".exe", ".dll", ".so"]:
                item["findings"].append("unreviewed_binary_do_not_execute")
            if path.name == "SKILL.md":
                match = re.search(r"^name:\s*(.+)$", text, re.M)
                item["skill"] = match.group(1).strip() if match else path.parent.name
                deps = re.findall(r"\b(?:manim|ffmpeg|typst|playwright|chromium|openpyxl|remotion|GPU|CUDA|Similarweb|DataForSEO)\b", text, re.I)
                item["dependencies_mentioned"] = sorted(set(deps))
            report["files"].append(item)
    return report


def main(urls):
    output = None
    if "--output" in urls:
        index = urls.index("--output")
        output = Path(urls[index + 1])
        urls = urls[:index] + urls[index + 2:]
    seen, reports = {}, []
    for url in urls:
        if not url.startswith("https://blobs.vusercontent.net/blob/"):
            raise ValueError("Only the supplied attachment host is accepted")
        with urllib.request.urlopen(url, timeout=30) as response:
            blob = response.read(MAX_ARCHIVE + 1)
        if len(blob) > MAX_ARCHIVE:
            raise ValueError("Compressed archive limit exceeded")
        reports.append(inspect(blob, url.rsplit("/", 1)[-1], seen))
    result = json.dumps({"method": "Static ZIP inspection; no extraction or execution. Heuristic findings require review, not a security guarantee.", "archives": reports}, indent=2)
    if output:
        output.write_text(result + "\n", encoding="utf-8")
        print(json.dumps({"report": str(output), "archives": len(reports), "top_level_files": sum(len(report["files"]) for report in reports)}))
    else:
        print(result)


if __name__ == "__main__":
    main(sys.argv[1:])
