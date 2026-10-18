# Run Productivity on Vultr

Vultr hosts the dashboard, account API, saved progress, and shared friend races at one HTTPS address. This lets classmates use the same service from different laptops. The physical robot and its camera stay connected to the student's laptop.

This is deployment preparation, not a live Vultr deployment. No server has been purchased or provisioned. The team's Tiger integration has not been pushed yet; the current branch still uses JSON files for storage. This setup does not claim a Tiger connection.

## Resources

| Resource | Purpose |
| --- | --- |
| Vultr Cloud Compute, small 2 GB RAM Linux instance | Run the Node.js app and HTTPS proxy. Confirm the displayed price before creating it. |
| Vultr Docker Marketplace image | Provides Docker on the server. Docker Desktop is not required on teammates' laptops. |
| Public domain or subdomain | Gives the app one HTTPS address and enables Secure login cookies. |
| Caddy | Obtains and renews HTTPS certificates. |
| Docker volumes | Keep account data, race rooms, and certificates across app rebuilds. |

A GPU is unnecessary for hosting the current dashboard. A Vultr managed database, Kubernetes cluster, and container registry are also unnecessary for this single-server setup. Keep one app instance: sessions and race state are held in memory, with saved data on disk.

## 1. Create the account and server

1. Follow the [MLH Vultr signup and credit instructions](https://www.mlh.com/partners/vultr). Ask the MLH coach for the event gift code. MLH currently advertises $100 in credits; check the offer conditions in your account.
2. In Vultr, select a small Cloud Compute server with the **Docker Marketplace** image. A nearby region is a reasonable starting point. Review the plan and credit balance before provisioning.
3. Configure SSH key access and keep SSH port 22 limited to your own IP. Allow public TCP ports 80 and 443 for the website and certificate verification. UDP 443 is optional for HTTP/3. Do not publish port 4173.
4. Point your domain's A record to the server's IPv4 address. If an AAAA record exists, it must point to a working IPv6 address on the same server. Use a DNS-only record for initial setup.

## 2. Copy the app to the server

Use the SSH username and IP shown in Vultr. Run this from your laptop, replacing both placeholders:

```sh
ssh YOUR_SSH_USER@YOUR_SERVER_IP
```

Run the following **on the Vultr server**, using a user with Docker access. If Docker requires root, prefix the Docker commands with `sudo`.

```sh
git clone --branch robot-theme-game https://github.com/parniayzdin/productivity-dashboard.git
cd productivity-dashboard/deploy/vultr
cp .env.example .env
nano .env
```

Set `APP_DOMAIN` to your actual hostname and `ACME_EMAIL` to your email. The example values must be replaced. `.env` is ignored by Git. Do not put database credentials or API keys in browser JavaScript or variables beginning with `VITE_`.

## 3. Build and start

From `productivity-dashboard/deploy/vultr` on the server:

```sh
docker compose version
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 app web
```

If `docker compose` is missing, follow [Vultr's Docker Marketplace setup guide](https://docs.vultr.com/how-to-use-vultrs-docker-marketplace-application) to install the Compose plugin. The build downloads official Node.js and Caddy container images on the server and installs the app's locked npm dependencies. The Node.js process runs as the unprivileged `node` user.

Visit `https://YOUR_DOMAIN`. Caddy needs working DNS and reachable ports 80/443 to issue a trusted certificate. The app's production session cookies require HTTPS; do not test login at the raw HTTP server IP.

The public frontend and `/api` use the same origin, so friends do not need to start Node.js on their laptops. Create new accounts on this shared service; accounts created on a teammate's localhost are separate and are not uploaded by deployment.

## Verify the shared demo

1. Open `/api/health` on the HTTPS site and check that it returns `{"ok":true}`.
2. Sign up, log out, then log in. Complete a one-minute session and verify the 10 points return after a reload.
3. On a second laptop, use the same HTTPS URL and create a different account. Create a friend room on the first laptop and join its code from the second.
4. Check that the host can start a race after both people are ready.
5. Restart the app container and sign in again. Saved points should remain; server restarts invalidate login sessions.

For the hackathon demonstration, show the live URL, two connected players, and the Vultr instance running the app. Once deployment is verified, a truthful description is: “Vultr runs our shared dashboard, login API, and live focus races.” Hosting configuration alone is not a completed cloud integration.

## Updates and stored data

From the same `deploy/vultr` directory:

```sh
git pull --ff-only origin robot-theme-game
docker compose up -d --build
```

The `productivity_app_data` volume stores `.data/accounts.json` and `.data/races.json`. Normal rebuilds retain that volume. Do not use `docker compose down --volumes` unless you intentionally want to erase its saved data. Take a Vultr snapshot or another private backup before a storage migration; account files contain password hashes and personal progress. Deleting the Vultr server also deletes its local volumes unless separately backed up.

## Tiger and hardware

When the Tiger implementation is pushed, inspect how it reads the database URL and configures TLS. Add that exact server-side variable to the app container only after the code supports it. Adding an unused `DATABASE_URL` does not connect a database. Keep database credentials out of commits and frontend bundles. Do not replace the team's database or copy private data without an intentional migration plan.

The existing dashboard's Web Serial connection can access a robot attached to the user's laptop through Chrome/Edge on HTTPS. The newer Python camera/robot files on `main` also run on the laptop; this cloud image does not include or execute them. Their separate local API still needs frontend integration and browser permission testing. Vultr cannot directly reach a laptop's USB port or the ESP32's private Wi-Fi address.

## If login says “server unavailable”

- Open the shared Vultr HTTPS URL, not a static-only hosting preview or a teammate's localhost URL.
- Check `docker compose ps` and `docker compose logs --tail=50 app web`.
- Confirm DNS points to the server, the certificate is valid, and both services are running.
- If using the existing local development setup instead, keep `npm start` and `npm run dev` running in separate terminals.

References: [Vultr Docker Marketplace](https://docs.vultr.com/how-to-use-vultrs-docker-marketplace-application), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Docker persistent volumes](https://docs.docker.com/reference/compose-file/volumes).
