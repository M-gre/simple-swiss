"use strict";

const STORAGE_KEY = "swiss-tournament-v1";

// State shape:
// {
//   title: string,
//   buchholzVariant: "full" | "cut1" | "median",
//   players: [{ id, name, dropped }],
//   rounds: [ [ { a, b, result } ] ],  // b === null => bye; result: 1, 0, 0.5, or null
//   totalRounds: number,
//   viewRound: number,
// }

const BUCHHOLZ_VARIANTS = {
  full:   { label: "Buchholz",        desc: "Sum of all opponents' scores.",                                  cutLow: 0, cutHigh: 0 },
  cut1:   { label: "Buchholz Cut-1",  desc: "Sum of opponents' scores, dropping the lowest one.",             cutLow: 1, cutHigh: 0 },
  median: { label: "Median Buchholz", desc: "Sum of opponents' scores, dropping the highest and the lowest.", cutLow: 1, cutHigh: 1 },
};

function buchholzVariant() {
  return BUCHHOLZ_VARIANTS[state?.buchholzVariant] || BUCHHOLZ_VARIANTS.full;
}
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // Backfill fields added later.
    if (typeof s.title !== "string") s.title = "";
    if (!BUCHHOLZ_VARIANTS[s.buchholzVariant]) s.buchholzVariant = "full";
    s.players = s.players.map((p) => ({ dropped: false, ...p }));
    return s;
  } catch {
    return null;
  }
}

function save() {
  if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  else localStorage.removeItem(STORAGE_KEY);
}

// --- Scoring ----------------------------------------------------------------
function scores() {
  const s = Object.fromEntries(state.players.map((p) => [p.id, 0]));
  for (const round of state.rounds) {
    for (const m of round) {
      if (m.b === null) {
        if (m.result !== null) s[m.a] += 1;
        continue;
      }
      if (m.result === null) continue;
      if (m.result === 1) s[m.a] += 1;
      else if (m.result === 0) s[m.b] += 1;
      else if (m.result === 0.5) { s[m.a] += 0.5; s[m.b] += 0.5; }
    }
  }
  return s;
}

function records() {
  // { id: { w, d, l, byes } }
  const r = Object.fromEntries(state.players.map((p) => [p.id, { w: 0, d: 0, l: 0, byes: 0 }]));
  for (const round of state.rounds) {
    for (const m of round) {
      if (m.b === null) {
        if (m.result !== null) r[m.a].byes += 1;
        continue;
      }
      if (m.result === null) continue;
      if (m.result === 1) { r[m.a].w += 1; r[m.b].l += 1; }
      else if (m.result === 0) { r[m.b].w += 1; r[m.a].l += 1; }
      else if (m.result === 0.5) { r[m.a].d += 1; r[m.b].d += 1; }
    }
  }
  return r;
}

function opponents() {
  const o = Object.fromEntries(state.players.map((p) => [p.id, new Set()]));
  for (const round of state.rounds) {
    for (const m of round) {
      if (m.b === null) continue;
      o[m.a].add(m.b);
      o[m.b].add(m.a);
    }
  }
  return o;
}

function buchholz() {
  const s = scores();
  const opp = opponents();
  const v = buchholzVariant();
  const out = {};
  for (const p of state.players) {
    const sorted = [...opp[p.id]].map((id) => s[id]).sort((a, b) => a - b);
    const trimmed = sorted.slice(v.cutLow, Math.max(v.cutLow, sorted.length - v.cutHigh));
    out[p.id] = trimmed.reduce((acc, n) => acc + n, 0);
  }
  return out;
}

function byes() {
  const b = new Set();
  for (const round of state.rounds) {
    for (const m of round) if (m.b === null) b.add(m.a);
  }
  return b;
}

function standings() {
  const s = scores();
  const b = buchholz();
  const r = records();
  return [...state.players]
    .map((p) => ({ ...p, score: s[p.id], buchholz: b[p.id], record: r[p.id] }))
    .sort((x, y) =>
      y.score - x.score ||
      y.buchholz - x.buchholz ||
      x.name.localeCompare(y.name),
    );
}

// --- Swiss pairing ----------------------------------------------------------
function generatePairings() {
  const s = scores();
  const opp = opponents();
  const byeSet = byes();

  const pool = state.players.filter((p) => !p.dropped);
  shuffle(pool);
  pool.sort((a, b) => s[b.id] - s[a.id]);

  let byePlayer = null;
  if (pool.length % 2 === 1) {
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!byeSet.has(pool[i].id)) { byePlayer = pool[i]; break; }
    }
    if (!byePlayer) byePlayer = pool[pool.length - 1];
    const idx = pool.indexOf(byePlayer);
    pool.splice(idx, 1);
  }

  const matches = pair(pool, opp);
  if (!matches) {
    return { matches: pairForce(pool), bye: byePlayer };
  }
  return { matches, bye: byePlayer };
}

