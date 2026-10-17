# Productivity

A study dashboard with robot room rewards and shared focus races.

## Run

```sh
npm install
npm start
```

In a second terminal:

```sh
npm run dev
```

Vite proxies `/api` to the race server on port 4173. Personal timers still work without the server; friend races require it. Use Node 22 or newer.

For a production build, run `npm run build`, then `npm start` and open `http://127.0.0.1:4173`. `npm run preview` serves only the frontend, without friend races. `npm test` checks personal timers, rewards, race scoring, permissions, reconnects, persistence, and the HTTP API.

### Friends on separate laptops

Run `npm run build`, then `npm run share` on one computer. Everyone, including the host, opens `http://<host-computer-LAN-IP>:4173` on the same reachable network. Create a room and share its six-character code or use **Copy invite**. A localhost invite only works on the host's computer. Network/firewall settings must allow the other devices to reach that port; this command does not change those settings. Stop any existing `npm start` server before using `npm run share`.

For remote friends, deploy this Node server and its `dist` folder together to one shared host with HTTPS and persistent storage for `.data`. This branch does not include an online deployment. `PORT` can override the default port.

## Pages

- **Dashboard:** 15/25/50-minute focus sessions, daily focus time, points, streaks, weekly activity, and recent history. The robot studies while a timer runs and celebrates saved sessions.
- **Focus Quest:** choose a 5/15/25-minute study mission to grow the robot's room. The timer is shared with the dashboard, so switching pages never starts a second session.
- **Friends:** create or join a room for 2–8 players, ready up, then race for 5/15/25 minutes. Live standings show each person's focus time, with a winner or shared win at the end.
- **Stickers:** download three transparent cartoon robot PNGs.

## Points and game progression

Each whole minute in a saved session earns 10 points. Sessions under one minute earn nothing. A fully completed mission earns an additional 25 points (5 minutes), 75 points (15 minutes), or 150 points (25 minutes). Ending a mission early retains whole-minute points but earns no bonus.

Room items unlock automatically at 50, 150, 300, 500, and 1,000 cumulative points. Unlocks do not spend points. The core scoring and timer logic lives in `src/focus.js`.

Tracking is manual self-reported focus time, not AI-verified productivity. Pause during breaks. The personal points are for motivation.

## Race rules

Everyone must be connected and ready before the host starts a shared countdown. The most focused whole seconds within the race window wins; equal scores share the win. A race with zero focus has no winner. Late joins are closed once a race starts, and leaving during a race forfeits the result and unsaved race points.

The server measures elapsed time from heartbeats every two seconds, rather than accepting submitted scores. Paused time and disconnected gaps over 15 seconds earn nothing. A reload restores the room paused; use **Resume focus** to continue. This prevents clients from submitting arbitrary scores, but does not verify attention: someone can still leave their focus timer running. Camera integration can replace the manual focus signal later.

Finishing a race adds 10 personal points per whole focused minute, once per participant, and contributes to room rewards. No extra winner bonus is awarded. Personal sessions and races cannot actively count time together within the same tab.

## Storage

Personal progress is stored in `productivity.workspace.v2` in browser local storage. Existing `productivity.sessions.v1` history is migrated without removing the original data. Active sessions checkpoint every five seconds and on page exit; after reload they restore paused, with no offline time awarded. Abrupt browser termination can lose the last checkpoint interval. Use one active study tab at a time. Personal progress does not sync to an account or another device.

Race names, readiness, and focus times are shared with the room. Room membership is stored in per-tab session storage, so reloads work but closing the tab can lose access. Keep the tab open through the result to save personal points. The server persists rooms in `.data/races.json` (ignored by Git); rooms expire after 24 hours. Membership tokens are never included in shared room snapshots. This is a small, single-server hackathon service, without accounts or a global leaderboard.

## Hardware and camera

The team’s six STL design files remain at the repository root. Camera head tracking, ESP32 movement, sound, and vibration are not connected in this branch. No camera permissions are requested and no video is collected.

## Artwork

`public/robots/hello.png`, `study.png`, and `celebrate.png` are transparent digital illustrations inspired by the team's physical robot. They were generated with the built-in image generation tool. The photo itself and its social-media UI are not included. Exact generation prompts are recorded in `public/robots/prompts.json`.

The favicon and room decorations are code-native vector/CSS assets. Google Fonts supplies DM Sans and Manrope, with system-font fallbacks.
