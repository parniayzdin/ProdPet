import {
  FocusSession,
  MISSIONS,
  UNLOCKS,
  normalizeSessions,
  dayKey,
  streakFor,
} from "./focus.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const STORAGE_KEY = "productivity.workspace.v2";
const LEGACY_KEY = "productivity.sessions.v1";
const session = new FocusSession();
let sessions = [];
let focusMinutes = 25;
let missionMinutes = 5;
let celebrated = false;
let storageWarning = false;
let renderedDay = dayKey(new Date());

function notify(message) {
  $("#announcement").textContent = message;
  $("#announcement").classList.add("visible");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(
    () => $("#announcement").classList.remove("visible"),
    5000,
  );
}
function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw
      ? JSON.parse(raw)
      : { sessions: JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]") };
  } catch {
    return {};
  }
}
const saved = readState();
sessions = normalizeSessions(saved?.sessions);
const restored = session.restore(saved?.active);
function persist() {
  try {
    // Preserve completed work from other tabs and deduplicate resumed sessions.
    sessions = normalizeSessions([
      ...normalizeSessions(readState()?.sessions),
      ...sessions,
    ]);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sessions, active: session.snapshot() }),
    );
  } catch {
    if (!storageWarning)
      notify(
        "Browser storage is unavailable. This session will not survive a reload.",
      );
    storageWarning = true;
  }
}
function setPose(pose) {
  const paths = {
    hello: "waving hello",
    study: "reading a book",
    celebrate: "celebrating your progress",
  };
  for (const id of ["buddy-image", "quest-robot"]) {
    const img = $(`#${id}`);
    if (img.dataset.pose !== pose) {
      img.src = `/robots/${pose}.png`;
      img.dataset.pose = pose;
      img.alt = `Your ivory cube robot ${paths[pose]}`;
    }
  }
  $("#buddy-image").classList.toggle("studying", pose === "study");
}
function renderProgress() {
  const now = new Date();
  renderedDay = dayKey(now);
  $("#date-label").textContent = now
    .toLocaleDateString("en", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();
  const todaySeconds = sessions
    .filter((s) => dayKey(new Date(s.date)) === renderedDay)
    .reduce((sum, s) => sum + s.seconds, 0);
  const points = sessions.reduce((sum, s) => sum + s.total, 0);
  $("#header-points").textContent = points.toLocaleString();
  $("#focus-total").innerHTML =
    `${Math.floor(todaySeconds / 60)} <small>min</small>`;
  $("#points-total").innerHTML =
    `${points.toLocaleString()} <small>pts</small>`;
  const streak = streakFor(sessions, now);
  $("#streak-total").innerHTML =
    `${streak} <small>${streak === 1 ? "day" : "days"}</small>`;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - 6 + i);
    const minutes = Math.floor(
      sessions
        .filter((s) => dayKey(new Date(s.date)) === dayKey(date))
        .reduce((sum, s) => sum + s.seconds, 0) / 60,
    );
    return { date, minutes };
  });
  const max = Math.max(30, ...days.map((d) => d.minutes));
  $("#week-total").textContent = days.reduce((sum, d) => sum + d.minutes, 0);
  $("#chart").replaceChildren(
    ...days.map(({ date, minutes }, i) => {
      const col = document.createElement("div");
      col.className = `chart-column ${i === 6 ? "today" : ""}`;
      col.innerHTML = `<span class="bar-value">${minutes ? minutes + "m" : "–"}</span><div class="bar-area"><div class="bar" style="height:${(minutes / max) * 100}%"></div></div><span class="day-label">${date.toLocaleDateString("en", { weekday: "short" })}</span>`;
      col.setAttribute(
        "aria-label",
        `${date.toLocaleDateString()}: ${minutes} minutes`,
      );
      return col;
    }),
  );
  $("#session-count").textContent = `${sessions.length} completed`;
  const list = $("#session-list");
  list.replaceChildren();
  if (!sessions.length)
    list.innerHTML =
      '<div class="empty">Your first little win goes here.</div>';
  sessions
    .slice(-3)
    .reverse()
    .forEach((s) => {
      const row = document.createElement("div");
      row.className = "session-row";
      const icon = document.createElement("span");
      icon.className = "session-icon";
      icon.textContent = s.mode === "quest" ? "✦" : "✓";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = s.task;
      const date = document.createElement("small");
      date.textContent = `${Math.floor(s.seconds / 60)} min · ${new Date(s.date).toLocaleDateString([], { month: "short", day: "numeric" })}${s.bonus ? " · mission complete" : ""}`;
      info.append(title, date);
      const reward = document.createElement("span");
      reward.className = "session-points";
      reward.textContent = `+${s.total} pts`;
      row.append(icon, info, reward);
      list.append(row);
    });
  const unlocked = UNLOCKS.filter((item) => points >= item.points);
  const next = UNLOCKS.find((item) => points < item.points);
  const previous = unlocked.at(-1)?.points || 0;
  const percentage = next
    ? Math.min(100, ((points - previous) / (next.points - previous)) * 100)
    : 100;
  $("#level-badge").textContent =
    `Level ${unlocked.length + 1} · ${unlocked.length ? "Making it yours" : "New beginnings"}`;
  $("#room-count").textContent =
    `${unlocked.length} / ${UNLOCKS.length} discoveries`;
  $("#room-next").textContent = next
    ? `Next up: ${next.title.toLowerCase()}.`
    : "Your little study is complete.";
  $("#room-progress-text").textContent = next
    ? `${next.points - points} points to your next discovery.`
    : "Keep studying. Every session still earns points.";
  $("#room-progress-fill").style.width = `${percentage}%`;
  $(".room-progress").setAttribute(
    "aria-valuenow",
    String(Math.round(percentage)),
  );
  $$("[data-room-item]").forEach(
    (el) =>
      (el.hidden = !unlocked.some((item) => item.id === el.dataset.roomItem)),
  );
  $("#unlock-grid").replaceChildren(
    ...UNLOCKS.map((item) => {
      const isUnlocked = points >= item.points;
      const card = document.createElement("article");
      card.className = `unlock-card${isUnlocked ? " unlocked" : ""}`;
      card.innerHTML = `<span class="lock-indicator">${isUnlocked ? "✓ Yours" : "Locked"}</span><span class="unlock-symbol" aria-hidden="true">${item.symbol}</span><h3>${item.title}</h3><p>${isUnlocked ? "In your room" : `${item.points} points`}</p>`;
      return card;
    }),
  );
}
const timeText = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
function renderTimer() {
  const active = session.active;
  const remaining = active
    ? Math.ceil(active.duration - session.elapsed())
    : focusMinutes * 60;
  $("#timer").textContent = timeText(remaining);
  $("#start").textContent = session.running
    ? "Ⅱ Pause"
    : active
      ? "▶ Resume"
      : "▶ Start focusing";
  $("#finish").disabled = !active;
  $("#focus-state").textContent = active
    ? active.mode === "quest"
      ? "Focus Quest"
      : "Focus session"
    : "Ready when you are";
  $("#timer-subtitle").textContent = session.running
    ? "One thing at a time."
    : active
      ? "Paused. Take your time."
      : "A fresh start.";
  $("#task").disabled = !!active;
  $("#quest-task").disabled = !!active;
  if (active) {
    $("#task").value = active.task;
    $("#quest-task").value = active.task;
  }
  $$("[data-duration]").forEach((b) => {
    b.disabled = !!active;
    b.setAttribute(
      "aria-pressed",
      String(
        Number(b.dataset.duration) ===
          (active ? active.duration / 60 : focusMinutes),
      ),
    );
  });
  $$("[data-mission]").forEach((b) => {
    b.disabled = !!active;
    b.setAttribute(
      "aria-pressed",
      String(
        Number(b.dataset.mission) ===
          (active?.mode === "quest" ? active.duration / 60 : missionMinutes),
      ),
    );
  });
  $("#quest-live").hidden = !active;
  $("#quest-countdown").textContent = timeText(remaining);
  $("#quest-live-label").textContent = !session.running
    ? "Paused · take your time"
    : active?.mode === "quest"
      ? "Mission in progress"
      : "Focus session in progress";
  $("#quest-start").textContent = active
    ? session.running
      ? "Ⅱ Pause session"
      : "▶ Resume session"
    : "Start mission →";
  $("#quest-finish").hidden = !active;
  $("#mission-note").textContent =
    active?.mode === "focus"
      ? "Finish this session before starting a mission."
      : "Finish the full timer to earn your bonus.";
  setPose(session.running ? "study" : celebrated ? "celebrate" : "hello");
  $("#buddy-title").innerHTML = session.running
    ? "A little less scrolling.<br>A little more doing."
    : active
      ? "A breather is good.<br>I’ll be right here."
      : celebrated
        ? "Look at you go.<br>That’s a little win."
        : "You bring the ideas.<br>I’ll bring the company.";
}
function toggleTimer(mode) {
  if (session.running) session.pause();
  else if (session.active) session.resume();
  else {
    celebrated = false;
    const minutes = mode === "quest" ? missionMinutes : focusMinutes;
    const task =
      $(mode === "quest" ? "#quest-task" : "#task").value.trim() ||
      (mode === "quest" ? MISSIONS[minutes].title : "Focused work");
    session.start({ id: crypto.randomUUID(), task, minutes, mode });
  }
  persist();
  renderTimer();
}
function finishSession() {
  if (!session.active) return;
  const result = session.finish();
  if (result) {
    sessions = normalizeSessions([...sessions, result]);
    celebrated = true;
    persist();
    renderProgress();
    renderTimer();
    $("#result-title").textContent = result.bonus
      ? "Mission complete."
      : "You showed up.";
    $("#result-copy").textContent =
      `${Math.floor(result.seconds / 60)} ${result.seconds < 120 ? "minute" : "minutes"} of focus${result.bonus ? ` + ${result.bonus} bonus points` : ""}.`;
    $("#result-points").textContent = `+${result.total} points`;
    $("#session-result").showModal();
  } else {
    persist();
    renderTimer();
    notify("Session ended. Complete one minute to earn points.");
  }
}
$("#start").addEventListener("click", () => toggleTimer("focus"));
$("#quest-start").addEventListener("click", () => toggleTimer("quest"));
$("#finish").addEventListener("click", finishSession);
$("#quest-finish").addEventListener("click", finishSession);
$$("[data-duration]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!session.active) {
      focusMinutes = Number(b.dataset.duration);
      renderTimer();
    }
  }),
);
$$("[data-mission]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!session.active) {
      missionMinutes = Number(b.dataset.mission);
      renderTimer();
    }
  }),
);
$$("[data-direction]").forEach((b) =>
  b.addEventListener("click", () => {
    $("#pose-robot").dataset.direction = b.dataset.direction;
    $("#pose-robot").alt = `Robot tilted ${b.dataset.direction}`;
    $$("[data-direction]").forEach((button) =>
      button.setAttribute("aria-pressed", String(button === b)),
    );
  }),
);
function renderPage(scroll = true) {
  const page = ["dashboard", "quest", "stickers"].includes(
    location.hash.slice(1),
  )
    ? location.hash.slice(1)
    : "dashboard";
  $$(".page").forEach((el) => (el.hidden = el.id !== `page-${page}`));
  $$("[data-page]").forEach((link) => {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
}
window.addEventListener("hashchange", () => renderPage());
$("#result-done").addEventListener("click", () => $("#session-result").close());
$(".dialog-close").addEventListener("click", () =>
  $("#session-result").close(),
);
window.addEventListener("pagehide", persist);
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    sessions = normalizeSessions([
      ...normalizeSessions(readState()?.sessions),
      ...sessions,
    ]);
    renderProgress();
  }
});
setInterval(() => {
  if (session.running && session.elapsed() >= session.active.duration)
    finishSession();
  else renderTimer();
  if (renderedDay !== dayKey(new Date())) renderProgress();
}, 250);
setInterval(() => {
  if (session.active) persist();
}, 5000);
renderProgress();
renderTimer();
renderPage(false);
if (restored)
  notify("Your session was restored paused. Resume whenever you’re ready.");
