"use strict";

const STORAGE_KEY = "swiss-tournament-v1";

// State shape:
// {
//   title: string,
//   buchholzVariant: "full" | "cut1" | "median",
//   bestOf: 1 | 3 | 5,
//   players: [{ id, name, dropped }],
//   rounds: [ [ { a, b, result, games } ] ],  // b === null => bye; result: 1 (a won), 0 (b won), 0.5 (legacy draw), or null
//                                             // games: [gamesA, gamesB] or null
//   totalRounds: number,
//   viewRound: number,
// }

const BUCHHOLZ_VARIANTS = {
  full:   { label: "Buchholz",        desc: "Sum of all opponents' scores.",                                  cutLow: 0, cutHigh: 0 },
  cut1:   { label: "Buchholz Cut-1",  desc: "Sum of opponents' scores, dropping the lowest one.",             cutLow: 1, cutHigh: 0 },
  median: { label: "Median Buchholz", desc: "Sum of opponents' scores, dropping the highest and the lowest.", cutLow: 1, cutHigh: 1 },
};

const BEST_OF = [1, 3, 5];

function buchholzVariant() {
  return BUCHHOLZ_VARIANTS[state?.buchholzVariant] || BUCHHOLZ_VARIANTS.full;
}

function gamesToWin() {
  return Math.ceil(state.bestOf / 2);
}
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Validates saved/imported data and backfills fields added later.
// Throws on anything the views can't render.
function normalize(s) {
  if (!s || !Array.isArray(s.players) || !Array.isArray(s.rounds)) throw new Error("missing players or rounds");
  if (s.rounds.length === 0) throw new Error("tournament has no rounds");

  const ids = new Set();
  for (const p of s.players) {
    if (typeof p?.id !== "number" || typeof p.name !== "string") throw new Error("invalid player");
    if (ids.has(p.id)) throw new Error(`duplicate player id ${p.id}`);
    ids.add(p.id);
  }
  for (const round of s.rounds) {
    if (!Array.isArray(round)) throw new Error("invalid round");
    for (const m of round) {
      if (!ids.has(m?.a) || (m.b !== null && !ids.has(m.b))) throw new Error("match references unknown player");
      if (![1, 0, 0.5, null].includes(m.result)) throw new Error("invalid match result");
      if (m.games != null && !(Array.isArray(m.games) && m.games.length === 2 && m.games.every(Number.isInteger))) {
        throw new Error("invalid game score");
      }
    }
  }

  if (typeof s.title !== "string") s.title = "";
  if (!BUCHHOLZ_VARIANTS[s.buchholzVariant]) s.buchholzVariant = "full";
  if (!BEST_OF.includes(s.bestOf)) s.bestOf = 1;
  s.players = s.players.map((p) => ({ dropped: false, ...p }));
  if (!Number.isInteger(s.totalRounds) || s.totalRounds < s.rounds.length) s.totalRounds = s.rounds.length;
  if (!Number.isInteger(s.viewRound) || s.viewRound < 0 || s.viewRound >= s.rounds.length) {
    s.viewRound = s.rounds.length - 1;
  }
  return s;
}

let saveWarned = false;

