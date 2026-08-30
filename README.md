# Data Non-Functional Requirements — Exam Platform

An online exam platform built to demonstrate two non-functional requirements end to end:

- **Recoverability (client side):** the browser front end autosaves answers, survives a
  dropped connection, and resumes a student exactly where they left off.
- **Recoverability / High Availability (server side):** the PostgreSQL database runs as a
  two-node cluster with streaming replication, a synchronous "zero data loss" mode, and
  automatic failover — so the app keeps working (in degraded mode) when the primary
  database dies, and no committed data is lost.

This README covers what is in the project, how to stand up a copy of it on a fresh Ubuntu
server, and how to prove every piece actually works.

## Architecture

```
Browser (UI/) ──HTTP──> FastAPI app (src/) ──SQLAlchemy/psycopg2──> PostgreSQL HA cluster
                                                                     (docker/, repmgr)

                         ┌─────────────┐   streaming replication   ┌─────────────┐
                         │  pg_node_1  │ ───────────────────────>  │  pg_node_2  │
                         │  (primary)  │ <───────────────────────  │  (standby)  │
                         └─────────────┘     repmgrd monitors      └─────────────┘
                                both, promotes a standby automatically
                                              │
                                         ┌─────────┐
                                         │  etcd   │  (shared state for repmgr)
                                         └─────────┘
```

- **Front end** (`UI/`): static HTML/CSS/JS, no build step. Served by FastAPI itself at `/`
  and `/static`.
- **Backend** (`src/`): FastAPI + SQLAlchemy, organized as `apis` (HTTP layer) →
  `domain` (models/schemas/business logic) → `infrastructure` (database engine).
