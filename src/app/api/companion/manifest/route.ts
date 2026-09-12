export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return Response.json({
    product: "Jarvish Windows Companion",
    channel: "stable",
    version: "0.2.0",
    minimumWindows: "10",
    downloadUrl: `${origin}/api/companion/download`,
    releaseNotes: [
      "Creates a private Jarvish folder and permission configuration.",
      "Preserves existing settings during updates.",
      "Opens the cloud pairing flow after setup.",
    ],
    updatePolicy: "user-approved",
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
