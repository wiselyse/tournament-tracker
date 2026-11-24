# Running it on a server

These steps run the app as a systemd **user** service on a Linux machine (no `sudo` needed),
with nightly database backups. The app has **no login**, so only expose it on a private
network. [Tailscale](https://tailscale.com) is the simple option used below.

The live app runs from this repo. `main` is what's live: do unfinished work on a branch, and
`deploy/deploy.sh` refuses to run unless the folder is on a clean `main`. Tournament data lives
outside the repo, so git can never delete or commit it.

```
<this repo>                        code; dev.sh (:5173 + :8421) and the live service (:8420)
<this repo>/backend/data/          dev data (what dev.sh uses)
~/apps/wsf-data/tournaments.db     live data (+ backups/ nightly)
```

Before a tournament, `git switch main` and deploy. The service restarts itself after a crash
or reboot from whatever is checked out. Don't run `npm run build` by hand: `frontend/dist` is
what the live app serves, so only `deploy.sh` should rebuild it.

---

## First-time setup

### 1. Build it and install the service files

From the repo, on a clean `main`:

```bash
deploy/deploy.sh
```

This installs the Python and frontend packages (needs [uv](https://docs.astral.sh/uv/) and
Node), builds the frontend into `frontend/dist`, creates `~/apps/wsf-data`, and copies the
systemd unit files into `~/.config/systemd/user/`.

### 2. Start the app (and at every boot)

```bash
loginctl enable-linger $USER                              # let user services run without a login
systemctl --user enable --now wsf-tournament wsf-backup.timer
```

- `wsf-tournament` is the app on `http://127.0.0.1:8420`; `wsf-backup.timer` runs the nightly
  4 am database backup.
- Check it: `curl http://127.0.0.1:8420/api/health` should print `{"ok":true}`.

### 3. Reach it from your devices

The app only listens on the machine itself. With Tailscale installed on the server and your
devices:

```bash
tailscale serve --bg http://127.0.0.1:8420
tailscale serve status        # shows the https://<machine>.<tailnet>.ts.net address
```

This publishes the app over HTTPS to your Tailscale network only (the real certificate is
also what the browser's share sheet needs). Optionally, to reach the dev server too:
`tailscale serve --bg --https=8443 http://127.0.0.1:5173`.

### 4. Install it on a tablet or phone

Open the `https://…ts.net` address in the browser, then **Share → Add to Home Screen**
(Safari) or **Install app** (Chrome). It opens full-screen like an app. Landscape works best
on a tablet; on a phone, portrait.

---

## Updating

Merge your branch into `main`, then from the repo:

```bash
deploy/deploy.sh
```

It rebuilds, restarts the app and checks it came back. Open devices switch to the new
version the next time the app comes to the foreground. Don't deploy during a tournament.

## Useful commands

| What | Command |
|---|---|
| Is it running? | `systemctl --user status wsf-tournament --no-pager` |
| Live logs | `journalctl --user -u wsf-tournament -f` |
| Restart | `systemctl --user restart wsf-tournament` |
| Back up now | `systemctl --user start wsf-backup` then `ls ~/apps/wsf-data/backups` |

## Backups and restoring

- Every night at 4 am, `deploy/backup.py` copies the database to
  `~/apps/wsf-data/backups/tournaments-YYYY-MM-DD.db` (the newest 60 are kept). It uses
  SQLite's backup API, so it's safe while the app is running.
- For one tournament, the app's **Download backup** button (Tournaments screen) saves a JSON
  file that **Import** can load back.
- To restore the whole database from a nightly copy:

  ```bash
  systemctl --user stop wsf-tournament
  cp ~/apps/wsf-data/tournaments.db ~/apps/wsf-data/tournaments.db.before-restore
  rm -f ~/apps/wsf-data/tournaments.db-wal ~/apps/wsf-data/tournaments.db-shm
  cp ~/apps/wsf-data/backups/tournaments-YYYY-MM-DD.db ~/apps/wsf-data/tournaments.db
  systemctl --user start wsf-tournament
  ```

  The `rm` matters: SQLite keeps recent writes in `-wal`/`-shm` side files, and leftover ones
  from the old database must not be applied on top of the restored copy.
