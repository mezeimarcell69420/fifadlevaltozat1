/* =====================================================
   Fifadle — script.js
   Data source: https://api.msmc.cc/api/fc26 (unofficial,
   community-run FC 26 player database).
   =====================================================

   IMPORTANT NOTE FOR WHOEVER EDITS THIS:
   The DAILY_POOL list below is a curated set of well-known
   player names used to pick a deterministic "player of the
   day". I couldn't verify every single spelling against the
   live API from where this was built — if the daily target
   ever fails to resolve, the game automatically tries the
   next name in the list, so a bad entry won't break the game,
   but it's worth spot-checking / expanding this list yourself
   against https://api.msmc.cc/api/fc26/player/name/<n>
======================================================= */

const API_BASE = "https://api.msmc.cc/api/fc26";
const ALL_NAMES_URL = "https://api.msmc.cc/fc26/names.html";

const DAILY_POOL = [
  "Erling Haaland", "Kylian Mbappé", "Lionel Messi", "Cristiano Ronaldo",
  "Kevin De Bruyne", "Vinícius Júnior", "Jude Bellingham", "Bukayo Saka",
  "Phil Foden", "Rodri", "Harry Kane", "Robert Lewandowski",
  "Mohamed Salah", "Virgil van Dijk", "Alisson", "Thibaut Courtois",
  "Manuel Neuer", "Neymar Jr", "Antoine Griezmann", "Luka Modric",
  "Casemiro", "Declan Rice", "Martin Ødegaard", "Bruno Fernandes",
  "Marcus Rashford", "Son Heung-min", "Achraf Hakimi", "Rúben Dias",
  "Joshua Kimmich", "Jamal Musiala", "Florian Wirtz", "Pedri",
  "Gavi", "Lamine Yamal", "Victor Osimhen", "Khvicha Kvaratskhelia",
  "Rafael Leão", "Federico Valverde", "Alphonso Davies",
  "Trent Alexander-Arnold", "Ederson", "Gianluigi Donnarumma",
  "Julián Alvarez", "Darwin Núñez", "Ousmane Dembélé", "Kingsley Coman",
  "Frenkie de Jong", "William Saliba", "Nicolò Barella", "Nico Williams"
];

const POSITION_GROUPS = {
  GK: ["GK"],
  DEF: ["CB", "LB", "RB", "LWB", "RWB"],
  MID: ["CDM", "CM", "CAM", "LM", "RM"],
  FWD: ["LW", "RW", "ST", "CF"]
};

function groupOf(position) {
  for (const [group, list] of Object.entries(POSITION_GROUPS)) {
    if (list.includes(position)) return group;
  }
  return null;
}

/* ---------- small helpers ---------- */

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function normalize(str) {
  return (str || "").trim().toLowerCase();
}

/* ---------- API layer ---------- */

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error("No player found");
    // if several players share a name, prefer the highest-rated card
    return data.slice().sort((a, b) => Number(b.OVR) - Number(a.OVR))[0];
  }
  if (!data || !data.Name) throw new Error("No player found");
  return data;
}

function fetchPlayerByName(name) {
  return apiGet(`/player/name/${encodeURIComponent(normalize(name))}`);
}

function fetchRandomPlayer() {
  return apiGet("/random/M");
}

