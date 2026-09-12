const setupScript = `# Jarvish Windows Companion setup
$ErrorActionPreference = "Stop"
try {
$JarvishHome = Join-Path $env:USERPROFILE "Jarvish"
$ConfigDir = Join-Path $JarvishHome "config"
$ExistingConfig = Join-Path $ConfigDir "permissions.json"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
if (Test-Path $ExistingConfig) {
  Copy-Item $ExistingConfig (Join-Path $ConfigDir "permissions.backup.json") -Force
  Write-Host "Existing Jarvish settings found. Updating companion while preserving permissions."
} else {
  $config = @{
    version = "0.2.0"
    companion = "windows"
    permissions = @{ microphone = $false; files = $true; browser = $false; screen = $false }
    paired = $false
  } | ConvertTo-Json -Depth 4
  Set-Content -Path $ExistingConfig -Value $config -Encoding UTF8
}
Set-Content -Path (Join-Path $JarvishHome "COMPANION_VERSION") -Value "0.2.0" -Encoding UTF8
Start-Process "https://jarvish.vercel.app/cloud"
Write-Host "Jarvish companion updated at $JarvishHome"
Write-Host "Your config and permissions were preserved. Open Jarvish Cloud to finish secure pairing." -ForegroundColor Green
Write-Host "Setup completed successfully. This window will stay open so you can read the result."
} catch {
  Write-Host "Jarvish setup could not complete:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  Write-Host "If Windows blocked this script, run this once in PowerShell:" -ForegroundColor Yellow
  Write-Host "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" -ForegroundColor Cyan
}
Read-Host "Press Enter to close"
`;

export async function GET(request: Request) {
  const cloudUrl = new URL("/cloud", request.url).toString();
  const script = setupScript.replace("https://jarvish.vercel.app/cloud", cloudUrl);
  return new Response(script, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="jarvish-windows-setup.ps1"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
