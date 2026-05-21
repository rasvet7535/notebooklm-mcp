# NotebookLM MCP Server

MCP-сервер для [Google NotebookLM](https://notebooklm.google.com/).  
Открывает ваш ноутбук через Playwright + Firefox и предоставляет AI-инструменты для поиска и вопросов.

## Возможности

- **search_notebooklm(query)** — поиск по ноутбуку
- **ask_notebooklm(query, mode?)** — задать вопрос
- **list_notebooks()** — список доступных ноутбуков
- **notebooklm_status()** — статус сессии

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

Откроется Firefox. **Залогиньтесь в Google** и дождитесь загрузки NotebookLM.  
Сессия сохранится автоматически.

### 2. Запуск MCP-сервера

```bash
node server.js
```

### 3. Подключение к OpenCode / Claude

В `opencode.jsonc`:

```jsonc
{
  "mcpServers": {
    "notebooklm": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "NOTEBOOK_ID": "your-notebook-id",
        "HEADLESS": "true"
      }
    }
  }
}
```

## Переменные окружения (.env)

| Переменная | Описание | По умолчанию |
|---|---|---|
| `NOTEBOOK_ID` | ID ноутбука в NotebookLM | — |
| `HEADLESS` | Запуск в фоне (true/false) | false |
| `USER_DATA_DIR` | Директория профиля Firefox | ./firefox-profile |
| `FIREFOX_PATH` | Путь к Firefox | C:\Program Files\Mozilla Firefox\firefox.exe |

## Режимы работы

### Auto (по умолчанию)
Сервер сам запускает Firefox с сохранённой сессией.

### Ручной вход
Если сессия истекла, сервер переключится в visible-режим и будет ждать входа.

## Лицензия

MIT
