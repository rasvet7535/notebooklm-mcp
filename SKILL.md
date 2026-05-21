---
name: notebooklm-mcp
description: MCP-сервер для Google NotebookLM. Использует Visible Bridge Mode — Firefox с
  вашим профилем, SandVPN, сохранённой сессией (317+ cookies) и обходом ?tab=chat.
---

## Visible Bridge Mode (рекомендуемый)

Сервер **не пытается автоматически логиниться**. Вместо этого:

1. Firefox открывается в видимом режиме (не headless)
2. Вы подключаете SandVPN и вручную входите в Google
3. Сессия сохраняется (`storageState.json`, ~317 cookies, OSID-токены)
4. При перезапуске сервер восстанавливает сессию

### Почему не headless?

- Google блокирует headless Firefox (403)
- Angular перехватывает pointer events в headless mode
- 50+ источников в ноутбуке требуют времени на загрузку
- SandVPN — расширение Firefox, не работает без UI

### Ключевые технические решения

| Решение | Описание |
|---|---|
| `?tab=chat` | Прямой переход в режим чата, обход проблемы «старых логов» вместо свежих ответов |
| storageState.json | 317+ cookies, включая OSID-токены Google |
| Persistent context | `firefox.launchPersistentContext()` — сохраняет куки между запусками |
| Отдельный профиль | Playwright НЕ трогает ваш основной Firefox (`parent.lock` удаляется только в своём profileDir) |
| Timeouts | 30s + 60s = 90s ожидания ответа AI (Angular рендерит медленно) |
| 403 recovery | Retry навигации каждые 120s, автоматический переход при восстановлении доступа |

### Первый запуск

```bash
node setup-profile.mjs
```

Скрипт скопирует расширения + куки + prefs из вашего реального Firefox-профиля,
запустит браузер и будет ждать ручного входа. После входа — сохранит сессию.

### Запуск MCP-сервера

```bash
node server.js
```

Если `storageState.json` существует — сессия восстановится автоматически.

## Инструменты MCP

| Инструмент | Описание |
|---|---|
| `ask_notebooklm(query)` | Задать вопрос ноутбуку. Открывает `?tab=chat`, отправляет запрос, ждёт до 90s |
| `notebooklm_status()` | URL, размер тела, валидность сессии |

## Подключение к OpenCode / Claude

В `opencode.jsonc`:

```jsonc
{
  "mcpServers": {
    "notebooklm": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "NOTEBOOK_ID": "1cf6b25e-d2db-4a3c-bd0b-4d8017bf7fdc"
      }
    }
  }
}
```

> **Важно:** Не добавляйте `MCP-сервер` в `opencode.jsonc` проект OpenCode, если не хотите,
> чтобы он перезапускался автоматически. Запускайте вручную: `node server.js` в отдельном
> терминале, а OpenCode подключайте через `"command": "node", "args": [...]`.

## Безопасность Firefox

- Основной Firefox пользователя **НЕ убивается**
- `parent.lock` удаляется только в profileDir Playwright (не в реальном профиле)
- Расширения копируются, профиль не модифицируется

## Переменные окружения (.env)

| Переменная | Описание | По умолчанию |
|---|---|---|
| `NOTEBOOK_ID` | ID ноутбука | `1cf6b25e-d2db-4a3c-bd0b-4d8017bf7fdc` |
| `USER_DATA_DIR` | Директория профиля Firefox | `./firefox-profile` |
| `STORAGE_FILE` | Файл сохранённой сессии | `storageState.json` |