function pair(pool, opp) {
  if (pool.length === 0) return [];
  const a = pool[0];
  for (let i = 1; i < pool.length; i++) {
    const b = pool[i];
    if (opp[a.id].has(b.id)) continue;
    const rest = pool.slice(1, i).concat(pool.slice(i + 1));
    const sub = pair(rest, opp);
    if (sub !== null) return [{ a: a.id, b: b.id, result: null }, ...sub];
  }
  return null;
}

function pairForce(pool) {
  const out = [];
  for (let i = 0; i < pool.length; i += 2) {
    out.push({ a: pool[i].id, b: pool[i + 1].id, result: null });
  }
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// --- DOM helpers ------------------------------------------------------------
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// --- Export / Import --------------------------------------------------------
function exportJson() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const slug = (state.title || "tournament").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournament";
  const date = new Date().toISOString().slice(0, 10);
  const a = el("a", { href: url, download: `${slug}-${date}.json` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.players) || !Array.isArray(data.rounds) || typeof data.totalRounds !== "number") {
        throw new Error("invalid file");
      }
      if (state && !confirm("Replace the current tournament with the imported one?")) return;
      state = data;
      if (typeof state.title !== "string") state.title = "";
      if (!BUCHHOLZ_VARIANTS[state.buchholzVariant]) state.buchholzVariant = "full";
      state.players = state.players.map((p) => ({ dropped: false, ...p }));
      if (typeof state.viewRound !== "number") state.viewRound = Math.max(0, state.rounds.length - 1);
      save();
      render();
    } catch (e) {
      alert("Could not import file: " + e.message);
    }
  };
  reader.readAsText(file);
}

// --- Views ------------------------------------------------------------------
const titleEl = document.getElementById("app-title");
const view = document.getElementById("view");
const headerActions = document.getElementById("header-actions");

function render() {
  clear(headerActions);
  clear(view);
  titleEl.textContent = state?.title ? state.title : "Swiss Tournament";
  if (!state) renderNew();
  else renderTournament();
}

function renderNew() {
  const titleInput = el("input", { id: "title", type: "text", placeholder: "Optional name (e.g. Friday Night Chess)" });
  const playersInput = el("textarea", { id: "players", placeholder: "Alice\nBob\nCarol\nDave" });
  const roundsInput = el("input", { id: "rounds", type: "number", min: "1", max: "20", value: "4" });
  const importInput = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });

  const buchholzSelect = el("select", { id: "buchholz", title: BUCHHOLZ_VARIANTS.full.desc },
    Object.entries(BUCHHOLZ_VARIANTS).map(([key, v]) =>
      el("option", { value: key, title: v.desc }, v.label),
    ),
  );
  buchholzSelect.addEventListener("change", () => {
    buchholzSelect.title = BUCHHOLZ_VARIANTS[buchholzSelect.value].desc;
  });

  importInput.addEventListener("change", () => {
    if (importInput.files[0]) importJson(importInput.files[0]);
  });

  playersInput.addEventListener("input", () => {
    const n = playersInput.value.split("\n").map((x) => x.trim()).filter(Boolean).length;
    if (n >= 2) roundsInput.value = Math.max(1, Math.ceil(Math.log2(n)));
  });

  function onStart() {
    const names = playersInput.value.split("\n").map((x) => x.trim()).filter(Boolean);
    if (names.length < 2) { alert("Need at least 2 players."); return; }
    const totalRounds = parseInt(roundsInput.value, 10) || 1;
    state = {
      title: titleInput.value.trim(),
      buchholzVariant: buchholzSelect.value,
      players: names.map((name, i) => ({ id: i + 1, name, dropped: false })),
      rounds: [],
      totalRounds,
      viewRound: 0,
    };
    startNextRound();
    save();
    render();
  }

  view.append(
    el("h2", {}, "New Tournament"),
    el("label", {}, [el("span", {}, "Title (optional)"), titleInput]),
    el("label", {}, [el("span", {}, "Players (one per line)"), playersInput]),
    el("label", {}, [el("span", {}, "Number of rounds"), roundsInput]),
    el("label", {}, [
      el("span", {}, "Tiebreaker (hover for explanation)"),
      buchholzSelect,
    ]),
    el("div", { class: "row" }, [
      el("button", { onclick: () => importInput.click() }, "Import JSON…"),
      el("button", { class: "primary", onclick: onStart }, "Start"),
    ]),
    el("p", { class: "muted" }, "Suggested rounds: ceil(log₂ players)."),
    importInput,
  );
}

function startNextRound() {
  const { matches, bye } = generatePairings();
  const round = [...matches];
  if (bye) round.push({ a: bye.id, b: null, result: 1 });
  state.rounds.push(round);
  state.viewRound = state.rounds.length - 1;
}

function playerName(id) {
  return state.players.find((p) => p.id === id)?.name ?? "?";
}

