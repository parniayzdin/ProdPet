import {
  FocusSession,
  MISSIONS,
  UNLOCKS,
  normalizeSessions,
  dayKey,
  streakFor,
} from "./focus.js";
import { initFriends } from "./friends.js";
import { initRobot, studyEmotion } from "./robot.js";
import {
  fetchFocusQuality,
  fetchUserStats,
  postCompletedSession,
  postPresence,
} from "./api.js";

export function startDashboard(account, serverSessions, api) {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const STORAGE_KEY = `productivity.workspace.account.${account.id}`;
  const session = new FocusSession();
  let sessions = [];
  let focusMinutes = 25;
  let missionMinutes = 5;
  let celebrated = false;
  let storageWarning = false;
  let renderedDay = dayKey(new Date());
  let raceActive = false;
  let raceFocused = false;
  const robot = initRobot(notify);
  let suspended = false;
  let syncing = null;
  let syncWarning = false;
  let serverStats = null;
  let lastPresenceSent = 0;
  let lastPresenceRunning = false;
  const synced = new Set(normalizeSessions(serverSessions).map((s) => s.id));

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
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  const saved = readState();
  sessions = normalizeSessions([
    ...normalizeSessions(saved?.sessions),
    ...normalizeSessions(serverSessions),
  ]);
  const restored = session.restore(saved?.active);
  function persist(sync = true) {
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
    if (sync && !suspended) void syncProgress();
  }
  async function refreshStats() {
    try {
      serverStats = await fetchUserStats();
      renderProgress();
    } catch (error) {
      console.warn("Could not load account stats", error);
    }
  }
  async function refreshDeskQuality() {
    const el = $("#desk-quality");
    if (!el) return;
    try {
      const sid = session.active?.id;
      const quality = await fetchFocusQuality(sid);
      el.innerHTML = `${quality.at_desk_percent} <small>%</small>`;
    } catch {
      /* Keep previous value if API is unavailable. */
    }
  }
  async function sendPresenceTick(present) {
    if (!session.active?.id) return;
    try {
      await postPresence({
        sessionId: session.active.id,
        present,
        source: "timer",
      });
      lastPresenceSent = Date.now();
      void refreshDeskQuality();
    } catch (error) {
      console.warn("presence tick failed", error);
    }
  }
  async function syncProgress() {
    if (syncing) return syncing;
    if (suspended) return;
    syncing = (async () => {
      try {
        const pending = sessions.filter((s) => !synced.has(s.id));
        for (const s of pending) {
          if (suspended) break;
          await postCompletedSession(s);
          synced.add(s.id);
        }
        $("#save-status").textContent = "Progress saved to your account";
        syncWarning = false;
        await refreshStats();
      } catch (error) {
        $("#save-status").textContent =
          "Saved on this device · waiting to sync";
        if (!syncWarning && error.status !== 401)
          notify("Progress is saved on this device. Account sync will retry.");
        syncWarning = true;
      }
    })();
    await syncing;
    syncing = null;
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
    const localTodaySeconds = sessions
      .filter((s) => dayKey(new Date(s.date)) === renderedDay)
      .reduce((sum, s) => sum + s.seconds, 0);
    const localPoints = sessions.reduce((sum, s) => sum + s.total, 0);
    // Stats daily buckets are UTC (Tiger time_bucket).
    const todayKey = now.toISOString().slice(0, 10);
    const todayStat = serverStats?.daily?.find((d) => d.date === todayKey);
    const todayMinutes =
      todayStat != null
        ? todayStat.focus_minutes
        : Math.floor(localTodaySeconds / 60);
    const points =
      serverStats != null ? serverStats.total_points : localPoints;
    $("#header-points").textContent = points.toLocaleString();
    $("#focus-total").innerHTML = `${todayMinutes} <small>min</small>`;
    $("#points-total").innerHTML =
      `${points.toLocaleString()} <small>pts</small>`;
    const streak = streakFor(sessions, now);
    $("#streak-total").innerHTML =
      `${streak} <small>${streak === 1 ? "day" : "days"}</small>`;
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - 6 + i,
        ),
      );
      const iso = date.toISOString().slice(0, 10);
      const fromServer = serverStats?.daily?.find((d) => d.date === iso);
      const minutes =
        fromServer != null
          ? fromServer.focus_minutes
          : Math.floor(
              sessions
                .filter((s) => s.date.slice(0, 10) === iso)
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
    const sessionCount =
      serverStats != null ? serverStats.completed_sessions : sessions.length;
    $("#session-count").textContent = `${sessionCount} completed`;
    const list = $("#session-list");
    list.replaceChildren();
    if (!sessions.length)
      list.innerHTML = '<div class="empty">No sessions yet.</div>';
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
    // Quest unlocks still use the richer local session total when present.
    const unlockPoints = Math.max(points, localPoints);
    const unlocked = UNLOCKS.filter((item) => unlockPoints >= item.points);
    const next = UNLOCKS.find((item) => item.points > unlockPoints);
    const previous = unlocked.at(-1)?.points || 0;
    const percentage = next
      ? Math.min(
          100,
          ((unlockPoints - previous) / (next.points - previous)) * 100,
        )
      : 100;
    $("#level-badge").textContent =
      `Level ${unlocked.length + 1} · ${unlocked.length ? "Making it yours" : "New beginnings"}`;
    $("#room-count").textContent =
      `${unlocked.length} / ${UNLOCKS.length} unlocked`;
    $("#room-next").textContent = next
      ? `Next: ${next.title.toLowerCase()}`
      : "All decorations unlocked";
    $("#room-progress-text").textContent = next
      ? `${next.points - unlockPoints} more points to unlock.`
      : "Your room is complete.";
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
        const isUnlocked = unlockPoints >= item.points;
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
    robot.setEmotion(
      studyEmotion({
        running: session.running,
        active: !!active,
        celebrating: celebrated,
        raceActive,
        raceFocused,
      }),
    );
    $("#start").disabled = raceActive && !active;
    $("#quest-start").disabled = raceActive && !active;
    const remaining = active
      ? Math.ceil(active.duration - session.elapsed())
      : focusMinutes * 60;
    $("#timer").textContent = timeText(remaining);
    $("#start").textContent = session.running
      ? "Ⅱ Pause"
      : active
        ? "▶ Resume"
        : raceActive
          ? "Race in progress"
          : "▶ Start focusing";
    $("#finish").disabled = !active;
    $("#focus-state").textContent = active
      ? active.mode === "quest"
        ? "Focus Quest"
        : "Focus session"
      : raceActive
        ? "Friends race"
        : "Ready";
    $("#timer-subtitle").textContent = session.running
      ? "Focusing"
      : active
        ? "Paused"
        : raceActive
          ? "Continue on Friends"
          : "Ready";
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
      : raceActive
        ? "Race in progress"
        : "Start mission →";
    $("#quest-finish").hidden = !active;
    $("#mission-note").textContent =
      active?.mode === "focus"
        ? "Finish this session before starting a mission."
        : raceActive
          ? "Your race is on the Friends page."
          : "Finish the full timer to earn your bonus.";
    setPose(session.running ? "study" : celebrated ? "celebrate" : "hello");
    $("#buddy-title").innerHTML = session.running
      ? "Focusing"
      : active
        ? "On a break"
        : celebrated
          ? "Session complete"
          : "Ready to study";
  }
  function toggleTimer(mode) {
    if (suspended) return;
    if (raceActive && !session.active)
      return notify("Finish your friend race first.");
    if (session.running) session.pause();
    else if (session.active) session.resume();
    else {
      celebrated = false;
      const minutes = mode === "quest" ? missionMinutes : focusMinutes;
      const task =
        $(mode === "quest" ? "#quest-task" : "#task").value.trim() ||
        (mode === "quest" ? MISSIONS[minutes].title : "Focused work");
      const id =
        crypto.randomUUID?.() ||
        [...crypto.getRandomValues(new Uint8Array(16))]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      session.start({ id, task, minutes, mode });
    }
    persist();
    renderTimer();
  }
  function finishSession() {
    if (suspended) return;
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
  function renderPage(scroll = true) {
    const page = ["dashboard", "quest", "friends", "stickers"].includes(
      location.hash.slice(1).split("?")[0],
    )
      ? location.hash.slice(1).split("?")[0]
      : "dashboard";
    $$(".page").forEach((el) => (el.hidden = el.id !== `page-${page}`));
    $$("[data-page]").forEach((link) => {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
  }
  window.addEventListener("hashchange", () => renderPage());
  $("#result-done").addEventListener("click", () =>
    $("#session-result").close(),
  );
  $(".dialog-close").addEventListener("click", () =>
    $("#session-result").close(),
  );
  window.addEventListener("pagehide", () => persist(false));
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
    if (suspended) return;
    if (session.running && session.elapsed() >= session.active.duration)
      finishSession();
    else renderTimer();
    if (renderedDay !== dayKey(new Date())) renderProgress();

    // Tiger presence stream: tick while running; one "away" tick on pause.
    if (session.running && session.active) {
      lastPresenceRunning = true;
      if (Date.now() - lastPresenceSent >= 10000) void sendPresenceTick(true);
    } else if (lastPresenceRunning && session.active) {
      lastPresenceRunning = false;
      void sendPresenceTick(false);
    }
  }, 250);
  setInterval(() => {
    if (session.active && !suspended) persist();
  }, 5000);
  setInterval(() => {
    if (!suspended) void syncProgress();
  }, 15000);
  renderProgress();
  renderTimer();
  renderPage(false);
  void refreshStats();
  if (restored)
    notify("Your session was restored paused. Resume whenever you’re ready.");

  const friends = initFriends({
    account,
    api,
    isBusy: () => !!session.active,
    onActive: (active, focused = false) => {
      raceActive = active;
      raceFocused = focused;
      renderTimer();
    },
    onAward: (result) => {
      if (sessions.some((s) => s.id === result.id)) return;
      sessions = normalizeSessions([...sessions, result]);
      persist();
      renderProgress();
      celebrated = true;
      renderTimer();
    },
    notify,
  });
  void syncProgress();
  return {
    flush: syncProgress,
    suspend() {
      suspended = true;
      session.pause();
      persist(false);
      friends.stop();
      void robot.disconnect();
    },
  };
}
