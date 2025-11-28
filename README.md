
# 🎛️ Media Agent  
### Natural-Language Control for Sonarr, Radarr, and NAS Maintenance via Telegram

Media Agent is a Node.js-based automation bot that allows you to manage your media server using natural language via Telegram.  
It integrates with **Sonarr**, **Radarr**, and (soon) your NAS, providing conversational workflows powered by OpenAI.

This project replaces earlier n8n-based flows with a clean, code-first, transparent architecture.

---

## ✨ Features (Current)

### 🔁 Redownload a TV Episode
Example:
```

redownload the block season 3 episode 11

```
Now supports fuzzy requests such as:
```
redo the latest housewives
```
...which will use the 'Continue Watching' feature in Plex to look at what shows are in progress and match from there.

The bot:
1. Understands the intent via LLM classification  
2. Looks up the series in Sonarr  
3. Fetches the correct episode  
4. Asks:  
```

Found “The Block (AU)” S03E11. Redownload this episode?
[ Yes ] [ No ] [ Pick different show ]

```
5. If confirmed, it deletes the existing file and triggers a Sonarr EpisodeSearch.

### Show fully watched seasons
Example:
```
What seasons are fully watched?
```
This will use Plex and Sonarr to bring back all seasons that are fully watched, showing how many episodes and how much storage they take up. This makes it easy to then run...

### Tidy up Show Season X
Example:
```
Tidy up Real Housewives of Salt Lake City S3
```
Upon confirmation this will delete and unmonitor the season of the show you have requested. If there's ambiguity in the name you'll be given the option to choose the right show.

### 📺 “Do we have…?” lookup
Example:
```
do we have luther season 3?
```
The agent replies conversationally with what’s in Sonarr/Radarr, how much is downloaded, whether it’s monitored, and Plex watch progress. If it spots a cleaned-up show (ended, unmonitored, no files) it tells you it’s been tidied and offers a one-tap “➕ Add” button to bring it back.

### 🔍 Automatic Series Selection  
Media Agent auto-selects the first matching show and only asks you to pick a different one if you choose **"Pick different show"**.

### 👁 Transparent “Working…” Status Messages  
A unified placeholder shows what the agent is doing:
- Understanding request  
- Classifying intent  
- Routing  
- Searching for series  
- Fetching episodes  
- Preparing confirmation  
- etc.

Perfect for debugging and visibility.

### 🤖 OpenAI-powered Intent Classification  
All natural-language interpretation passes through an OpenAI model (configurable).

### 🧹 NAS recycle-bin cleanup & disk space
Ask “free up disk space” and the bot SSHes to your NAS, finds every `@Recycle` under your configured share roots, and shows per-share size/counts. Tiny bins are auto-filtered (<1 MB & <10 files by default), with a “Show all bins” button and “Clear all” still covering everything. Ask “how much disk space?” to see current usage per share (1024-byte math, KB/MB/GB/TB labels).

### 🧹 qBittorrent cleanup
Ask “delete unregistered torrents” and the bot lists tracker-unregistered torrents and asks for confirmation. Scope to TV or movies by saying “delete unregistered tv torrents” or “...movies”.

### 📉 Optimize movies & TV
Say “optimize movies” to see the largest UHD/huge titles that can be downgraded to your `OPTIMIZE_TARGET_PROFILE`. The bot shows estimated savings, lets you pick titles, and automatically changes Radarr quality profiles + triggers searches. Use “optimize tv shows” to do the same for Sonarr series (using `OPTIMIZE_TV_TARGET_PROFILE`); it inspects the actual episode file qualities so only real 4K-or-higher seasons appear. 
Add “to <profile>” to target a specific quality (e.g. “optimize tv to sd”), and ask “list tv profiles” / “list movie profiles” to see the available Sonarr/Radarr quality profiles before running an optimization.

### ➕ Add shows or movies
Natural language add flow: “add severance” or “add the creator movie”. The bot searches Sonarr + Radarr, shows posters/overviews, lets you page results, switch between TV/Movie when both exist, and adds with your default root folder & quality profile. Cards clean up when done.

---

## 🚧 Features (Planned)
 
- 🧠 Model upgrades & response optimizations  

---

## 🏗️ Architecture Overview

```

media-agent/
├── src/
│   ├── llm/              # OpenAI classifier
│   ├── router/           # Intent router + per-domain handlers
│   ├── telegram/         # Bot interface + reply helpers
│   ├── tools/            # Sonarr/Radarr wrappers (Axios)
│   ├── state/            # Callback-state tracking
│   └── index.js          # Entrypoint
├── .env                  # Environment variables (ignored)
├── package.json
├── Dockerfile
└── README.md

```

### Core Flows  
- **bot.js**  
  Handles Telegram messages, typing indicators, and a unified status line.

- **intentRouter.js**  
  Routes LLM-classified intents to the correct handler.

- **tvHandler.js**  
  Full redownload workflow (series lookup → episode lookup → confirmation).

