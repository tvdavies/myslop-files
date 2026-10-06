// Cloudflare Worker entry. Static assets (the game) are served by the assets
// binding; only /api/* reaches this code. Online rooms will live here.

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "cant-stop" });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
