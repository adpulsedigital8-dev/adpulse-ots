// Vercel serverless function: the Site Agent's "Scan photo with AI".
// Keeps the Anthropic API key on the server and only lets signed-in team members (role = admin) use it.
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY       your Anthropic API key
//   ANTHROPIC_MODEL         optional, defaults to claude-sonnet-5
//   SUPABASE_URL            same as in config.js
//   SUPABASE_ANON_KEY       same as in config.js
export const config = { maxDuration: 60 };

async function teamMember(token) {
  if (!token) return false;
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  const u = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
  if (!u.ok) return false;
  const r = await fetch(`${base}/rest/v1/rpc/is_admin`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
  return r.ok && (await r.json()) === true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "invalid_request", message: "POST only" });
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try {
    if (!(await teamMember(token))) return res.status(403).json({ code: "not_granted", message: "Only team members can run AI scans." });
  } catch (e) {
    return res.status(502).json({ code: "upstream_error", message: "Couldn't check your account." });
  }
  const { prompt, images = [] } = req.body || {};
  if (!prompt || typeof prompt !== "string" || prompt.length > 65536) return res.status(400).json({ code: "invalid_request", message: "Missing or oversized prompt." });
  if (!Array.isArray(images) || images.length > 2) return res.status(400).json({ code: "image_rejected", message: "Send at most 2 images." });

  const content = [
    ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType || "image/jpeg", data: i.data } })),
    { type: "text", text: prompt },
  ];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5", max_tokens: 1500, messages: [{ role: "user", content }] }),
    });
    const j = await r.json();
    if (!r.ok) {
      const code = r.status === 429 ? "rate_limited" : r.status === 400 ? "image_rejected" : "upstream_error";
      return res.status(r.status === 429 ? 429 : 502).json({ code, message: (j.error && j.error.message) || "Claude request failed." });
    }
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    return res.status(200).json({ text, truncated: j.stop_reason === "max_tokens" });
  } catch (e) {
    return res.status(502).json({ code: "upstream_error", message: "Couldn't reach Claude." });
  }
}
