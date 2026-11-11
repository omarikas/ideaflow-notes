"use strict";

const DATA = "./entries.jsonl";
const BRANCH = "main";
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-";
const TOKEN_KEY = "if_token";
const QUEUE_KEY = "if_queue";
const MAX_QUEUE = 200;

// owner/repo derived from the Pages path (owner.github.io/repo/).
const [OWNER, REPO] = (() => {
  const owner = location.hostname.split(".")[0];
  const repo = location.pathname.split("/").filter(Boolean)[0] || "";
  return [owner, repo];
})();
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DATA.replace("./", "")}`;

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const bannerEl = document.getElementById("banner");
const qEl = document.getElementById("q");
const refreshEl = document.getElementById("refresh");
const composeEl = document.getElementById("compose");
const noteEl = document.getElementById("note");
const sendEl = document.getElementById("send");
const gearEl = document.getElementById("gear");
const sheetEl = document.getElementById("settings");
const tokenEl = document.getElementById("token");
const repoLabel = document.getElementById("repoLabel");
const toastEl = document.getElementById("toast");

let entries = [];
const pending = new Set();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
repoLabel.textContent = `${OWNER}/${REPO}`;

/* ---------- utils ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function newId() {
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}
function relTime(ts) {
  const t = Date.parse(ts);
  if (isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  for (const [div, u] of [[31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]]) {
    if (s >= div) return Math.floor(s / div) + u + " ago";
  }
  return "just now";
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/* ---------- viewer ---------- */
function render() {
  const q = qEl.value.trim().toLowerCase();
  const shown = q
    ? entries.filter((e) => (e.text || "").toLowerCase().includes(q) ||
        (e.project || "").toLowerCase().includes(q))
    : entries;

  countEl.textContent = entries.length ? shown.length + "/" + entries.length : "";
  listEl.replaceChildren();
  emptyEl.classList.toggle("hidden", shown.length !== 0);
  emptyEl.textContent = entries.length ? "No matches." : "No ideas yet.";

  const frag = document.createDocumentFragment();
  for (const e of shown) {
    const card = document.createElement("article");
    card.className = "card";
    const meta = [];
    if (e.project) meta.push(`<span class="chip proj">${esc(e.project)}</span>`);
    if (e.source && e.source !== "cli") meta.push(`<span class="chip src">${esc(e.source)}</span>`);
    if (pending.has(e.id)) meta.push(`<span class="chip pend">sending…</span>`);
    meta.push(`<span class="chip">${esc(relTime(e.ts))}</span>`);
    if (e.url) meta.push(`<span class="chip link"><a href="${esc(e.url)}" rel="noopener">link</a></span>`);
    card.innerHTML = `<div class="text">${esc(e.text)}</div><div class="meta">${meta.join("")}</div>`;
    frag.appendChild(card);
  }
  listEl.appendChild(frag);
}

async function load() {
  try {
    const res = await fetch(DATA, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    entries = text.split("\n").filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean).reverse();
    // keep optimistic pending items on top
    bannerEl.classList.add("hidden");
  } catch {
    bannerEl.className = "status offline";
    bannerEl.textContent = navigator.onLine ? "Couldn't load ideas." : "Offline — showing cached ideas.";
    bannerEl.classList.remove("hidden");
  }
  render();
}

/* ---------- capture ---------- */
function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function headers() {
  const h = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const t = getToken();
  if (t) h["Authorization"] = "Bearer " + t;
  return h;
}

async function apiAppend(entry) {
  for (let i = 0; i < 4; i++) {
    const get = await fetch(`${API}?ref=${BRANCH}&n=${Date.now()}`, { headers: headers() });
    if (get.status === 401 || get.status === 403) throw new Error("auth");
    let sha = null, cur = "";
    if (get.ok) {
      const j = await get.json();
      sha = j.sha;
      if (j.content) {
        cur = b64decode(j.content);
      } else if (j.git_url) {
        // Contents API omits `content` for files >1MB — read the blob instead.
        const blob = await fetch(j.git_url, { headers: headers() });
        if (blob.ok) cur = b64decode((await blob.json()).content || "");
      }
    } else if (get.status !== 404) {
      throw new Error("GET " + get.status);
    }
    if (cur && !cur.endsWith("\n")) cur += "\n";
    const body = {
      message: `capture(phone): ${entry.id}`,
      content: b64encode(cur + JSON.stringify(entry) + "\n"),
      branch: BRANCH,
    };
    if (sha) body.sha = sha;
    const put = await fetch(API, { method: "PUT", headers: headers(), body: JSON.stringify(body) });
    if (put.ok) return true;
    if (put.status === 401 || put.status === 403) throw new Error("auth");
    if (put.status === 409 || put.status === 422) { await sleep(400); continue; } // sha race
    await sleep(600);
  }
  throw new Error("append failed");
}

function readQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; } }
function writeQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE))); }

async function flush() {
  let q = readQueue();
  if (!q.length || !navigator.onLine || !getToken()) return;
  for (const entry of [...q]) {
    try {
      await apiAppend(entry);
      pending.delete(entry.id);
      q = q.filter((e) => e.id !== entry.id);
      writeQueue(q);
    } catch (err) {
      if (err.message === "auth") { toast("Token rejected — check ⚙"); return; }
      break; // still offline / server issue; keep the rest queued
    }
  }
  render();
}

function capture(text, url) {
  text = (text || "").trim();
  if (!text && !url) return;
  const entry = {
    id: newId(),
    ts: new Date().toISOString(),
    text: text || url,
    status: "new",
    source: "phone",
    type: "unknown",
    device: "iphone",
    url: url || null,
  };
  entries.unshift(entry);
  pending.add(entry.id);
  const q = readQueue();
  q.push(entry);
  writeQueue(q);
  render();

  if (!getToken()) { toast("Saved — add a token ⚙ to sync"); return; }
  flush().then(() => {
    if (!pending.has(entry.id)) toast("Captured");
  });
}

/* ---------- events ---------- */
qEl.addEventListener("input", render);
refreshEl.addEventListener("click", load);
window.addEventListener("online", () => { load(); flush(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) flush(); });

composeEl.addEventListener("submit", (e) => {
  e.preventDefault();
  capture(noteEl.value);
  noteEl.value = "";
  noteEl.style.height = "auto";
});
noteEl.addEventListener("input", () => {
  noteEl.style.height = "auto";
  noteEl.style.height = Math.min(noteEl.scrollHeight, 120) + "px";
});
noteEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    composeEl.requestSubmit();
  }
});

gearEl.addEventListener("click", () => {
  tokenEl.value = getToken();
  sheetEl.classList.remove("hidden");
});
document.getElementById("closeSheet").addEventListener("click", () => sheetEl.classList.add("hidden"));
document.getElementById("saveToken").addEventListener("click", () => {
  const v = tokenEl.value.trim();
  v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY);
  sheetEl.classList.add("hidden");
  toast(v ? "Token saved" : "Token cleared");
  flush();
});
document.getElementById("clearToken").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  tokenEl.value = "";
  toast("Token cleared");
});

/* ---------- entry from a share/URL shortcut: ?text=&url= ---------- */
(function fromQuery() {
  const p = new URLSearchParams(location.search);
  const text = p.get("text") || p.get("title") || "";
  const url = p.get("url") || "";
  if (text || url) {
    history.replaceState({}, "", location.pathname);
    noteEl.value = text;
    setTimeout(() => capture(text, url), 350);
  }
})();

load().then(flush);
