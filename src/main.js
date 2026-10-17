const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'productivity.sessions.v1';
let sessions = [];
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(saved)) sessions = saved.filter(s => s && typeof s.task === 'string' && Number.isFinite(s.seconds) && s.seconds >= 60 && s.seconds <= 3000 && Number.isFinite(new Date(s.date).getTime())).map(s => ({ ...s, points: Math.floor(s.seconds / 60) * 10 }));
} catch { /* Start fresh if browser storage is unavailable or invalid. */ }
let duration = 25 * 60;
let elapsed = 0;
let startedAt = null;
let selectedTask = '';
const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const secondsNow = () => Math.min(duration, elapsed + (startedAt === null ? 0 : (performance.now() - startedAt) / 1000));
const notify = (message) => {
  $('#announcement').textContent = message;
  $('#announcement').classList.add('visible');
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => $('#announcement').classList.remove('visible'), 5000);
};

function renderStats() {
  const now = new Date();
  const today = sessions.filter(s => dayKey(new Date(s.date)) === dayKey(now));
  const minutes = Math.floor(today.reduce((sum, s) => sum + s.seconds, 0) / 60);
  const points = sessions.reduce((sum, s) => sum + s.points, 0);
  $('#focus-total').textContent = `${minutes}m`;
  $('#points-total').innerHTML = `${points.toLocaleString()} <small>pts</small>`;
  $('#goal-total').innerHTML = `${minutes}<small> / 120 min</small>`;
  $('#goal-bar').style.width = `${Math.min(100, minutes / 120 * 100)}%`;
  const activeDays = new Set(sessions.map(s => dayKey(new Date(s.date))));
  let streak = 0;
  const cursor = new Date(now);
  if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDays.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  $('#streak-total').innerHTML = `${streak} <small>${streak === 1 ? 'day' : 'days'}</small>`;
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now); date.setDate(date.getDate() - 6 + i);
    return { date, minutes: Math.floor(sessions.filter(s => dayKey(new Date(s.date)) === dayKey(date)).reduce((sum, s) => sum + s.seconds, 0) / 60) };
  });
  const max = Math.max(30, ...days.map(d => d.minutes));
  $('#chart').replaceChildren(...days.map(({ date, minutes }, i) => {
    const column = document.createElement('div'); column.className = `chart-column ${i === 6 ? 'today' : ''}`;
    column.innerHTML = `<span class="bar-value">${minutes}m</span><div class="bar-area"><div class="bar" style="height:${minutes / max * 100}%"></div></div><span class="day-label">${date.toLocaleDateString('en', { weekday: 'short' })}</span>`;
    column.setAttribute('aria-label', `${date.toLocaleDateString()}: ${minutes} focused minutes`);
    return column;
  }));
  $('#week-total').textContent = days.reduce((sum, d) => sum + d.minutes, 0);
  const list = $('#session-list'); list.replaceChildren();
  if (!sessions.length) list.innerHTML = '<div class="empty"><span>◷</span><strong>Your first session starts here</strong><p>Finish a minute of focused work to see your progress.</p></div>';
  sessions.slice().reverse().slice(0, 5).forEach(s => {
    const row = document.createElement('div'); row.className = 'session-row';
    const icon = document.createElement('span'); icon.className = 'session-icon'; icon.textContent = '✓';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = s.task;
    const date = document.createElement('small'); date.textContent = `${new Date(s.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${Math.floor(s.seconds / 60)} min`;
    info.append(title, date);
    const reward = document.createElement('span'); reward.className = 'session-points'; reward.textContent = `+${s.points} pts`;
    row.append(icon, info, reward); list.append(row);
  });
  const levels = [{ points: 0, name: 'Finding your rhythm' }, { points: 100, name: 'First Spark' }, { points: 500, name: 'Building Momentum' }, { points: 1500, name: 'In the Zone' }, { points: 5000, name: 'Focus Champion' }];
  const current = levels.filter(l => points >= l.points).at(-1);
  const next = levels.find(l => l.points > points);
  $('#level-name').textContent = current.name;
  $('#reward-copy').textContent = next ? `${next.points - points} more points until ${next.name}.` : 'Your consistency is paying off. Keep going!';
  $('#reward-progress').style.width = next ? `${(points - current.points) / (next.points - current.points) * 100}%` : '100%';
  $('#reward-points').textContent = next ? `${points.toLocaleString()} / ${next.points.toLocaleString()} pts` : `${points.toLocaleString()} pts`;
  $('#next-level').textContent = next ? `${next.name} ↗` : 'Top milestone reached';
}

function renderTimer() {
  const remaining = Math.ceil(duration - secondsNow());
  $('#timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  $('#ring-progress').style.strokeDashoffset = 616 * (secondsNow() / duration);
  $('#start').textContent = startedAt !== null ? 'Ⅱ Pause session' : elapsed > 0 ? '▶ Resume session' : '▶ Start focusing';
  $('#finish').disabled = startedAt === null && elapsed === 0;
  $('#task').disabled = startedAt !== null || elapsed > 0;
  document.querySelectorAll('[data-minutes]').forEach(b => b.disabled = startedAt !== null || elapsed > 0);
  $('#timer-caption').textContent = startedAt !== null ? 'You’re making room for good work' : elapsed > 0 ? 'Paused. Take the time you need.' : 'A little focus goes a long way';
}

function finishSession() {
  const seconds = Math.floor(secondsNow());
  startedAt = null; elapsed = 0;
  if (seconds >= 60) {
    const points = Math.floor(seconds / 60) * 10;
    sessions.push({ task: selectedTask, seconds, points, date: new Date().toISOString() });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); notify(`Session saved. +${points} points. Nice work!`); }
    catch { notify('Session counted, but browser storage is unavailable. It will be lost on reload.'); }
  } else notify('Session ended. Focus for at least one minute to earn points.');
  renderStats(); renderTimer();
}

$('#start').addEventListener('click', () => {
  if (startedAt !== null) { elapsed = secondsNow(); startedAt = null; }
  else {
    if (elapsed === 0) selectedTask = $('#task').value.trim() || 'Focused work';
    startedAt = performance.now();
  }
  renderTimer();
});
$('#finish').addEventListener('click', finishSession);
document.querySelectorAll('[data-minutes]').forEach(button => {
  button.setAttribute('aria-pressed', String(button.classList.contains('selected')));
  button.addEventListener('click', () => {
    if (startedAt !== null || elapsed > 0) return;
    duration = Number(button.dataset.minutes) * 60;
    document.querySelectorAll('[data-minutes]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    renderTimer();
  });
});
window.addEventListener('beforeunload', event => {
  if (startedAt !== null || elapsed > 0) { event.preventDefault(); event.returnValue = ''; }
});
$('#date-label').textContent = new Date().toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
setInterval(() => { if (startedAt !== null && secondsNow() >= duration) finishSession(); else renderTimer(); }, 250);
renderStats(); renderTimer();