- **callbackHandler.js**  
  Processes confirmation buttons (Yes/No/Pick different).

- **sonarr.js**  
  Thin Axios wrapper around Sonarr API.

---

## ⚙️ Environment Variables

Create a `.env` file (not committed) based on `.env.example`:

```

TG_BOT_TOKEN=your-telegram-bot-token
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini

SONARR_URL=[http://your-sonarr-host:8989](http://your-sonarr-host:8989)
SONARR_API_KEY=your-sonarr-api-key

RADARR_URL=[http://your-radarr-host:7878](http://your-radarr-host:7878)
RADARR_API_KEY=your-radarr-api-key

# Optional defaults for add-media
SONARR_DEFAULT_ROOT=/tv
SONARR_DEFAULT_PROFILE=HD-1080p
RADARR_DEFAULT_ROOT=/movies
RADARR_DEFAULT_PROFILE=Any
# Optimization (movies)
OPTIMIZE_TARGET_PROFILE=HD-1080p
OPTIMIZE_MIN_SIZE_GB=40
OPTIMIZE_MAX_ITEMS=20
# Optimization (TV) – optional overrides, falls back to movie values
OPTIMIZE_TV_TARGET_PROFILE=HD-1080p
OPTIMIZE_TV_MIN_SIZE_GB=30
# Skip tiny NAS recycle bins in the UI (Clear-all still empties everything)
NAS_BIN_MIN_BYTES=1000000
NAS_BIN_MIN_FILES=10

NAS_SHARE_ROOTS=/share/CACHEDEV1_DATA,/share/CACHEDEV2_DATA
# optional legacy fallback:
# NAS_RECYCLE_PATH=/share/CACHEDEV1_DATA/@Recycle

NAS_SSH_HOST=nas.local
NAS_SSH_PORT=22
NAS_SSH_USERNAME=admin
# Supply EITHER NAS_SSH_PASSWORD or NAS_SSH_PRIVATE_KEY (multiline string with \n escapes)
NAS_SSH_PASSWORD=
NAS_SSH_PRIVATE_KEY=

QBITTORRENT_URL=http://qbittorrent:8080
QBITTORRENT_USERNAME=admin
QBITTORRENT_PASSWORD=secret
QBITTORRENT_TV_CATEGORY=tv-sonarr
QBITTORRENT_MOVIE_CATEGORY=radarr

# Sonarr/Radarr add-media uses the first available root folder and quality profile returned by each service.

# Logging
LOG_DIR=./logs

```

`NAS_SHARE_ROOTS` accepts a comma-separated list of volume/share roots. Media Agent scans each root for subdirectories containing an `@Recycle` folder, aggregates their sizes, and offers “clear all” or per-share deletion options during the workflow.

SSH access is required so the container can list and delete files on the NAS. Provide host/port/username plus either a password or a private key (copy the entire key into `NAS_SSH_PRIVATE_KEY`, replacing literal newlines with `\n` if needed). The bot opens short-lived SSH sessions to enumerate recycle bins, compute sizes via `du`, and run `rm -rf` inside the NAS recycle directories.

---

## 🚀 Running the Bot

### With Node
```

npm install
npm start

```

### With Docker
```

docker build -t media-agent .
docker run --env-file .env media-agent

```

## 🧪 Testing

Jest powers the automated test suite (unit + integration). Run:

```
npm test
```

The command enables Node's `--experimental-vm-modules` flag so ESM modules load correctly. The suite stubs all external dependencies (Telegram, OpenAI, Sonarr, Plex) and exercises cache utilities, router logic, TV workflows, and callback handling to guard against regressions whenever new features are added.

---

## 🧪 Example Commands

```

redownload traitors uk s3e11
redownload destination x season 1 episode 4
redownload ozark s2e6
free up disk space
how much disk space
delete unregistered torrents
add severance
add the creator movie
show me the 10 largest shows
top rated movies

```

Expected response:
```

Found “Ozark” — Season 2, Episode 6.
Redownload this episode?

[ Yes ] [ No ] [ Pick different show ]

````

---

## 🧩 Intent Classification Format

The LLM produces:
```json
{
  "intent": "redownload_tv",
  "entities": {
    "title": "the block",
    "seasonNumber": 3,
    "episodeNumber": 11
  },
  "reference": "the block season 3 episode 11"
}
````

Handlers receive this schema consistently across workflows.

---

## 🔒 Security Notes

* `.env` is git-ignored
* No API keys or secrets are committed
* The bot forwards no content to Telegram servers once processed
* All API calls to Sonarr/Radarr occur inside your local network

---

## 🤝 Contributing

Pull requests welcome!
This repository intentionally avoids hard-coded infrastructure so anyone can adapt it to their own media setup.

---

## 📜 License

MIT

---

## 🧭 Roadmap

* Scheduled cleanup tasks
* AgentKit integration
* Web dashboard for debugging agent actions
