const BEARER_TOKEN_KEY = "BEARER_TOKEN";

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function isAuthorized(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const bearerToken = await env.AI_CONSULTER_KV.get(BEARER_TOKEN_KEY);

  if (!bearerToken) {
    return false;
  }

  return authHeader === `Bearer ${bearerToken}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (request.method === "GET" && url.pathname.startsWith("/kv/")) {
      if (!(await isAuthorized(request, env))) {
        return withCors(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }

      const key = decodeURIComponent(url.pathname.replace("/kv/", ""));
      const value = await env.AI_CONSULTER_KV.get(key);

      if (value === null) {
        return withCors(
          Response.json({ error: "Key not found", key }, { status: 404 }),
        );
      }

      return withCors(Response.json({ key, value }));
    }

    if (request.method === "POST" && url.pathname === "/kv") {
      if (!(await isAuthorized(request, env))) {
        return withCors(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }

      const { key, value } = await request.json();

      if (!key || value === undefined) {
        return withCors(
          Response.json(
            { error: "Request body must include key and value" },
            { status: 400 },
          ),
        );
      }

      await env.AI_CONSULTER_KV.put(key, String(value));
      return withCors(Response.json({ ok: true, key, value: String(value) }));
    }

    return withCors(
      Response.json({
        message: "Cloudflare Worker KV demo",
        routes: {
          read: "GET /kv/:key",
          write: "POST /kv",
        },
      }),
    );
  },
};