- **Database** (`docker/`): two PostgreSQL 16 nodes managed by
  [repmgr](https://repmgr.org/) for replication and automatic failover, plus an `etcd`
  instance repmgr uses for shared cluster state.

## Repository layout

| Path | What it is |
|---|---|
| `src/main.py`, `src/__main__.py` | ASGI app entry points (`uvicorn`) |
| `src/apis/` | FastAPI app factory, routers, request dependencies |
| `src/apis/v1/routers/` | `health`, `students`, `exams`, `attempts` endpoints |
| `src/domain/` | SQLAlchemy models, Pydantic schemas, business logic (`services.py`) |
| `src/infrastructure/db/` | Engine/session management (`db.py`) — HA-aware connection args |
| `src/config.py` | All settings, read from environment / `.env` |
| `src/observability/` | Logging setup |
| `UI/` | Static front end (autosave, offline handling, a/b comparison dashboard) |
| `alembic/`, `alembic.ini` | Database migrations |
| `docker/docker-compose.yml` | The 2-node PostgreSQL + repmgr + etcd cluster |
| `docker/config/` | `postgresql.conf` / `pg_hba.conf` overrides mounted into the cluster |
| `scripts/enable-sync-replication.sh` | One-time step to turn on synchronous replication |
| `scripts/repmgr-cluster-show.sh` | Wrapper to run `repmgr cluster show` from the host |
| `scripts/server/` | Equivalent conf files for a **native** (non-Docker) PostgreSQL install |
| `.env.example` | Template for `.env` (copy it, `.env` itself is git-ignored) |

## Non-functional requirements coverage

| # | Requirement | How it's met | Status |
|---|---|---|---|
| 1 | PostgreSQL streaming replication between two nodes | `docker/docker-compose.yml`, repmgr-managed | ✅ done, tested |
| 2 | WAL configuration to protect against transaction loss | `wal_level=replica` + synchronous replication (`scripts/enable-sync-replication.sh`) | ✅ done, tested |
| 3 | Automatic failover | `repmgrd` running on both nodes, monitors and self-promotes | ✅ done, tested |
| 4 | Backup with pgBackRest + recovery test | — | ⬜ not started yet |

repmgr was chosen over Patroni/pg_auto_failover as the failover manager — it satisfies the
same requirement (automatic promotion, no manual step) with less moving infrastructure.
See the "Known gaps" section for what's left.

## Prerequisites (any machine)

- Docker Engine + the Docker Compose plugin (`docker compose version` should work)
- Python 3.11+
- git

## Deploying on a fresh Ubuntu server

These steps take a brand-new Ubuntu 22.04/24.04 server to a fully running copy of this
project. Run them as a regular user with `sudo` access, not as root.

### 1. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git python3 python3-venv python3-pip

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Let your user run docker without sudo — log out/in (or `newgrp docker`) for this to take effect
sudo usermod -aG docker "$USER"
newgrp docker
```

Verify: `docker run --rm hello-world`

### 2. Get the code

```bash
git clone <your-repo-url> Data-non-functional-requirements
cd Data-non-functional-requirements
```

### 3. Bring up the PostgreSQL HA cluster

```bash
cd docker
docker compose up -d
cd ..
```

Wait ~20-30 seconds, then confirm both nodes are `Up` (not `Restarting`/`Exited`):

```bash
cd docker && docker compose ps && cd ..
```

Then enable synchronous replication (this is a deliberate second step, not baked into the
image config — see "Why synchronous replication is a separate step" below):

```bash
./scripts/enable-sync-replication.sh
```

Confirm the cluster is healthy:

```bash
./scripts/repmgr-cluster-show.sh docker-pg_node_1-1
```

You should see `node-1` as `primary` and `node-2` as `standby`, both `running`.

### 4. Configure the app's `.env`

```bash
cp .env.example .env
```

Edit `.env` so the database credentials match `docker/docker-compose.yml` (the compose
file uses `custom_user` / `user_password` / database `app_db`, and exposes the primary on
host port `5434`, the standby on `5433`):

```dotenv
DB_USER=custom_user
DB_PASSWORD=user_password
DB_HOST=localhost
DB_PORT=5434
DB_NAME=app_db

DB_CONNECT_RETRIES=5
DB_CONNECT_RETRY_DELAY=2
DB_AUTO_CREATE=1
DB_ECHO=0

HOST=0.0.0.0
PORT=8000
LOG_LEVEL=INFO
```

That points the app at the primary directly (simplest option — if the primary fails over,
you'd update `DB_PORT` to `5433` and restart the app). To make the app itself
failover-aware (no manual port change needed — `db.py` already asks for
`target_session_attrs=read-write`, which lets `psycopg2` pick whichever host is currently
writable), use a multi-host `DATABASE_URL` instead of the `DB_*` fields — SQLAlchemy's URL
authority doesn't support comma-separated hosts, so host/port lists go in the query string:

```dotenv
DATABASE_URL=postgresql+psycopg2://custom_user:user_password@/app_db?host=localhost,localhost&port=5434,5433&target_session_attrs=read-write
```

### 5. Install Python dependencies and prepare the schema

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

With `DB_AUTO_CREATE=1` (the default), tables are created automatically the first time the
app starts. To use Alembic migrations instead (recommended for anything beyond local
testing — set `DB_AUTO_CREATE=0` in `.env` first):

```bash
alembic upgrade head
```

### 6. Run the app

Development:

```bash
python -m src.main
# equivalent: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

Production-style (multiple workers, no reload):

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8000 --workers "$(( $(nproc) * 2 + 1 ))"
```

To keep it running after logout, wrap the last command in a systemd unit, e.g.
`/etc/systemd/system/exam-platform.service`:

```ini
[Unit]
Description=Exam Platform API
After=network.target docker.service

[Service]
User=<your-user>
WorkingDirectory=/path/to/Data-non-functional-requirements
Environment=PATH=/path/to/Data-non-functional-requirements/.venv/bin
ExecStart=/path/to/Data-non-functional-requirements/.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then: `sudo systemctl enable --now exam-platform`.

### 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8000/tcp     # the API/UI
sudo ufw enable
```

Do **not** open `5433`/`5434` to the public internet — those are the raw Postgres ports.
Docker Compose still publishes them on all interfaces by default; if this server is
internet-facing, either firewall them (`sudo ufw deny 5433 5434`, since Docker's own
`iptables` rules take priority over ufw for published ports — `ufw route` rules or binding
the compose ports to `127.0.0.1:5434:5432` in `docker-compose.yml` are the reliable fixes)
or leave them closed unless another host genuinely needs direct DB access.

## Testing everything

### Containers are healthy

```bash
cd docker && docker compose ps
```

All three services (`etcd`, `pg_node_1`, `pg_node_2`) should show `Up`, not `Restarting`.

### API health check

```bash
curl -s http://localhost:8000/api/v1/health | python3 -m json.tool
```

Expect `{"status": "ok", "database": "up", ...}`. This same endpoint is what you'd poll to
measure recovery time (RTO) during a failover test below — it reports `"degraded"` instead
of erroring out while the database is unreachable.

### Functional smoke test (exercises the real app + DB)

```bash
# 1. seed the exam content (idempotent)
curl -s -X POST http://localhost:8000/api/v1/exams/seed | python3 -m json.tool

# 2. sign in — creates the student + first attempt
curl -s -X POST http://localhost:8000/api/v1/students/login \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Student", "email": "test@example.com"}' | tee /tmp/session.json | python3 -m json.tool

# 3. fetch the exam using the exam_id from the login response
EXAM_ID=$(python3 -c "import json;print(json.load(open('/tmp/session.json'))['exam_id'])")
curl -s http://localhost:8000/api/v1/exams/$EXAM_ID | python3 -m json.tool
```

If all three return data (no 500s), the app, the schema, and the database connection are
all working.

### HA test 1 — streaming replication

```bash
# write on the primary
docker exec docker-pg_node_1-1 psql -U custom_user -d app_db -c \
  "CREATE TABLE IF NOT EXISTS ha_check(id serial primary key, note text);
   INSERT INTO ha_check(note) VALUES ('replication check');"

# read on the standby — should show the row immediately
docker exec docker-pg_node_2-1 psql -U custom_user -d app_db -c "SELECT * FROM ha_check;"

# the standby must refuse writes
docker exec docker-pg_node_2-1 psql -U custom_user -d app_db -c \
  "INSERT INTO ha_check(note) VALUES ('should fail');"
# expected: ERROR: cannot execute INSERT in a read-only transaction
```

### HA test 2 — zero data loss (synchronous replication)

```bash
docker exec docker-pg_node_1-1 psql -U postgres -c \
  "SELECT application_name, state, sync_state FROM pg_stat_replication;"
```

`sync_state` should read `quorum` (or `sync`), not `async` — if it says `async`, run
`./scripts/enable-sync-replication.sh` again.

### HA test 3 — automatic failover (the big one)

```bash
# start the app and leave it running in one terminal, poll health in another:
watch -n1 'curl -s http://localhost:8000/api/v1/health'

# in a third terminal, kill the primary
docker stop docker-pg_node_1-1

# watch scripts/repmgr-cluster-show.sh docker-pg_node_2-1 — within ~10-15s,
# node-2 should flip from "standby" to "primary" with no manual command run
watch -n2 './scripts/repmgr-cluster-show.sh docker-pg_node_2-1'
```

Things to confirm during this test:
- `repmgrd`'s log (`docker logs docker-pg_node_2-1`) shows `NOTICE: promoting standby to
  primary` and `STANDBY PROMOTE successful` on its own.
- The row inserted in HA test 1 is still there on the new primary (`docker exec
  docker-pg_node_2-1 psql -U custom_user -d app_db -c "SELECT * FROM ha_check;"`) — proof
  of zero data loss.
- If the app's `.env` uses the multi-host `DATABASE_URL` from step 4, `/api/v1/health`
  recovers on its own once `psycopg2` reconnects through the surviving host. If it's
  pointed at a single fixed port, you'd need to update `DB_PORT` and restart the app — this
  is exactly why the multi-host form exists.

Bring the old primary back and confirm it rejoins as a standby automatically:

```bash
docker start docker-pg_node_1-1
sleep 15
./scripts/repmgr-cluster-show.sh docker-pg_node_2-1   # node-1 should now show as standby
```

## Why synchronous replication is a separate step

`docker/config/postgresql.conf` deliberately does **not** set `synchronous_standby_names`.
On a brand-new cluster, the primary's own first-boot bootstrap (creating the `repmgr`
role, the app database, etc.) is itself a sequence of commits. If synchronous replication
were demanded from the very first commit, every one of those bootstrap transactions would
block forever waiting for a standby to acknowledge them — but the standby can't even
connect yet, since it needs the very `repmgr` role that bootstrap is stuck trying to
create. That's a real deadlock, not a hypothetical: it's exactly what a first `docker
compose up` with that setting produces. `scripts/enable-sync-replication.sh` waits for the
standby to actually be streaming before switching the mode on, avoiding the deadlock
entirely.

## Troubleshooting

**`pg_node_2` crash-loops with `Permission denied` writing to
`/bitnami/postgresql/conf/postgresql.conf`.** Don't bind-mount config files directly onto
the live config paths — the container runs as a non-root UID (1001), and host files
default to mode `644` (no write for "other"). `docker-compose.yml` instead mounts
`docker/config/postgresql.conf` **read-only** into `/bitnami/postgresql/conf/conf.d/`,
which Bitnami's image includes automatically and only ever needs to read.

**`repmgr cluster show` fails with `could not get current user name: Success`.** Plain
`docker exec` doesn't inherit the `nss_wrapper` environment variables the container's
entrypoint set up for its own PID 1 (which is what makes `getpwuid()` work for the
container's non-root UID). Use `./scripts/repmgr-cluster-show.sh <container>` instead of
calling `repmgr` directly.

**A fresh cluster hangs forever on `CREATE DATABASE` / never finishes booting.** See "Why
synchronous replication is a separate step" above — check `docker/config/postgresql.conf`
does not have `synchronous_standby_names` set, and always run
`enable-sync-replication.sh` as a separate step after the standby is confirmed streaming
(`docker exec <primary> psql -U postgres -c "SELECT * FROM pg_stat_replication;"`).

**App can't connect / `/api/v1/health` shows `"degraded"`.** Check `.env` matches the
compose file's credentials and ports (step 4 above), and that
`docker compose ps` shows the nodes as `Up`.

## Known gaps / next steps

- **Backup with pgBackRest + a recovery test** (requirement 4) is not implemented yet.
- `scripts/server/` holds equivalent `postgresql.conf`/`pg_hba.conf` for running PostgreSQL
  natively (no Docker) — this path exists in the repo but hasn't been wired into an install
  script.
- The root `.env.example` still defaults to a single-host, non-HA-aware connection
  (`DB_HOST=localhost`, `DB_PORT=5432`, `DB_NAME=exam_platform`) for plain local
  development against a single Postgres instance. When deploying against the HA cluster in
  `docker/`, follow step 4 above instead.
