# NotebookLM MCP Server

MCP-сервер для [Google NotebookLM](https://notebooklm.google.com/).  
Visible Bridge Mode: Firefox + ваш профиль + SandVPN + сохранённая сессия.

## Возможности

- **ask_notebooklm(query)** — задать вопрос ноутбуку (через `?tab=chat`)
- **notebooklm_status()** — статус сессии (URL, размер тела, валидность)
- 403 recovery — автоматический retry при блокировках
- 90s timeout на ответ AI (Angular-рендеринг)

## Быстрый старт

```bash
npm install
npx playwright install firefox
cp .env.example .env
```

### 1. Настройка сессии (первый запуск)

```bash
node setup-profile.mjs
```

Откроется Firefox в **Visible Bridge Mode**. Подключи SandVPN, войди в Google,
открой ноутбук Pygmalion, нажми Enter — сессия сохранится в `storageState.json`.

### 2. Запуск MCP-сервера

```bash
node server.js
```

Сервер восстановит сессию из `storageState.json`. Если сессия истекла —
переключится в visible-режим и будет ждать входа.

### 3. Подключение к OpenCode / Claude

```jsonc
{
  "mcpServers": {
    "notebooklm": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "NOTEBOOK_ID": "your-notebook-id"
      }
    }
  }
}
```

## Архитектура

```
Firefox (ваш профиль + SandVPN)
  → notebooklm.google.com
    → ?tab=chat (прямой вход в чат, обход 403)
      → ask_notebooklm (90s timeout, 403 recovery)
        → storageState.json (317+ cookies, OSID-токены)
```

## Переменные окружения (.env)

| Переменная | Описание | По умолчанию |
|---|---|---|
| `NOTEBOOK_ID` | ID ноутбука | — |
| `USER_DATA_DIR` | Директория профиля Firefox | `./firefox-profile` |
| `STORAGE_FILE` | Файл сохранённой сессии | `storageState.json` |

## Лицензия

MIT
