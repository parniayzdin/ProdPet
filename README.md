# Productivity

A calm study dashboard and a tiny world for your desk companion.

## Run

```sh
npm install
npm run dev
```

`npm run build` creates the production build. `npm run preview` serves it. `npm test` checks timer boundaries, mission rewards, restoration, legacy history, and streaks.

## Pages

- **Dashboard:** 15/25/50-minute focus sessions, daily focus time, points, streaks, weekly activity, and recent history. The robot studies while a timer runs and celebrates saved sessions.
- **Focus Quest:** choose a 5/15/25-minute study mission to grow the robot's room. The timer is shared with the dashboard, so switching pages never starts a second session.
- **Sticker studio:** download three transparent cartoon PNGs and try a left/center/right pose preview.

## Points and game progression

Each whole minute in a saved session earns 10 points. Sessions under one minute earn nothing. A fully completed mission earns an additional 25 points (5 minutes), 75 points (15 minutes), or 150 points (25 minutes). Ending a mission early retains whole-minute points but earns no bonus.

Room items unlock automatically at 50, 150, 300, 500, and 1,000 cumulative points. Unlocks do not spend points. The core scoring and timer logic lives in `src/focus.js`.

Tracking is manual self-reported focus time, not verified productivity. Pause during breaks. The client-only points are for personal motivation, not a competitive or tamper-proof leaderboard.

## Storage

Progress is stored in `productivity.workspace.v2` in browser local storage. Existing `productivity.sessions.v1` history is migrated without removing the original data. Active sessions checkpoint every five seconds and on page exit; after reload they restore paused, with no offline time awarded. Abrupt browser termination can lose the last checkpoint interval. Use one active study tab at a time. Nothing syncs to an account or another device.

## Hardware and camera

The team’s six STL design files remain at the repository root. Camera head tracking, ESP32 movement, sound, and vibration are not connected in this branch. The sticker tilt is a manual digital preview, not a hardware command. No camera permissions are requested and no video is collected.

## Artwork

`public/robots/hello.png`, `study.png`, and `celebrate.png` are transparent digital illustrations inspired by the team's physical robot. They were generated with the built-in image generation tool. The photo itself and its social-media UI are not included. Exact generation prompts are recorded in `public/robots/prompts.json`.

The favicon and room decorations are code-native vector/CSS assets. Google Fonts supplies DM Sans and Manrope, with system-font fallbacks.
