"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export default function DownloadClient() {
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState("");

  async function downloadSetup() {
    setDownloading(true);
    setNotice("");
    try {
      const response = await fetch("/api/companion/download", { cache: "no-store" });
      if (!response.ok) throw new Error("download-failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "jarvish-windows-setup.ps1";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice("Downloaded. Open Downloads and run the file with PowerShell.");
    } catch {
      setNotice("The download could not start. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  }

  return <div className="flex flex-col gap-2"><button type="button" onClick={downloadSetup} disabled={downloading} className="btn btn-primary"><Download size={17} /> {downloading ? "Preparing download…" : "Download for Windows"}</button>{notice && <p role="status" className="text-xs text-primary">{notice}</p>}</div>;
}