// The API publishes a full reference list of every player name in the
// database (thousands of entries) at this page — used to populate the
// guess-box suggestions with the whole database instead of just the
// curated daily pool.
async function fetchAllPlayerNames() {
  const res = await fetch(ALL_NAMES_URL);
  if (!res.ok) throw new Error("Could not load player list");
  const html = await res.text();

  // The page is normally rendered as an HTML list — try that first.
  const doc = new DOMParser().parseFromString(html, "text/html");
  let names = Array.from(doc.querySelectorAll("li"))
    .map((li) => li.textContent.trim())
    .filter(Boolean);

  // Fallback: the page is served as raw markdown bullet lines ("- Name").
  if (names.length < 20) {
    names = html
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  }

  return names;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

let allNamesCache = null; // fetched once, reused after that

function fillSuggestions(names) {
  els.suggestions.innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join("");
}

async function populateSuggestions(mode) {
  if (mode === "daily") {
    // Daily Match: only the curated pool of well-known players.
    fillSuggestions(DAILY_POOL);
    return;
  }

  // Practice: every player in the database.
  if (allNamesCache) {
    fillSuggestions(allNamesCache);
    return;
  }

  try {
    const names = await fetchAllPlayerNames();
    allNamesCache = names;
    fillSuggestions(names);
  } catch (err) {
    // If the full list can't be loaded, fall back to the curated pool
    // so the suggestions box still shows something useful.
    fillSuggestions(DAILY_POOL);
  }
}

async function resolveDailyTarget() {
  const seed = hashString(todayStr());
  const len = DAILY_POOL.length;
  let lastError = null;
  for (let i = 0; i < len; i++) {
    const candidate = DAILY_POOL[(seed + i) % len];
    try {
      const player = await fetchPlayerByName(candidate);
      return player;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Could not resolve today's player");
}

/* ---------- game state ---------- */

const state = {
  mode: "daily", // "daily" | "practice"
  target: null,
  guesses: [], // array of player objects, in guess order
  won: false,
  loadingTarget: false,
  revealedHints: new Set() // which hint fields have already been shown this round
};

// Attributes the Hint button is allowed to reveal, with a friendly label
// for each. Add/remove entries here to change what a hint can show.
const HINT_FIELDS = [
  { key: "Nation", label: "Nationality" },
  { key: "League", label: "League" },
  { key: "Team", label: "Club" },
  { key: "Position", label: "Position" },
  { key: "Age", label: "Age" },
  { key: "OVR", label: "Rating" }
];

function storageKey() {
  return `fifadle:${todayStr()}`;
}

function saveDailyProgress() {
  if (state.mode !== "daily") return;
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        guessNames: state.guesses.map((g) => g.Name),
        won: state.won
      })
    );
  } catch (e) {
    /* localStorage unavailable — silently skip persistence */
  }
}

