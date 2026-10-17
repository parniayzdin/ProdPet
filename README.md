# Productivity

A responsive dashboard for focused work, points, and daily progress.

## Run

```sh
npm install
npm run dev
```

Create a production build with `npm run build`, then run `npm run preview` to preview it.

## Current features

- 15, 25, and 50-minute sessions with start, pause, resume, and early finish.
- 10 points per whole minute in a completed session. Sessions shorter than a minute earn no points.
- Today's focus time, a 120-minute daily goal, daily streaks, and a seven-day chart.
- Recent sessions and cumulative reward milestones, saved in browser local storage.
- Responsive layout and keyboard-accessible controls.

Tracking is manual: the timer measures self-reported focus time, not verified productivity. Pause it during breaks. Only completed sessions are persisted; leaving during a session prompts a warning. Data is local to this browser and is not synced between devices or tabs.

Webcam AI and robot sounds/vibration are not connected yet. No camera permission is requested and no video is collected. The companion panel is a placeholder for the later hardware integration.

## Structure

- `index.html`: dashboard layout
- `src/style.css`: responsive styling
- `src/main.js`: timer, rewards, chart, and local persistence

Fonts are loaded from Google Fonts, with system fallbacks if offline.
