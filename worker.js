const BEARER_TOKEN_KEY = "BEARER_TOKEN";
const CLAUDE_API_KEY_KEY = "CLAUDE_API_KEY";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_MAX_TOKENS = 4096;

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

function extractClaudeText(content) {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function buildMessageContent(prompt, images) {
  const content = [];

  if (typeof prompt === "string" && prompt) {
    content.push({
      type: "text",
      text: prompt,
    });
  }

  if (Array.isArray(images)) {
    for (const image of images) {
      if (!image || typeof image.data !== "string" || typeof image.media_type !== "string") {
        continue;
      }

      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.media_type,
          data: image.data,
        },
      });
    }
  }

  return content;
}

async function callClaude(env, payload) {
  const apiKey = await env.AI_CONSULTER_KV.get(CLAUDE_API_KEY_KEY);

  if (!apiKey) {
    return withCors(
      Response.json(
        { error: "Claude API key not found", key: CLAUDE_API_KEY_KEY },
        { status: 500 },
      ),
    );
  }

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "anthropic-version": CLAUDE_API_VERSION,
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    return withCors(
      Response.json(
        {
          error: "Claude API request failed",
          status: response.status,
          details: data,
        },
        { status: response.status },
      ),
    );
  }

  return withCors(
    Response.json({
      id: data.id,
      model: data.model,
      role: data.role,
      stop_reason: data.stop_reason,
      usage: data.usage,
      content: extractClaudeText(data.content),
      raw: data,
    }),
  );
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

    if (request.method === "POST" && url.pathname === "/claude") {
      if (!(await isAuthorized(request, env))) {
        return withCors(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }

      const { prompt, system, chat_name, model, max_tokens, images } = await request.json();

      if (prompt !== undefined && typeof prompt !== "string") {
        return withCors(
          Response.json(
            { error: "prompt must be a string when provided" },
            { status: 400 },
          ),
        );
      }

      const messageContent = buildMessageContent(prompt, images);

      if (!messageContent.length) {
        return withCors(
          Response.json(
            { error: "Request body must include prompt or images" },
            { status: 400 },
          ),
        );
      }

      const payload = {
        model: typeof model === "string" && model ? model : DEFAULT_MODEL,
        max_tokens: Number.isFinite(max_tokens) ? max_tokens : DEFAULT_MAX_TOKENS,
        messages: [
          {
            role: "user",
            content: messageContent,
          },
        ],
      };

      if ((typeof system === "string" && system) || (typeof chat_name === "string" && chat_name)) {
        const systemParts = [];

        if (typeof chat_name === "string" && chat_name) {
          systemParts.push(`chat_name: ${chat_name}`);
        }

        if (typeof system === "string" && system) {
          systemParts.push(system);
        }

        payload.system = [
          {
            type: "text",
            text: systemParts.join("\n\n"),
            cache_control: { type: "ephemeral" },
          },
        ];
      }

      return callClaude(env, payload);
    }

    return withCors(
      Response.json({
        message: "Cloudflare Worker KV demo",
        routes: {
          read: "GET /kv/:key",
          write: "POST /kv",
          claude: "POST /claude",
        },
      }),
    );
  },
};