export async function GET() {
  console.log("✅ Cron job executed");

  return Response.json({
    success: true,
    message: "Cron ran successfully"
  });
}