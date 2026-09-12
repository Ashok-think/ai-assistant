const setupScript = `# Jarvish Windows Companion setup
$ErrorActionPreference = "Stop"
$JarvishHome = Join-Path $env:USERPROFILE "Jarvish"
$ConfigDir = Join-Path $JarvishHome "config"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$config = @{
  version = "0.1.0"
  companion = "windows"
  permissions = @{
    microphone = $false
    files = $true
    browser = $false
    screen = $false
  }
  paired = $false
} | ConvertTo-Json -Depth 4
Set-Content -Path (Join-Path $ConfigDir "permissions.json") -Value $config -Encoding UTF8
Start-Process "https://jarvish.vercel.app/cloud"
Write-Host "Jarvish folder created at $JarvishHome"
Write-Host "Open Jarvish Cloud to finish secure pairing. No device permissions were granted automatically."
Read-Host "Press Enter to close"
`;

export async function GET(request: Request) {
  const cloudUrl = new URL("/cloud", request.url).toString();
  const script = setupScript.replace("https://jarvish.vercel.app/cloud", cloudUrl);
  return new Response(script, {
    headers: {
      "Content-Type": "application/octet-stream; charset=utf-8",
      "Content-Disposition": 'attachment; filename="jarvish-windows-setup.ps1"',
      "Cache-Control": "no-store",
    },
  });
}
