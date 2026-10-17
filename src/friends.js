const $ = (selector) => document.querySelector(selector);
const SESSION_KEY = "productivity.race.v1";
const clockText = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export function initFriends({ isBusy, onActive, onAward, notify }) {
  let credentials = null;
  let room = null;
  let focused = false;
  let connected = false;
  let polling = false;
  let busy = false;
  let offset = 0;
  let lastSnapshot = 0;
  let generation = 0;
  try {
    credentials = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    /* Browser storage may be unavailable. */
  }
  if (!credentials?.code || !credentials?.token) credentials = null;

  function error(message = "") {
    $("#race-error").textContent = message;
    $("#race-error").hidden = !message;
  }
  function remember() {
    try {
      if (credentials)
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(credentials));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      notify("This room will need to be rejoined if you reload.");
    }
  }
  async function request(path, data, auth = credentials) {
    let response;
    try {
      response = await fetch(`/api/rooms${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(7000),
      });
    } catch {
      throw new Error(
        "Race server unavailable. Check your connection; focus tracking is paused.",
      );
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Start the race server with npm start, then try again.");
    }
    if (!response.ok) {
      const e = new Error(result.error || "Could not update the room.");
      e.status = response.status;
      throw e;
    }
    return result;
  }
  function apply(next) {
    if (next.serverNow < lastSnapshot) return;
    if (room?.status === "lobby" && next.status === "running")
      focused = !isBusy();
    lastSnapshot = next.serverNow;
    offset = next.serverNow - Date.now();
    room = next;
    connected = true;
    onActive(room.status === "running");
    if (room.status === "finished") {
      focused = false;
      const me = room.players.find((p) => p.id === room.meId);
      if (me && !me.left && me.seconds >= 60)
        onAward({
          id: `race-${room.code}-${me.id}`,
          task: `Study race · ${room.code}`,
          seconds: me.seconds,
          duration: room.minutes * 60,
          mode: "focus",
          date: new Date(room.endsAt).toISOString(),
        });
    }
    render();
  }
  function renderClock() {
    if (!room) return;
    const now = Date.now() + offset;
    $("#race-clock").textContent =
      room.status === "lobby"
        ? clockText(room.minutes * 60)
        : room.status === "finished"
          ? "Finished"
          : now < room.startsAt
            ? `Starts in ${Math.ceil((room.startsAt - now) / 1000)}`
            : clockText(Math.max(0, Math.ceil((room.endsAt - now) / 1000)));
  }
  function render() {
    $("#race-setup").hidden = !!credentials;
    $("#race-room").hidden = !room;
    if (!room) return;
    const me = room.players.find((p) => p.id === room.meId);
    const lobby = room.status === "lobby";
    const running = room.status === "running";
    const finished = room.status === "finished";
    $("#race-room-code").textContent = room.code;
    $("#race-status").textContent = !connected
      ? "Reconnecting · paused"
      : lobby
        ? "Waiting for friends"
        : finished
          ? "Race complete"
          : focused
            ? "Focusing"
            : "Paused";
    $("#race-player-count").textContent =
      `${room.players.filter((p) => !p.left).length} / 8 friends`;
    $("#race-ready").hidden = !lobby;
    $("#race-ready").disabled = busy || !connected;
    $("#race-ready").textContent = me?.ready ? "✓ Ready · undo" : "I’m ready";
    $("#race-host-start").hidden = !lobby || room.hostId !== room.meId;
    $("#race-host-start").disabled =
      busy ||
      !connected ||
      room.players.length < 2 ||
      room.players.some((p) => !p.ready || !p.online) ||
      isBusy();
    $("#race-focus").hidden = !running;
    $("#race-focus").disabled = busy || !connected;
    $("#race-focus").textContent = focused ? "Pause focus" : "Resume focus";
    $("#race-leave").disabled = busy;
    $("#race-hint").textContent = lobby
      ? isBusy()
        ? "Finish your current focus session before getting ready."
        : "Everyone must be ready. The host starts the race."
      : running
        ? "Pause when you take a break."
        : "Leave this room to start another race.";
    $("#race-result").hidden = !finished;
    if (finished) {
      const winners = room.players.filter((p) => room.winnerIds.includes(p.id));
      $("#race-winner").textContent = !winners.length
        ? "No winner this time."
        : winners.length > 1
          ? `It’s a tie: ${winners.map((p) => p.name).join(", ")}`
          : `${winners[0].name} wins!`;
      $("#race-result-copy").textContent = me
        ? `Your focus time: ${clockText(me.seconds)} · +${Math.floor(me.seconds / 60) * 10} points`
        : "";
    }
    $("#race-standings").replaceChildren(
      ...room.players.map((p, index) => {
        const row = document.createElement("li");
        row.className = `race-player${p.id === room.meId ? " is-you" : ""}`;
        const rank = document.createElement("span");
        rank.className = "race-rank";
        rank.textContent = room.winnerIds.includes(p.id)
          ? "★"
          : String(index + 1);
        const avatar = document.createElement("img");
        avatar.src = `/robots/${room.winnerIds.includes(p.id) ? "celebrate" : p.focused ? "study" : "hello"}.png`;
        avatar.alt = "";
        avatar.width = 58;
        avatar.height = 58;
        const info = document.createElement("div");
        info.className = "race-person";
        const name = document.createElement("strong");
        name.textContent = `${p.name}${p.id === room.meId ? " (you)" : ""}${p.id === room.hostId ? " · host" : ""}`;
        const state = document.createElement("span");
        state.textContent = p.left
          ? "Left the race"
          : finished
            ? "Finished"
            : !p.online
              ? "Disconnected"
              : lobby
                ? p.ready
                  ? "Ready"
                  : "Getting ready"
                : p.focused
                  ? "Focusing"
                  : "Paused";
        info.append(name, state);
        const track = document.createElement("div");
        track.className = "race-track";
        track.setAttribute("aria-hidden", "true");
        const bar = document.createElement("span");
        bar.style.width = `${Math.min(100, (p.seconds / (room.minutes * 60)) * 100)}%`;
        track.append(bar);
        const time = document.createElement("strong");
        time.className = "race-time";
        time.textContent = clockText(p.seconds);
        row.append(rank, avatar, info, track, time);
        return row;
      }),
    );
    renderClock();
  }
  async function enter(path, data) {
    if (busy) return;
    busy = true;
    error();
    $("#race-setup")
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = true));
    try {
      const result = await request(path, data, null);
      generation++;
      lastSnapshot = 0;
      focused = false;
      credentials = { code: result.room.code, token: result.token };
      remember();
      apply(result.room);
      location.hash = `friends?room=${result.room.code}`;
    } catch (e) {
      error(e.message);
    } finally {
      busy = false;
      $("#race-setup")
        .querySelectorAll("button")
        .forEach((b) => (b.disabled = false));
      render();
    }
  }
  async function action(name, data) {
    if (busy || !credentials) return;
    busy = true;
    render();
    error();
    const requestGeneration = generation;
    try {
      const result = await request(`/${credentials.code}/${name}`, data || {});
      if (requestGeneration !== generation) return;
      if (name === "leave") {
        generation++;
        credentials = null;
        room = null;
        focused = false;
        lastSnapshot = 0;
        remember();
        onActive(false);
        location.hash = "friends";
      } else apply(result.room);
    } catch (e) {
      if (name === "heartbeat") {
        connected = false;
        focused = false;
      }
      error(e.message);
    } finally {
      busy = false;
      render();
      if (name === "start") poll();
    }
  }
  async function poll() {
    if (!credentials || polling || busy) return;
    polling = true;
    const requestGeneration = generation;
    const sentFocus = focused;
    let synchronizeFocus = false;
    try {
      const result = await request(`/${credentials.code}/heartbeat`, {
        focused,
      });
      if (requestGeneration !== generation) return;
      error();
      apply(result.room);
      // A guest discovering the countdown should enable focus immediately,
      // before the shared start, rather than wait for another polling interval.
      synchronizeFocus = !sentFocus && focused;
    } catch (e) {
      if (requestGeneration !== generation) return;
      connected = false;
      focused = false;
      error(e.message);
      if ([401, 404].includes(e.status)) {
        generation++;
        credentials = null;
        room = null;
        remember();
        onActive(false);
      }
      render();
    } finally {
      polling = false;
      if (synchronizeFocus) poll();
    }
  }
  $("#race-create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    enter("", {
      name: $("#race-name").value,
      minutes: Number($("#race-duration").value),
    });
  });
  $("#race-join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    enter(`/${$("#race-code").value.trim().toUpperCase()}/join`, {
      name: $("#join-name").value,
    });
  });
  $("#race-ready").addEventListener("click", () => {
    const me = room.players.find((p) => p.id === room.meId);
    if (!me.ready && isBusy())
      return error("Finish your current focus session first.");
    action("ready", { ready: !me.ready });
  });
  $("#race-host-start").addEventListener("click", () => action("start"));
  $("#race-focus").addEventListener("click", () => {
    if (!focused && isBusy())
      return error("Finish your personal focus session first.");
    focused = !focused;
    action("heartbeat", { focused });
  });
  $("#race-leave").addEventListener("click", () => {
    if (
      room?.status === "running" &&
      !window.confirm(
        "Leave this race? You will forfeit the race and its unsaved points.",
      )
    )
      return;
    action("leave");
  });
  $("#race-copy").addEventListener("click", async () => {
    const invite = `${location.origin}/#friends?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(invite);
      notify("Invite copied. Friends need access to this same server.");
    } catch {
      notify(
        `Room code: ${room.code}. Share this page’s address with your friends.`,
      );
    }
  });
  function fillInvite() {
    const code = new URLSearchParams(location.hash.split("?")[1]).get("room");
    if (code && /^[A-F0-9]{6}$/i.test(code))
      $("#race-code").value = code.toUpperCase();
  }
  window.addEventListener("hashchange", fillInvite);
  window.addEventListener("pagehide", () => {
    if (credentials)
      fetch(`/api/rooms/${credentials.code}/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.token}`,
        },
        body: JSON.stringify({ focused: false }),
        keepalive: true,
      }).catch(() => {});
  });
  fillInvite();
  render();
  poll();
  setInterval(poll, 2000);
  setInterval(renderClock, 250);
}