function save() {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // e.g. private browsing or storage full; warn once rather than on every click.
    if (!saveWarned) alert("Couldn't save to this browser. Changes will be lost on reload, so use Export to keep a copy.");
    saveWarned = true;
  }
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
  // { id: { w, d, l, byes, gw, gl } }
  const r = Object.fromEntries(state.players.map((p) => [p.id, { w: 0, d: 0, l: 0, byes: 0, gw: 0, gl: 0 }]));
  for (const round of state.rounds) {
    for (const m of round) {
      if (m.b === null) {
        if (m.result !== null) {
          r[m.a].byes += 1;
          // A bye counts as a clean match win in games too, so it doesn't lower game win %.
          if (state.bestOf > 1) r[m.a].gw += gamesToWin();
        }
        continue;
      }
      if (m.result === null) continue;
      if (m.games) {
        r[m.a].gw += m.games[0]; r[m.a].gl += m.games[1];
        r[m.b].gw += m.games[1]; r[m.b].gl += m.games[0];
      }
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
  const v = buchholzVariant();
  // One entry per round played, so a rematch opponent counts twice. A bye counts as
  // a virtual opponent with the player's own score, so byes don't drag the tiebreak down.
  const oppScores = Object.fromEntries(state.players.map((p) => [p.id, []]));
  for (const round of state.rounds) {
    for (const m of round) {
      if (m.b === null) { oppScores[m.a].push(s[m.a]); continue; }
      oppScores[m.a].push(s[m.b]);
      oppScores[m.b].push(s[m.a]);
    }
  }
  const out = {};
  for (const p of state.players) {
    const sorted = oppScores[p.id].sort((a, b) => a - b);
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
    .map((p) => ({ ...p, score: s[p.id], buchholz: b[p.id], record: r[p.id], gwp: gameWinPct(r[p.id]) }))
    .sort((x, y) =>
      y.score - x.score ||
      y.buchholz - x.buchholz ||
      (state.bestOf > 1 ? (y.gwp ?? -1) - (x.gwp ?? -1) : 0) ||
      x.name.localeCompare(y.name),
    );
}

// Share of games won, or null before any games are recorded.
function gameWinPct(rec) {
  const played = rec.gw + rec.gl;
  return played ? rec.gw / played : null;
}

// --- Swiss pairing ----------------------------------------------------------
function generatePairings() {
  const s = scores();
  const opp = opponents();
  const byeSet = byes();

  const pool = state.players.filter((p) => !p.dropped);
  shuffle(pool);
  pool.sort((a, b) => s[b.id] - s[a.id]);

  // Bye candidates, lowest-ranked first. Nobody gets a second bye while someone else hasn't had one.
  // Each candidate is tried in turn, since the choice of bye can decide whether a rematch-free pairing exists.
  let byeCandidates = [null];
  if (pool.length % 2 === 1) {
    const lowFirst = [...pool].reverse();
    const fresh = lowFirst.filter((p) => !byeSet.has(p.id));
    byeCandidates = fresh.length ? fresh : lowFirst;
  }

  // Shared cap on search steps so an impossible pairing can't freeze the page.
  const budget = { steps: 200000 };
  for (const bye of byeCandidates) {
    const matches = pair(pool.filter((p) => p !== bye), opp, budget);
    if (matches) return { matches, bye };
    if (budget.steps <= 0) break;
  }

  // No rematch-free pairing found: allow as few rematches as the greedy pass can manage.
  const bye = byeCandidates[0];
  return { matches: pairGreedy(pool.filter((p) => p !== bye), opp), bye };
}

function pair(pool, opp, budget) {
  if (pool.length === 0) return [];
  if (--budget.steps <= 0) return null;
  const a = pool[0];
  for (let i = 1; i < pool.length; i++) {
    const b = pool[i];
    if (opp[a.id].has(b.id)) continue;
    const rest = pool.slice(1, i).concat(pool.slice(i + 1));
    const sub = pair(rest, opp, budget);
    if (sub !== null) return [{ a: a.id, b: b.id, result: null, games: null }, ...sub];
    if (budget.steps <= 0) return null;
  }
  return null;
}

// Pairs top-down, preferring the highest-ranked opponent not yet played.
function pairGreedy(pool, opp) {
  const rest = [...pool];
  const out = [];
  while (rest.length >= 2) {
    const a = rest.shift();
    let j = rest.findIndex((b) => !opp[a.id].has(b.id));
    if (j === -1) j = 0;
    const [b] = rest.splice(j, 1);
    out.push({ a: a.id, b: b.id, result: null, games: null });
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
      const data = normalize(JSON.parse(reader.result));
      if (state && !confirm("Replace the current tournament with the imported one?")) return;
      state = data;
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

  const bestOfSelect = el("select", { id: "best-of" },
    BEST_OF.map((n) => el("option", { value: String(n), selected: n === 3 }, n === 1 ? "Single game" : `Best of ${n}`)),
  );

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
      bestOf: parseInt(bestOfSelect.value, 10),
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
    el("label", {}, [el("span", {}, "Match format"), bestOfSelect]),
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

  const hasDraws = state.rounds.some((r) => r.some((m) => m.result === 0.5));
  const standingsBody = el("tbody", { id: "standings" });
  renderStandingsInto(standingsBody, tournamentDone, hasDraws);

  const table = el("table", {}, [
    el("thead", {}, el("tr", {}, [
      el("th", {}, "#"),
      el("th", {}, "Player"),
      el("th", { class: "num" }, "Score"),
      el("th", {}, hasDraws ? "W-D-L" : "W-L"),
      state.bestOf > 1 ? el("th", { class: "num col-games", title: "Games won-lost" }, "Games") : null,
      el("th", { class: "num", title: `${buchholzVariant().label}: ${buchholzVariant().desc} A bye counts as an opponent with the player's own score.` }, "Buch."),
      state.bestOf > 1 ? el("th", { class: "num", title: "Game win %: share of games won (a bye counts as a clean win). Second tiebreaker." }, "GW%") : null,
      el("th", { class: "no-print" }, ""),
    ])),
    standingsBody,
  ]);

  view.append(
    nav,
    el("h2", {}, `Round ${viewRound + 1} of ${state.totalRounds}`),
    el("p", { class: "muted no-print hint" }, state.bestOf > 1 ? "Click the winner's name, then pick the game score. Click the name again to clear." : "Click the winner's name, or Draw. Click again to clear."),
    matchesBox,
    statusRow,
    el("h2", {}, "Standings"),
    el("div", { class: "table-wrap" }, table),
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
    const toWin = gamesToWin();
    const update = (fn) => {
      fn(state.rounds[state.viewRound][i]);
      save();
      render();
    };

    // Clicking the winner records a sweep; clicking them again clears the result.
    const pickWinner = (side) => update((cur) => {
      const result = side === "a" ? 1 : 0;
      if (cur.result === result) { cur.result = null; cur.games = null; return; }
      cur.result = result;
      cur.games = side === "a" ? [toWin, 0] : [0, toWin];
    });

    // outcome from this side's perspective: "win" | "loss" | "draw" (legacy data) | null
    const outcome = (side) => {
      if (m.result === null) return null;
      if (m.result === 0.5) return "draw";
      return (m.result === 1) === (side === "a") ? "win" : "loss";
    };
    const badge = { win: "Win", loss: "Loss", draw: "½" };

    const pickBtn = (side) => {
      const id = side === "a" ? m.a : m.b;
      const o = outcome(side);
      const name = playerName(id);
      return el("button", {
        class: ["pick", side === "b" ? "right" : "", o ? `is-${o}` : ""].filter(Boolean).join(" "),
        "aria-pressed": o === "win" ? "true" : "false",
        title: o === "win" ? "Click to clear result" : `${name} wins`,
        onclick: () => pickWinner(side),
      }, [
        el("span", { class: "name" }, name),
        o ? el("span", { class: "badge" }, badge[o]) : null,
      ]);
    };

    // Middle column: "vs" until a winner is picked, then the game score from the winner's side.
    // Single games can be drawn, so they get a Draw toggle instead.
    let middle;
    if (toWin === 1) {
      middle = el("button", {
        class: ["draw", m.result === 0.5 ? "selected" : ""].filter(Boolean).join(" "),
        "aria-pressed": m.result === 0.5 ? "true" : "false",
        title: m.result === 0.5 ? "Click to clear result" : "Draw",
        onclick: () => update((cur) => {
          cur.result = cur.result === 0.5 ? null : 0.5;
          cur.games = null;
        }),
      }, "Draw");
    } else if (m.result !== 1 && m.result !== 0) {
      middle = el("span", { class: "vs" }, m.result === 0.5 ? "Draw" : "vs");
    } else {
      const winnerIdx = m.result === 1 ? 0 : 1;
      const loserGames = m.games ? m.games[1 - winnerIdx] : 0;
      const options = [];
      for (let lg = 0; lg < toWin; lg++) {
        // Show the score in board order (left–right) so it matches the names.
        const label = winnerIdx === 0 ? `${toWin}–${lg}` : `${lg}–${toWin}`;
        options.push(el("button", {
          class: lg === loserGames ? "selected" : "",
          "aria-pressed": lg === loserGames ? "true" : "false",
          title: `Game score ${label}`,
          onclick: () => update((cur) => {
            cur.games = winnerIdx === 0 ? [toWin, lg] : [lg, toWin];
          }),
        }, label));
      }
      middle = el("span", { class: "score", role: "group", "aria-label": "Game score" }, options);
    }

    container.append(el("div", { class: ["match", m.result === null ? "pending" : "done"].join(" ") }, [
      pickBtn("a"),
      middle,
      pickBtn("b"),
    ]));
  });
}

function renderStandingsInto(tbody, tournamentDone, hasDraws) {
  clear(tbody);
  const rows = standings();
  // Everyone still in who ties the leader on score and tiebreak shares first place.
  const leader = rows.find((p) => !p.dropped);
  const winners = tournamentDone && leader
    ? rows.filter((p) => !p.dropped && p.score === leader.score && p.buchholz === leader.buchholz &&
        (state.bestOf === 1 || p.gwp === leader.gwp))
    : [];
  rows.forEach((p, i) => {
    const isWinner = winners.includes(p);
    const w = p.record.w + p.record.byes;
    const rec = hasDraws ? `${w}-${p.record.d}-${p.record.l}` : `${w}-${p.record.l}`;
    const nameCell = isWinner
      ? el("td", {}, [el("span", { class: "winner-mark", title: winners.length > 1 ? "Shared first place" : "Winner" }, "★\u00a0"), p.name])
      : el("td", {}, p.dropped ? `${p.name} (dropped)` : p.name);

    const dropBtn = el("button", {
      class: "small",
      onclick: () => {
        const target = state.players.find((x) => x.id === p.id);
        target.dropped = !target.dropped;
        if (target.dropped) offerForfeit(target);
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
      state.bestOf > 1 ? el("td", { class: "num col-games" }, `${p.record.gw}-${p.record.gl}`) : null,
      el("td", { class: "num" }, formatScore(p.buchholz)),
      state.bestOf > 1 ? el("td", { class: "num" }, p.gwp === null ? "–" : `${Math.round(p.gwp * 100)}%`) : null,
      el("td", { class: "no-print" }, dropBtn),
    ]));
  });
}

// If a dropped player still has an unfinished match in the current round, offer to score it as a forfeit.
function offerForfeit(player) {
  const m = state.rounds.at(-1).find((x) => x.b !== null && x.result === null && (x.a === player.id || x.b === player.id));
  if (!m) return;
  const oppId = m.a === player.id ? m.b : m.a;
  if (!confirm(`${player.name} has an unfinished match against ${playerName(oppId)}. Record it as a forfeit win for ${playerName(oppId)}?`)) return;
  const toWin = gamesToWin();
  m.result = m.a === oppId ? 1 : 0;
  m.games = m.a === oppId ? [toWin, 0] : [0, toWin];
}

function formatScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

render();
