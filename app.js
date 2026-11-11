"use strict";

const DATA = "./entries.jsonl";
const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const bannerEl = document.getElementById("banner");
const qEl = document.getElementById("q");
const refreshEl = document.getElementById("refresh");

let entries = [];

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function relTime(ts) {
  const t = Date.parse(ts);
  if (isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const units = [[31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
  for (const [div, u] of units) {
    if (s >= div) return Math.floor(s / div) + u + " ago";
  }
  return "just now";
}

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
    meta.push(`<span class="chip">${esc(relTime(e.ts))}</span>`);
    if (e.url) meta.push(`<span class="chip link"><a href="${esc(e.url)}" rel="noopener">link</a></span>`);
    card.innerHTML =
      `<div class="text">${esc(e.text)}</div>` +
      `<div class="meta">${meta.join("")}</div>`;
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
    bannerEl.classList.add("hidden");
    render();
  } catch (err) {
    bannerEl.className = "status offline";
    bannerEl.textContent = "Offline — showing cached ideas if available.";
    bannerEl.classList.remove("hidden");
    render();
  }
}

qEl.addEventListener("input", render);
refreshEl.addEventListener("click", load);
window.addEventListener("online", load);
load();
