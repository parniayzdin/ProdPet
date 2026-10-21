const $ = (selector) => document.querySelector(selector);
let account = null;
let dashboard = null;
let signup = false;
let busy = false;
let expired = false;

export async function api(path, data, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: data === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Productivity",
        ...(account ? { "X-Account-ID": account.id } : {}),
        ...options.headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(
      "Cannot reach the server. Check your connection and try again.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "The account server is unavailable. Start it with npm start, then retry.",
    );
  }
  if (!response.ok) {
    if (result.code === "AUTH_REQUIRED" && account) expire();
    const error = new Error(
      result.error || "Something went wrong. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return result;
}

function message(text = "", retry = false) {
  $("#auth-message").textContent = text;
  $("#auth-retry").hidden = !retry;
}
function setBusy(value) {
  busy = value;
  $("#auth-form")
    .querySelectorAll("button,input")
    .forEach((el) => (el.disabled = value));
  $("#auth-switch").disabled = value;
  $("#auth-retry").disabled = value;
}
function expire() {
  if (expired) return;
  expired = true;
  dashboard?.suspend();
  $("#session-result").close();
  $("#app-shell").hidden = true;
  $("#auth-screen").hidden = false;
  $("#announcement").classList.remove("visible");
  $("#auth-password").value = "";
  $("#auth-confirm").value = "";
  message("Your session ended or your account changed. Log in to continue.");
}
function announceAccountChange() {
  try {
    localStorage.setItem("productivity.auth.changed", String(Date.now()));
  } catch {
    /* Cookie still controls access. */
  }
}
async function launch(user) {
  if (dashboard) {
    location.reload();
    return;
  }
  account = user;
  const progress = await api("/api/progress");
  const { startDashboard } = await import("./main.js");
  dashboard = startDashboard(user, progress.sessions, api);
  $("#account-name").textContent = `@${user.username}`;
  $("#auth-form").reset();
  $("#auth-screen").hidden = true;
  $("#app-shell").hidden = false;
  expired = false;
}
$("#auth-switch").addEventListener("click", () => {
  signup = !signup;
  $("#auth-title").textContent = signup
    ? "Create your account"
    : "Welcome back";
  $(".auth-intro").textContent = signup
    ? "Make room for your progress."
    : "Log in to save your progress.";
  $("#auth-submit").textContent = signup ? "Sign up" : "Log in";
  $("#auth-switch").textContent = signup
    ? "Already have an account? Log in"
    : "New here? Sign up";
  $("#auth-confirm-wrap").hidden = !signup;
  $("#auth-confirm").required = signup;
  $("#auth-password").minLength = signup ? 15 : 1;
  $("#auth-password").autocomplete = signup
    ? "new-password"
    : "current-password";
  $("#password-hint").hidden = !signup;
  $("#auth-password").value = "";
  $("#auth-confirm").value = "";
  message();
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const password = $("#auth-password").value;
  if (signup && password !== $("#auth-confirm").value)
    return message("The passwords do not match.");
  setBusy(true);
  message();
  try {
    const { user } = await api(`/api/auth/${signup ? "signup" : "login"}`, {
      username: $("#auth-username").value,
      password,
    });
    announceAccountChange();
    await launch(user);
  } catch (error) {
    message(error.message, !error.status || error.status >= 500);
  } finally {
    setBusy(false);
  }
});
$("#account-logout").addEventListener("click", async () => {
  $("#account-logout").disabled = true;
  try {
    await dashboard?.flush();
    await api("/api/auth/logout", {});
    dashboard?.suspend();
    announceAccountChange();
    $("#app-shell").hidden = true;
    location.reload();
  } catch (error) {
    $("#announcement").textContent = error.message;
    $("#announcement").classList.add("visible");
  } finally {
    $("#account-logout").disabled = false;
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === "productivity.auth.changed") {
    expire();
    location.reload();
  }
});
// Recheck both active tabs and tabs returning from the background.
async function checkSession() {
  if (document.hidden || !dashboard || expired) return;
  try {
    const result = await api("/api/auth/session");
    if (result.user.id !== account.id) expire();
  } catch (error) {
    if (error.status === 401) expire();
  }
}
document.addEventListener("visibilitychange", checkSession);
setInterval(checkSession, 60000);
async function restore() {
  if (busy) return;
  setBusy(true);
  message("Checking your session…");
  try {
    const result = await api("/api/auth/session");
    await launch(result.user);
    message();
  } catch (error) {
    if (error.status === 401) {
      account = null;
      message();
    } else message(error.message, !error.status || error.status >= 500);
  } finally {
    setBusy(false);
  }
}
$("#auth-retry").addEventListener("click", restore);
restore();