function loadDailyProgress() {
  try {
    const raw = localStorage.getItem(storageKey());
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/* ---------- DOM refs ---------- */

const els = {
  modeCaption: document.getElementById("mode-caption"),
  attemptCounter: document.getElementById("attempt-counter"),
  form: document.getElementById("guess-form"),
  input: document.getElementById("guess-input"),
  suggestions: document.getElementById("player-suggestions"),
  statusLine: document.getElementById("status-line"),
  board: document.getElementById("board"),
  boardRows: document.getElementById("board-rows"),
  reveal: document.getElementById("reveal"),
  revealImg: document.getElementById("reveal-img"),
  revealEyebrow: document.getElementById("reveal-eyebrow"),
  revealName: document.getElementById("reveal-name"),
  revealSub: document.getElementById("reveal-sub"),
  copyBtn: document.getElementById("copy-results"),
  playAgainBtn: document.getElementById("play-again"),
  modeDaily: document.getElementById("mode-daily"),
  modePractice: document.getElementById("mode-practice"),
  rulesBtn: document.getElementById("open-rules"),
  rulesModal: document.getElementById("rules-modal"),
  closeRulesBtn: document.getElementById("close-rules"),
  hintBtn: document.getElementById("hint"),
  hintModal: document.getElementById("hint-modal"),
  closeHintBtn: document.getElementById("close-hint"),
  hintText: document.getElementById("hint-text"),
  sideAd: document.getElementById("side-ad"),
  sideAdCloseBtn: document.getElementById("side-ad-close")
};

// Start with the curated pool showing (matches the default Daily Match mode).
fillSuggestions(DAILY_POOL);

/* ---------- rendering ---------- */

function setStatus(text, tone = "error") {
  els.statusLine.textContent = text;
  els.statusLine.dataset.tone = tone;
}

function updateAttemptCounter() {
  const n = state.guesses.length;
  els.attemptCounter.textContent = `Attempt ${n}`;
}

function numericChip(guessValue, targetValue, closeWithin) {
  const g = Number(guessValue);
  const t = Number(targetValue);
  if (g === t) {
    return { cls: "chip--hit", label: String(t) };
  }
  const arrow = t > g ? "↑" : "↓";
  const isClose = Math.abs(g - t) <= closeWithin;
  return {
    cls: isClose ? "chip--close" : "chip--miss",
    label: `${g}${arrow ? " " + arrow : ""}`
  };
}

function textChip(guessValue, targetValue) {
  const match = normalize(guessValue) === normalize(targetValue);
  return {
    cls: match ? "chip--hit" : "chip--miss",
    label: guessValue || "—"
  };
}

function positionChip(guessValue, targetValue) {
  if (normalize(guessValue) === normalize(targetValue)) {
    return { cls: "chip--hit", label: guessValue };
  }
  if (groupOf(guessValue) && groupOf(guessValue) === groupOf(targetValue)) {
    return { cls: "chip--close", label: guessValue };
  }
  return { cls: "chip--miss", label: guessValue || "—" };
}

function buildRow(guess, target) {
  const row = document.createElement("div");
  row.className = "row";

  const nation = textChip(guess.Nation, target.Nation);
  const league = textChip(guess.League, target.League);
  const club = textChip(guess.Team, target.Team);
  const position = positionChip(guess.Position, target.Position);
  const age = numericChip(guess.Age, target.Age, 2);
  const rating = numericChip(guess.OVR, target.OVR, 3);

  row.innerHTML = `
    <span class="row__player">
      <img class="row__thumb" src="${guess.card || ""}" alt="" loading="lazy" />
      <span class="row__name">${guess.Name}</span>
    </span>
    <span class="chip ${nation.cls}">${nation.label}</span>
    <span class="chip ${league.cls}">${league.label}</span>
    <span class="chip ${club.cls}">${club.label}</span>
    <span class="chip ${position.cls}">${position.label}</span>
    <span class="chip ${age.cls}">${age.label}</span>
    <span class="chip ${rating.cls}">${rating.label}</span>
  `;
  return row;
}

function renderGuesses() {
  els.board.hidden = state.guesses.length === 0;
  els.boardRows.innerHTML = "";
  state.guesses.forEach((g) => {
    els.boardRows.appendChild(buildRow(g, state.target));
  });
  updateAttemptCounter();
}

function showReveal() {
  const t = state.target;
  els.reveal.hidden = false;
  els.revealImg.src = t.card || "";
  els.revealImg.alt = t.Name;
  els.revealEyebrow.textContent = state.mode === "daily" ? "Full-time — today's player" : "Full-time";
  els.revealName.textContent = t.Name;
  els.revealSub.textContent = `${t.Position} · ${t.Team} · ${t.Nation} · ${t.OVR} OVR`;
  els.playAgainBtn.hidden = state.mode !== "practice";
  els.input.disabled = true;
  els.form.querySelector(".guessbar__submit").disabled = true;
}

function hideReveal() {
  els.reveal.hidden = true;
  els.input.disabled = false;
  els.form.querySelector(".guessbar__submit").disabled = false;
}

/* ---------- hint ---------- */

function showHint() {
  if (!state.target) {
    setStatus("Hints aren't ready yet — wait for the player to finish loading.", "error");
    return;
  }

  // Pick from fields not yet shown this round; once every field has been
  // revealed, start cycling through them again rather than locking up.
  let available = HINT_FIELDS.filter((f) => !state.revealedHints.has(f.key));
  if (available.length === 0) {
    state.revealedHints.clear();
    available = HINT_FIELDS;
  }

  const choice = available[Math.floor(Math.random() * available.length)];
  state.revealedHints.add(choice.key);

  els.hintText.textContent = `${choice.label}: ${state.target[choice.key]}`;
  els.hintModal.hidden = false;
}

/* ---------- results sharing ---------- */

function chipEmoji(cls) {
  if (cls === "chip--hit") return "🟩";
  if (cls === "chip--close") return "🟨";
  return "🟥";
}

function buildShareText() {
  const label = state.mode === "daily" ? `Fifadle ${todayStr()}` : "Fifadle (practice)";
  const lines = state.guesses.map((g) => {
    const t = state.target;
    const cells = [
      textChip(g.Nation, t.Nation),
      textChip(g.League, t.League),
      textChip(g.Team, t.Team),
      positionChip(g.Position, t.Position),
      numericChip(g.Age, t.Age, 2),
      numericChip(g.OVR, t.OVR, 3)
    ];
    return cells.map((c) => chipEmoji(c.cls)).join("");
  });
  return `${label} — ${state.guesses.length} guess${state.guesses.length === 1 ? "" : "es"}\n${lines.join("\n")}`;
}

async function copyResults() {
  const text = buildShareText();
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Result copied to clipboard.", "win");
  } catch (e) {
    setStatus("Couldn't copy automatically — select and copy the result manually.", "error");
  }
}

/* ---------- game flow ---------- */

async function startDaily() {
  state.mode = "daily";
  state.guesses = [];
  state.won = false;
  state.revealedHints.clear();
  hideReveal();
  els.modeCaption.textContent = "One mystery FC 26 player, chosen fresh every day. Everyone gets the same one.";
  els.playAgainBtn.hidden = true;
  renderGuesses();
  setStatus("Loading today's match sheet…", "info");
  els.input.disabled = true;

  try {
    state.target = await resolveDailyTarget();
  } catch (err) {
    setStatus("Couldn't load today's player from the database. Check your connection and reload.", "error");
    return;
  }

  const saved = loadDailyProgress();
  if (saved && saved.guessNames && saved.guessNames.length) {
    setStatus("Restoring your progress for today…", "info");
    for (const name of saved.guessNames) {
      try {
        const player = await fetchPlayerByName(name);
        state.guesses.push(player);
      } catch (e) {
        /* skip a guess that no longer resolves */
      }
    }
    renderGuesses();
    if (saved.won) {
      state.won = true;
      showReveal();
      setStatus("You already found today's player. Come back tomorrow for a new one.", "win");
      return;
    }
  }

  els.input.disabled = false;
  setStatus("", "info");
}

async function startPractice() {
  state.mode = "practice";
  state.guesses = [];
  state.won = false;
  state.revealedHints.clear();
  hideReveal();
  els.modeCaption.textContent = "Unlimited rounds — a fresh random FC 26 player every time.";
  renderGuesses();
  setStatus("Pulling a random player…", "info");
  els.input.disabled = true;

  try {
    state.target = await fetchRandomPlayer();
  } catch (err) {
    setStatus("Couldn't reach the player database. Check your connection and try again.", "error");
    return;
  }

  els.input.disabled = false;
  setStatus("", "info");
}

function setActiveModeButton() {
  const isDaily = state.mode === "daily";
  els.modeDaily.classList.toggle("is-active", isDaily);
  els.modeDaily.setAttribute("aria-selected", String(isDaily));
  els.modePractice.classList.toggle("is-active", !isDaily);
  els.modePractice.setAttribute("aria-selected", String(!isDaily));
}

async function handleGuessSubmit(evt) {
  evt.preventDefault();
  if (!state.target || state.won) return;

  const typed = els.input.value;
  if (!typed.trim()) return;

  const alreadyGuessed = state.guesses.some((g) => normalize(g.Name) === normalize(typed));
  if (alreadyGuessed) {
    setStatus("You've already guessed that player.", "error");
    return;
  }

  setStatus("Checking…", "info");
  els.form.querySelector(".guessbar__submit").disabled = true;

  try {
    const player = await fetchPlayerByName(typed);
    state.guesses.push(player);
    renderGuesses();
    els.input.value = "";

    if (normalize(player.Name) === normalize(state.target.Name)) {
      state.won = true;
      saveDailyProgress();
      showReveal();
      setStatus("Full-time — you got it!", "win");
    } else {
      saveDailyProgress();
      setStatus("Not quite — check the board for clues.", "info");
    }
  } catch (err) {
    setStatus(`Couldn't find a player named "${typed}". Check the spelling and try again.`, "error");
  } finally {
    els.form.querySelector(".guessbar__submit").disabled = false;
  }
}

/* ---------- wiring ---------- */

els.form.addEventListener("submit", handleGuessSubmit);

els.modeDaily.addEventListener("click", () => {
  if (state.mode === "daily") return;
  state.mode = "daily";
  setActiveModeButton();
  startDaily();
  populateSuggestions("daily");
});

els.modePractice.addEventListener("click", () => {
  if (state.mode === "practice") return;
  state.mode = "practice";
  setActiveModeButton();
  startPractice();
  populateSuggestions("practice");
});

els.playAgainBtn.addEventListener("click", () => {
  startPractice();
});

els.copyBtn.addEventListener("click", copyResults);

els.rulesBtn.addEventListener("click", () => {
  els.rulesModal.hidden = false;
});

els.closeRulesBtn.addEventListener("click", () => {
  els.rulesModal.hidden = true;
});

els.rulesModal.addEventListener("click", (evt) => {
  if (evt.target === els.rulesModal) els.rulesModal.hidden = true;
});

els.hintBtn.addEventListener("click", showHint);

els.closeHintBtn.addEventListener("click", () => {
  els.hintModal.hidden = true;
});

els.hintModal.addEventListener("click", (evt) => {
  if (evt.target === els.hintModal) els.hintModal.hidden = true;
});

els.sideAdCloseBtn.addEventListener("click", () => {
  els.sideAd.remove();
});

document.addEventListener("keydown", (evt) => {
  if (evt.key === "Escape") {
    els.rulesModal.hidden = true;
    els.hintModal.hidden = true;
  }
});

/* ---------- boot ---------- */

setActiveModeButton();
startDaily();
populateSuggestions("daily");