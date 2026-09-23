# Бэкенд «Аким на 5 часов»

## Состояние B0

Реализован стартовый скелет на Python 3.14: конфигурация, `/api/health`,
CLI `--help`/`--version`, pytest и Ruff. Движок, анализ сценариев, кэш,
StaticFiles, Docker и CI добавляются по этапам B1–B5. На B0 доступность LLM
в health означает наличие конфигурации; эндпоинта анализа пока нет.

`backend/app/config.py` определяет корень через
`Path(__file__).resolve().parents[2]`. Каталоги данных и `.env` разрешаются
относительно корня, независимо от текущей рабочей папки. `.env` читается
через python-dotenv при импорте конфигурации; переменные процесса имеют приоритет.

Схемы ответов находятся только в `backend/app/engine/models.py` (pydantic v2).
В B0 есть `HealthResponse`; остальные схемы появятся вместе с реализацией.
Версия приложения — `0.1.0`. `data_hash` — первые 12 hex SHA-256 байтов
`districts.json`, `measures.json`, `rules.json` подряд в указанном порядке.
Хэш вычисляется при старте приложения, входные JSON не изменяются.

## Запуск через venv

Команды выполняются из корня клона. Активация окружения не нужна.
Перед запуском Python задайте `PYTHONUTF8=1`.

PowerShell (Windows, Python 3.14):

```powershell
$env:PYTHONUTF8='1'
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -c "import fastapi, pydantic, openai"
.\.venv\Scripts\python.exe -m pip check
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Bash (Linux/macOS, установлен Python 3.14):

```bash
export PYTHONUTF8=1
python3.14 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -c 'import fastapi, pydantic, openai'
.venv/bin/python -m pip check
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

В Git Bash используйте `py -3.14` для создания окружения и
`.venv/Scripts/python.exe` вместо `.venv/bin/python`.
Импорты завершаются с кодом 0, `pip check` печатает
`No broken requirements found.` Установка и запуск проверены на Windows
с CPython 3.14.7; проверка Linux/Docker относится к B5.

В другом терминале:

```powershell
Invoke-RestMethod http://localhost:8000/api/health
```

```bash
curl -fsS http://localhost:8000/api/health
```

Ожидается HTTP 200 и 9 полей: `status="ok"`, `provider="rules"`,
`ai_cache="first"`, `model=""`, `model_fast=""`, `has_key=false`,
`model_status="unchecked"`, `data_hash` (12 hex), `version="0.1.0"`.
Значения выше относятся к запуску без `.env` и без экспортированных AI-настроек.
Swagger доступен на `/docs`, схема FastAPI — на `/openapi.json`.

## Настройки

Все названия моделей задаются окружением. Названий моделей в коде нет.
Для запуска без ключа `.env` не требуется. Если нужен LLM, скопируйте
`.env.example` в `.env` (`Copy-Item .env.example .env` в PowerShell,
`cp .env.example .env` в bash) и заполните локально. Не перезаписывайте существующий
`.env`: ключ не должен попадать в git, вывод команд или описание PR.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `OPENAI_API_KEY` | пусто | Ключ; health сообщает только `has_key` |
| `OPENAI_MODEL` | пусто | Основная модель; пустое значение означает rules |
| `OPENAI_MODEL_FAST` | пусто | Быстрая модель для последующих этапов |
| `OPENAI_BASE_URL` | пусто | Пустое значение оставляет стандартный URL SDK |
| `AI_PROVIDER` | `auto` | `auto`, `llm`, `rules`; rules отключает проверку OpenAI |
| `AI_CACHE` | `first` | `first`, `fallback`, `0`; кэш реализуется в B3 |
| `MAX_TOOL_ROUNDS` | `6` | Положительный лимит раундов для B4 |
| `ANALYZE_CONCURRENCY` | `2` | Положительный лимит параллельности для B4 |

Если выбрана LLM и заданы ключ и основная модель, lifespan проверяет
`AsyncOpenAI.models.list()` с таймаутом 120 с и `max_retries=1`.
`model_status="ok"` означает наличие ID в списке, `not_in_list` — отсутствие,
`unchecked` — отсутствие конфигурации или ошибку SDK. Ошибка списка не мешает
запуску; сырое сообщение SDK в лог не попадает. Генерация ответа при старте
не выполняется. Проверка списка может задержать готовность сервера на время
таймаута и одной повторной попытки.

## Проверки B0

Из корня клона, PowerShell:

```powershell
$env:PYTHONUTF8='1'
.\.venv\Scripts\python.exe -m pytest -q backend/tests
.\.venv\Scripts\python.exe -m ruff check backend
.\.venv\Scripts\python.exe -m ruff format --check backend
Set-Location backend
..\.venv\Scripts\python.exe -m pytest -q
..\.venv\Scripts\python.exe -m app.cli --version
```

Из корня клона, bash:

```bash
export PYTHONUTF8=1
.venv/bin/python -m pytest -q backend/tests
.venv/bin/python -m ruff check backend
.venv/bin/python -m ruff format --check backend
cd backend
../.venv/bin/python -m pytest -q
../.venv/bin/python -m app.cli --version
```

На этапе B0 ожидается: **10 passed** без сети из корня и из `backend/`,
Ruff check — `All checks passed!`, format check — `11 files already formatted`,
CLI печатает `0.1.0`. Маркер `slow` зарегистрирован; обычный pytest исключает
его, полный перебор B1 запускается явно через `python -m pytest -q -m slow`.
Команда `evaluate` и эталонные числа Score относятся к B1.

При приёмке B0 на Windows проверен живой uvicorn: `/api/health` и `/docs`
отвечают HTTP 200; health содержит 9 полей, `data_hash="1172683703cf"`,
`provider="rules"`, `has_key=false`, `model_status="unchecked"`.
Локальный `.env` существует, но ключ и модель не заполнены. Поэтому живые
`models.list()` и короткий `responses.create()` не выполнялись; доступные
аккаунту модели ещё не подтверждены. Для проверки B3 нужны ключ и выбранные
модели в локальном `.env`.

Официальный Python SDK используется согласно
[документации OpenAI: список моделей](https://developers.openai.com/api/reference/python/resources/models/methods/list)
и [Responses API](https://developers.openai.com/api/reference/python/resources/responses/methods/create).
