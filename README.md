
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

---

## 🚧 Features (Planned)

- 🎬 **Add movie** via Radarr  
- 📺 **Add TV show** via Sonarr    
- 🗑 **Empty NAS recycle bin** (QNAP / system maintenance)  
- 🔧 Full logging & versioning  
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

```

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

---

## 🧪 Example Commands

```

redownload traitors uk s3e11
redownload destination x season 1 episode 4
redownload ozark s2e6

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
  }
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

* Add Radarr add-movie flow
* Add Sonarr add-series flow
* Plex integration
* Scheduled cleanup tasks
* AgentKit integration
* Web dashboard for debugging agent actions
