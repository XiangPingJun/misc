const BEARER_TOKEN_KEY = "BEARER_TOKEN";
const OPENROUTER_API_KEY = "OPENROUTER_API_KEY";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 8192;

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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

function extractOpenRouterText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      if (typeof block?.text === "string") {
        return block.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isValidMessageContent(content) {
  return Array.isArray(content) && content.length > 0;
}

function isValidMessage(message) {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.role !== "user" && message.role !== "assistant") {
    return false;
  }

  return isValidMessageContent(message.content);
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

function buildSystemText(system, chatName) {
  const parts = [];

  if (typeof chatName === "string" && chatName) {
    parts.push(`chat_name: ${chatName}`);
  }

  if (typeof system === "string" && system) {
    parts.push(system);
  }

  if (!parts.length) {
    return null;
  }

  return parts.join("\n\n");
}

function toOpenRouterContent(content) {
  return content
    .map((block) => {
      if (block?.type === "text" && typeof block.text === "string") {
        return {
          type: "text",
          text: block.text,
        };
      }

      if (
        block?.type === "image"
        && block.source?.type === "base64"
        && typeof block.source.media_type === "string"
        && typeof block.source.data === "string"
      ) {
        return {
          type: "image_url",
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        };
      }

      return null;
    })
    .filter(Boolean);
}

function toOpenRouterMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: toOpenRouterContent(message.content),
  }));
}

async function callOpenRouter(env, payload) {
  const apiKey = await env.AI_CONSULTER_KV.get(OPENROUTER_API_KEY);

  if (!apiKey) {
    return withCors(
      Response.json(
        { error: "OpenRouter API key not found", key: OPENROUTER_API_KEY },
        { status: 500 },
      ),
    );
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  const message = data?.choices?.[0]?.message;

  if (!response.ok) {
    return withCors(
      Response.json(
        {
          error: "OpenRouter API request failed",
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
      model: data.model || payload.model,
      role: message?.role || "assistant",
      stop_reason: data.choices?.[0]?.finish_reason || null,
      usage: data.usage,
      content: extractOpenRouterText(message?.content),
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
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

    if (request.method === "DELETE" && url.pathname.startsWith("/kv/")) {
      if (!(await isAuthorized(request, env))) {
        return withCors(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }

      const key = decodeURIComponent(url.pathname.replace("/kv/", ""));
      await env.AI_CONSULTER_KV.delete(key);
      return withCors(Response.json({ ok: true, key }));
    }

    if (request.method === "POST" && url.pathname === "/openrouter") {
      if (!(await isAuthorized(request, env))) {
        return withCors(
          Response.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }

      const { prompt, system, chat_name, model, images, messages } = await request.json();

      if (prompt !== undefined && typeof prompt !== "string") {
        return withCors(
          Response.json(
            { error: "prompt must be a string when provided" },
            { status: 400 },
          ),
        );
      }

      if (typeof model !== "string" || !model.trim()) {
        return withCors(
          Response.json(
            { error: "model must be a non-empty string" },
            { status: 400 },
          ),
        );
      }

      let requestMessages = [];

      if (Array.isArray(messages) && messages.length) {
        if (!messages.every(isValidMessage)) {
          return withCors(
            Response.json(
              { error: "messages must be an array of user/assistant messages with content blocks" },
              { status: 400 },
            ),
          );
        }

        requestMessages = messages;
      } else {
        const messageContent = buildMessageContent(prompt, images);

        if (!messageContent.length) {
          return withCors(
            Response.json(
              { error: "Request body must include messages or prompt/images" },
              { status: 400 },
            ),
          );
        }

        requestMessages.push({
          role: "user",
          content: messageContent,
        });
      }

      const systemText = buildSystemText(system, chat_name);
      const payloadMessages = toOpenRouterMessages(requestMessages);

      if (systemText) {
        payloadMessages.unshift({
          role: "system",
          content: [
            {
              type: "text",
              text: systemText,
            },
          ],
        });
      }

      const payload = {
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: payloadMessages,
      };

      return callOpenRouter(env, payload);
    }

    return withCors(
      Response.json({
        message: "Cloudflare Worker KV demo",
        routes: {
          read: "GET /kv/:key",
          write: "POST /kv",
          delete: "DELETE /kv/:key",
          openrouter: "POST /openrouter",
        },
      }),
    );
  },
};