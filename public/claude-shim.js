/*
 * AdPulse OTS — backend adapter.
 *
 * The app was first built to run inside claude.ai, where it talks to the platform through
 * `window.claude.use(name)`. This file gives the app that same API, backed by Supabase and a
 * Vercel function, so the app code itself does not change:
 *
 *   use("db")        -> public.docs table (+ realtime), paths like "sites/s01"
 *   use("assets")    -> Supabase Storage bucket "media", served at /_blob/<id>
 *   use("user")      -> Supabase Auth + public.members (role admin | client)
 *   use("sample")    -> POST /api/sample (Claude vision for the Site Agent's photo scan)
 *   use("downloads") -> a normal browser download
 *
 * Needs window.OTS_CONFIG = { supabaseUrl, supabaseAnonKey } from /config.js.
 */
(function () {
  "use strict";
  var cfg = window.OTS_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    console.warn("[OTS] Supabase is not configured: running the offline demo (data stays in this browser).");
    return; // no window.claude -> the app starts in its offline demo mode
  }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.OTS_SB = sb;

  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function mapErr(e) {
    if (!e) return err("unavailable", "Unknown error");
    if (e.code && typeof e.code === "string" && /^(invalid_argument|not_granted|unavailable)$/.test(e.code)) return e;
    var m = String(e.message || e);
    if (/row-level security|permission denied|not allowed|42501/i.test(m) || e.code === "42501") return err("not_granted", "You don't have access to change this.");
    if (/fetch|network|Failed to fetch/i.test(m)) return err("unavailable", "No connection.");
    return err("invalid_argument", m);
  }

  /* ---------------- login gate ---------------- */
  var session = null, me = null, ready;
  function loginScreen() {
    return new Promise(function (resolve) {
      var box = document.createElement("div");
      box.id = "otsLogin";
      box.innerHTML =
        '<style>#otsLogin{position:fixed;inset:0;z-index:999;display:grid;place-items:center;padding:16px;background:radial-gradient(circle at 20% 10%,#5a1014,transparent 55%),radial-gradient(circle at 90% 90%,#134a48,transparent 50%),#121011;font-family:Manrope,system-ui,sans-serif;color:#f6f1f0}' +
        '#otsLogin .c{width:min(420px,100%);background:#1c1819;border:1px solid #3a3032;border-radius:22px;padding:26px;display:grid;gap:14px;box-shadow:0 30px 60px -20px #000}' +
        '#otsLogin img{height:96px;justify-self:center;background:#fff;border-radius:16px;padding:8px 12px}' +
        '#otsLogin h1{margin:0;font-size:22px;text-align:center}#otsLogin p{margin:0;color:#c9bdbb;font-size:14px;text-align:center}' +
        '#otsLogin input{width:100%;box-sizing:border-box;min-height:48px;border-radius:12px;border:1px solid #3a3032;background:#262022;color:#fff;padding:0 14px;font-size:16px}' +
        '#otsLogin button{min-height:50px;border:0;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;background:linear-gradient(120deg,#D9161D,#F26A21);color:#fff}' +
        '#otsLogin button.g{background:#fff;color:#1c1a1b}#otsLogin small{color:#968a88;text-align:center}#otsLogin .ok{color:#34D399;font-weight:700;text-align:center}</style>' +
        '<form class="c" id="otsForm"><img src="/icons/icon-192.png" alt="AdPulse"><h1>AdPulse OOH Tracking System</h1>' +
        '<p>Sign in with your work email. We send you a one-time sign-in link.</p>' +
        '<input id="otsEmail" type="email" required placeholder="you@company.com" autocomplete="email">' +
        '<button type="submit">Email me a sign-in link</button>' +
        (cfg.googleLogin ? '<button type="button" class="g" id="otsGoogle">Continue with Google</button>' : "") +
        '<div id="otsMsg" aria-live="polite"></div><small>Clients: use the email your agency invited.</small></form>';
      document.body.appendChild(box);
      var msg = box.querySelector("#otsMsg");
      box.querySelector("#otsForm").onsubmit = async function (e) {
        e.preventDefault();
        var email = box.querySelector("#otsEmail").value.trim();
        msg.className = ""; msg.textContent = "Sending…";
        var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } });
        if (r.error) { msg.textContent = "Couldn't send the link: " + r.error.message; return; }
        msg.className = "ok"; msg.textContent = "Check your inbox and tap the link to sign in.";
      };
      var g = box.querySelector("#otsGoogle");
      if (g) g.onclick = function () { sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }); };
      var sub = sb.auth.onAuthStateChange(function (_ev, s) {
        if (s) { sub.data.subscription.unsubscribe(); box.remove(); resolve(s); }
      });
    });
  }
  async function loadMe(s) {
    var r = await sb.from("members").select("role,name,email").eq("user_id", s.user.id).maybeSingle();
    me = { id: "u_" + s.user.id, uuid: s.user.id, role: (r.data && r.data.role) || "client", name: (r.data && r.data.name) || "", email: s.user.email };
  }
  ready = (async function () {
    var got = await sb.auth.getSession();
    session = got.data.session || (await loginScreen());
    await loadMe(session);
    sb.auth.onAuthStateChange(function (ev, s) { if (ev === "SIGNED_OUT") location.reload(); if (s) session = s; });
    return true;
  })();
  window.OTS_signOut = function () { return sb.auth.signOut(); };

  /* ---------------- db ---------------- */
  function splitPath(path) { var i = path.lastIndexOf("/"); return { collection: path.slice(0, i), id: path.slice(i + 1) }; }
  function snapDoc(path, row) {
    var id = splitPath(path).id;
    return { id: id, exists: !!row, data: function () { return row ? JSON.parse(JSON.stringify(row.data)) : undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function makeQuery(collection, filters, order, lim) {
    function apply(rows) {
      var out = rows.filter(function (r) {
        return filters.every(function (f) {
          var v = r.data[f[0]], w = f[2];
          switch (f[1]) {
            case "==": return v === w; case "!=": return v !== w; case "<": return v < w; case "<=": return v <= w;
            case ">": return v > w; case ">=": return v >= w; case "in": return Array.isArray(w) && w.indexOf(v) >= 0;
            case "array-contains": return Array.isArray(v) && v.indexOf(w) >= 0; default: return true;
          }
        });
      });
      if (order) out.sort(function (a, b) { var c = compare(a.data[order[0]], b.data[order[0]]); return order[1] === "desc" ? -c : c; });
      if (lim) out = out.slice(0, lim);
      return out;
    }
    function toSnap(rows) {
      var docs = apply(rows).map(function (r) { return snapDoc(r.path, r); });
      return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
    }
    async function fetchAll() {
      var all = [], from = 0, page = 1000;
      for (;;) {
        var r = await sb.from("docs").select("path,data").eq("collection", collection).range(from, from + page - 1);
        if (r.error) throw mapErr(r.error);
        all = all.concat(r.data); if (r.data.length < page) break; from += page;
      }
      return all;
    }
    var q = {
      where: function (field, op, value) { return makeQuery(collection, filters.concat([[field, op, value]]), order, lim); },
      orderBy: function (field, dir) { return makeQuery(collection, filters, [field, dir || "asc"], lim); },
      limit: function (n) { return makeQuery(collection, filters, order, n); },
      get: async function () { await ready; return toSnap(await fetchAll()); },
      onSnapshot: function (next, onErr) {
        var rows = new Map(), ch = null, dead = false;
        function emit() { if (!dead) next(toSnap(Array.from(rows.values()))); }
        (async function () {
          try {
            await ready;
            ch = sb.channel("c:" + collection + ":" + Math.random().toString(36).slice(2))
              .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "collection=eq." + collection }, function (p) {
                if (p.eventType === "DELETE") rows.delete(p.old.path); else rows.set(p.new.path, { path: p.new.path, data: p.new.data });
                emit();
              }).subscribe();
            (await fetchAll()).forEach(function (r) { rows.set(r.path, r); });
            emit();
          } catch (e) { if (onErr) onErr(mapErr(e)); }
        })();
        return function () { dead = true; if (ch) sb.removeChannel(ch); };
      }
    };
    return q;
  }
  function makeDoc(path) {
    var sp = splitPath(path);
    async function read() {
      var r = await sb.from("docs").select("path,data").eq("path", path).maybeSingle();
      if (r.error) throw mapErr(r.error);
      return r.data;
    }
    return {
      id: sp.id, path: path,
      get: async function () { await ready; return snapDoc(path, await read()); },
      set: async function (data) {
        await ready;
        var r = await sb.from("docs").upsert({ path: path, collection: sp.collection, doc_id: sp.id, data: data }, { onConflict: "path" });
        if (r.error) throw mapErr(r.error);
      },
      update: async function (data) {
        await ready;
        var cur = await read(); if (!cur) throw err("invalid_argument", "Document does not exist: " + path);
        var r = await sb.from("docs").update({ data: Object.assign({}, cur.data, data) }).eq("path", path);
        if (r.error) throw mapErr(r.error);
      },
      delete: async function () {
        await ready;
        var r = await sb.from("docs").delete().eq("path", path);
        if (r.error) throw mapErr(r.error);
      },
      onSnapshot: function (next, onErr) {
        var ch = null, dead = false;
        (async function () {
          try {
            await ready;
            ch = sb.channel("d:" + path + ":" + Math.random().toString(36).slice(2))
              .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "path=eq." + path }, function (p) {
                if (!dead) next(snapDoc(path, p.eventType === "DELETE" ? null : { data: p.new.data }));
              }).subscribe();
            var row = await read(); if (!dead) next(snapDoc(path, row));
          } catch (e) { if (onErr) onErr(mapErr(e)); }
        })();
        return function () { dead = true; if (ch) sb.removeChannel(ch); };
      },
      collection: function (sub) { return makeQuery(path + "/" + sub, [], null, 0); }
    };
  }
  var db = { doc: makeDoc, collection: function (p) { return makeQuery(p, [], null, 0); } };

  /* ---------------- assets ---------------- */
  var EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
  var assets = {
    upload: async function (blob, opts) {
      await ready;
      var type = (opts && opts.type) || blob.type || "application/octet-stream";
      var id = crypto.randomUUID().replace(/-/g, "") + (EXT[type] ? "." + EXT[type] : "");
      var r = await sb.storage.from("media").upload(id, blob, { contentType: type, upsert: false, cacheControl: "31536000" });
      if (r.error) throw Object.assign(mapErr(r.error), { code: /size|large/i.test(r.error.message) ? "too_large" : "store_unavailable" });
      return { id: id, url: "/_blob/" + id, sizeBytes: blob.size, contentType: type };
    },
    delete: async function (id) {
      await ready;
      var r = await sb.storage.from("media").remove([id]);
      if (r.error) throw mapErr(r.error);
      return { deleted: true };
    },
    list: async function () {
      await ready;
      var r = await sb.storage.from("media").list("", { limit: 1000 });
      if (r.error) throw mapErr(r.error);
      var list = r.data.map(function (f) { return { id: f.name, url: "/_blob/" + f.name, contentType: (f.metadata && f.metadata.mimetype) || "", sizeBytes: (f.metadata && f.metadata.size) || 0, createdAt: f.created_at }; });
      return { assets: list, usage: { files: list.length, bytes: list.reduce(function (a, b) { return a + b.sizeBytes; }, 0), maxFiles: Infinity, maxBytes: Infinity } };
    }
  };

  /* ---------------- user ---------------- */
  var user = {
    id: async function () { await ready; return me.id; },
    isOwner: async function () { await ready; return me.role === "admin"; },
    canEdit: async function () { await ready; return me.role === "admin"; },
    can: async function (what) { await ready; return what === "data.write" ? me.role === "admin" : null; },
    me: async function () { await ready; return { id: me.id, name: me.name, email: me.email, avatarUrl: "/icons/icon-192.png", color: "#D9161D", isOwner: me.role === "admin", canEdit: me.role === "admin" }; },
    name: async function () { await ready; return me.name || ""; },
    email: async function () { await ready; return me.email || null; },
    profiles: async function (ids) {
      await ready;
      ids = [].concat(ids || []);
      var out = {}; ids.forEach(function (i) { out[i] = { id: i, name: "", email: null, avatarUrl: "/icons/icon-192.png", color: "#888", guest: false }; });
      var uuids = ids.filter(function (i) { return /^u_[0-9a-f-]{36}$/.test(i); }).map(function (i) { return i.slice(2); });
      if (uuids.length) {
        var r = await sb.rpc("profiles", { ids: uuids });
        (r.data || []).forEach(function (p) { var k = "u_" + p.id; out[k] = Object.assign(out[k], { name: p.name || "", email: p.email || null }); });
      }
      return out;
    },
    search: async function () { return []; }
  };

  /* ---------------- sample (Claude via /api/sample) ---------------- */
  function blobToB64(b) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1]); }; fr.onerror = rej; fr.readAsDataURL(b); });
  }
  async function callClaude(input, opts) {
    await ready;
    opts = opts || {};
    var images = opts.images ? [].concat(Array.from(opts.images.length != null && !(opts.images instanceof Blob) ? opts.images : [opts.images])) : [];
    var imgs = await Promise.all(images.map(async function (b) { return { mediaType: b.type || "image/jpeg", data: await blobToB64(b) }; }));
    var tok = (await sb.auth.getSession()).data.session;
    var r;
    try {
      r = await fetch("/api/sample", {
        method: "POST", signal: opts.signal,
        headers: { "content-type": "application/json", authorization: "Bearer " + (tok ? tok.access_token : "") },
        body: JSON.stringify({ prompt: typeof input === "string" ? input : input.map(function (t) { return t.content; }).join("\n\n"), images: imgs, tier: opts.modelTier || "default" })
      });
    } catch (e) { throw err(e && e.name === "AbortError" ? "cancelled" : "upstream_error", "Couldn't reach the scan service."); }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw err(j.code || (r.status === 401 || r.status === 403 ? "not_granted" : r.status === 429 ? "rate_limited" : "upstream_error"), j.message || ("Scan failed (" + r.status + ")"));
    return { text: j.text || "", truncated: !!j.truncated };
  }
  var sample = function (input, opts) { return callClaude(input, opts); };
  sample.json = async function (input, opts) {
    var r = await callClaude(input, opts);
    var t = r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    var a = t.indexOf("{"), b = t.lastIndexOf("}");
    try { return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t); }
    catch (e) { var x = err("invalid_json", "The reply wasn't valid JSON."); x.text = r.text; throw x; }
  };
  sample.limits = async function () { return { maxPromptBytes: 65536, images: { maxCount: 2, maxInputBytes: 5 * 1048576, mediaTypes: ["image/jpeg", "image/png", "image/webp"] } }; };

  /* ---------------- downloads ---------------- */
  var downloads = {
    save: async function (o) {
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data]);
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = o.filename || "download";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return { saved: true };
    }
  };

  var caps = { db: db, assets: assets, user: user, sample: sample, downloads: downloads };
  window.claude = {
    use: async function (name) {
      if (!caps[name]) return null;
      await ready;
      if ((name === "assets" || name === "sample") && me.role !== "admin") return null; // team-only features
      return caps[name];
    }
  };
})();
