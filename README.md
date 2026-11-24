# WSF Tournament Tracker

Self-hosted web app for running Wisely Spoons Federation tournaments: random seating, spoon layout, eliminations, stalemates, penalties, divisions, timeline, reports and Instagram story exports. Works on a tablet, phone or desktop browser, and installs to the home screen as an app.

## How the randomness works

Everything left to chance is in one short file,
[`rng.py`](backend/src/wsf_tournament/engine/rng.py), written to be read without a coding
background. It uses Python's
[`random.SystemRandom`](https://docs.python.org/3/library/random.html#random.SystemRandom),
which reads the operating system's cryptographic random source (it can't be seeded or
predicted). There are three draws:

- **Seats:** every round, the players still in are shuffled into the seats. Re-rolling
  draws a fresh shuffle.
- **Empty gap** (spoons-between-players layout): picked at random every round, same place.
- **Divisions** (more than 16 players): players are split into divisions whose sizes
  differ by at most one.

Each result is **recorded in the tournament's event log** at the moment it's drawn, so the
history can't be quietly redrawn later: undo and rewind replay the same recorded seats. The
log for any tournament can be downloaded from the app (**Download backup**) and read as
JSON: every `RoundStarted` event lists the seat order that was drawn.

## Develop

```bash
./dev.sh    # backend on :8421 + frontend on :5173; Ctrl+C stops both
```

Then open http://127.0.0.1:5173.

Or run them separately:

```bash
# backend (needs uv: https://docs.astral.sh/uv/)
cd backend
uv sync
uv run pytest
uv run uvicorn wsf_tournament.app:app --reload --port 8421

# frontend (in a second terminal; proxies /api to :8421)
cd frontend
npm ci
npm run dev
```

## Production build

```bash
cd frontend && npm ci && npm run build      # writes frontend/dist
cd ../backend && uv run uvicorn wsf_tournament.app:app --host 127.0.0.1 --port 8420
```

FastAPI serves `frontend/dist` and `/api` on the same port. Running it on a server (systemd, private network access, backups): [`deploy/README.md`](deploy/README.md).

## License

[MIT](LICENSE).
