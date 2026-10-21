# rpodpet

A desk companion that makes studying more rewarding. Built at **Hack the Valley 11**.

<p align="center">
  <img src="docs/images/robot.png" alt="Our white desk robot with OLED eyes and an ESP32 camera" width="300">
</p>

## The idea

- **Focus:** track study sessions, points, and daily progress.
- **Play:** unlock decorations for your robot's room.
- **Compete:** study with friends in timed focus races.
- **Connect:** pair the dashboard with our ESP32 robot prototype.

## Project versions

| Branch | What's inside |
| --- | --- |
| [`main`](https://github.com/parniayzdin/rpodpet/tree/main) | Original dashboard, Python hardware prototype, and printable robot parts |
| [`robot-theme-game`](https://github.com/parniayzdin/rpodpet/tree/robot-theme-game) | Updated theme, accounts, room rewards, friend races, and USB eye control |
| [`feature/backend`](https://github.com/parniayzdin/rpodpet/tree/feature/backend) | Supabase authentication, Tiger stats, and robot habit integration |

These versions are not fully merged. Dashboard timers measure self-reported focus time.

## Run the main dashboard

```sh
npm ci
npm run dev
```

Open the local URL shown in your terminal. Run `npm run build` for a production build.

[Dashboard details](docs/dashboard.md) · Hardware setup is documented at the top of [`robot.py`](robot.py).
