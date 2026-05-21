---
name: notebooklm-mcp
description: MCP-сервер для Google NotebookLM. Подключается к вашему Firefox (с ВПН, расширениями, куками)
  и позволяет искать/спрашивать по вашим ноутбукам через ИИ.
---

## Режимы работы

### Режим 1: Auto (рекомендуется, по умолчанию)
Сервер сам запускает Firefox (вашу системную копию) и использует ваш профиль.
- ВПН и расширения работают (используется ваш Firefox, а не изолированный)
- Куки сохраняются
- При первом запуске Firefox откроется visible — залогиньтесь в Google

Настройка в `.env`:
```
MODE=auto
USER_PROFILE=   # пусто = автоопределение профиля
```

### Режим 2: Connect (продвинутый)
Вы сами запускаете Firefox с флагом `--remote-debugging-port 9222`,
сервер подключается к нему через WebSocket.

```cmd
start-firefox-debug.cmd
```

Настройка в `.env`:
```
MODE=connect
DEBUG_PORT=9222
```

## Инструменты MCP
| Инструмент | Описание |
|---|---|
| `search_notebooklm(query)` | Поиск по ноутбуку |
| `ask_notebooklm(query, mode?)` | Задать вопрос (chat/note) |

## Быстрый старт
```bash
npm install
npx playwright install firefox
cp .env.example .env  # отредактируйте NOTEBOOK_ID
npm start
```

## Подключение к OpenCode / Claude
В `opencode.jsonc`:
```jsonc
{
  "mcpServers": {
    "notebooklm": {
      "command": "node",
      "args": ["path/to/notebooklm-mcp-repo/server.js"],
      "env": {
        "NOTEBOOK_ID": "ваш-id",
        "MODE": "auto",
        "HEADLESS": "false"
      }
    }
  }
}
```