function roundComplete(idx) {
  return state.rounds[idx].every((m) => m.result !== null);
}

function renderTournament() {
  const importInput = el("input", { type: "file", accept: "application/json,.json", style: "display:none" });
  importInput.addEventListener("change", () => {
    if (importInput.files[0]) importJson(importInput.files[0]);
  });

  headerActions.append(
    el("button", { onclick: exportJson, title: "Download tournament as JSON" }, "Export"),
    el("button", { onclick: () => importInput.click(), title: "Replace tournament from JSON" }, "Import"),
    el("button", {
      onclick: () => {
        if (confirm("Reset tournament? All data will be lost.")) {
          state = null;
          save();
          render();
        }
      },
    }, "Reset"),
    importInput,
  );

  const viewRound = state.viewRound;
  const isLastRound = viewRound === state.rounds.length - 1;
  const canAdvance = isLastRound && roundComplete(viewRound) && state.rounds.length < state.totalRounds;
  const tournamentDone = state.rounds.length >= state.totalRounds && roundComplete(state.rounds.length - 1);

  const nav = el("div", { class: "round-nav no-print" },
    state.rounds.map((_, i) =>
      el("button", {
        class: i === viewRound ? "selected" : "",
        onclick: () => { state.viewRound = i; save(); render(); },
      }, `Round ${i + 1}`),
    ),
  );

  const matchesBox = el("div", { id: "matches" });
  renderMatchesInto(matchesBox);

  const rightSide = el("div", {}, [
    canAdvance ? el("button", {
      class: "primary",
      onclick: () => { startNextRound(); save(); render(); },
    }, "Next Round") : null,
    tournamentDone ? el("span", { class: "muted" }, "Tournament complete") : null,
  ]);

  const statusRow = el("div", { class: "row no-print" }, [
    el("span", { class: "muted" }, roundComplete(viewRound) ? "All results entered." : "Enter results to continue."),
    rightSide,
  ]);

  const standingsBody = el("tbody", { id: "standings" });
  renderStandingsInto(standingsBody, tournamentDone);

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "#"),
      el("th", {}, "Player"),
      el("th", { class: "num" }, "Score"),
      el("th", {}, "W-D-L"),
      el("th", { class: "num", title: `${buchholzVariant().label}: ${buchholzVariant().desc}` }, "Buch."),
      el("th", { class: "no-print" }, ""),
    ])),
    standingsBody,
  ]);

  view.append(
    nav,
    el("h2", {}, `Round ${viewRound + 1} of ${state.totalRounds}`),
    matchesBox,
    statusRow,
    el("h2", {}, "Standings"),
    table,
  );
}

function renderMatchesInto(container) {
  clear(container);
  const round = state.rounds[state.viewRound];
  round.forEach((m, i) => {
    if (m.b === null) {
      container.append(el("div", { class: "bye" }, `${playerName(m.a)} — bye (+1)`));
      return;
    }
    const makeBtn = (val, label) =>
      el("button", {
        class: m.result === val ? "selected" : "",
        dataset: { r: String(val) },
        onclick: () => {
          const cur = state.rounds[state.viewRound][i];
          cur.result = cur.result === val ? null : val;
          save();
          render();
        },
      }, label);

    container.append(el("div", { class: "match" }, [
      el("span", { class: "player" }, playerName(m.a)),
      el("span", { class: "result" }, [makeBtn(1, "1"), makeBtn(0.5, "½"), makeBtn(0, "0")]),
      el("span", { class: "player right" }, playerName(m.b)),
    ]));
  });
}

function renderStandingsInto(tbody, tournamentDone) {
  clear(tbody);
  standings().forEach((p, i) => {
    const isWinner = tournamentDone && i === 0 && !p.dropped;
    const rec = `${p.record.w + p.record.byes}-${p.record.d}-${p.record.l}`;
    const nameCell = isWinner
      ? el("td", {}, [el("span", { class: "winner-mark", title: "Winner" }, "★ "), p.name])
      : el("td", {}, p.dropped ? `${p.name} (dropped)` : p.name);

    const dropBtn = el("button", {
      class: "small",
      onclick: () => {
        const target = state.players.find((x) => x.id === p.id);
        target.dropped = !target.dropped;
        save();
        render();
      },
      title: p.dropped ? "Re-add to upcoming rounds" : "Exclude from upcoming rounds",
    }, p.dropped ? "Re-add" : "Drop");

    tbody.append(el("tr", {
      class: [
        p.dropped ? "dropped" : "",
        isWinner ? "winner" : "",
      ].filter(Boolean).join(" "),
    }, [
      el("td", {}, String(i + 1)),
      nameCell,
      el("td", { class: "num" }, formatScore(p.score)),
      el("td", {}, rec),
      el("td", { class: "num" }, formatScore(p.buchholz)),
      el("td", { class: "no-print" }, dropBtn),
    ]));
  });
}

function formatScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

render();
