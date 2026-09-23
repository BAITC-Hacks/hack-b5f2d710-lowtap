# «Аким на 5 часов» — AI-симулятор бюджетных решений по районам Астаны

Команда **lowtap** · хакатон, спец-трек Astana Innovations.

**Детерминированный движок считает Astana Quality of Life Score по формуле ТЗ, AI-аналитик объясняет результат и советует, а каждое число в его записке сверяется с движком.** Один бюджет 100 у.е., пять реальных районов Астаны на карте, 14 мер, ровно пять решений. Без API-ключа и без сети приложение работает полностью.

![Пульт акима: ghost-превью, 8 кварталов, Вердикт](docs/demo.gif)

| Пульт | Вердикт | Сравнение |
|---|---|---|
| ![Пульт](docs/screenshots/f2-pult-pins.png) | ![Вердикт](docs/screenshots/verdict-server-guard.png) | ![Сравнение](docs/screenshots/f4-compare-1280.png) |

## Что внутри

- **Пульт акима** — карта настоящей Астаны (границы OpenStreetMap, офлайн SVG). Меры ставятся кликом, город перекрашивается ещё до клика (ghost-превью), а при выборе района на всех пяти районах видна предсказанная ΔScore. Формула ТЗ `0.7 × D_avg + 0.3 × min D − N_crit` выписана на экране. Валидатор показывает 6 маркеров правил, у карточки меры одна причина блокировки, бюджет — 100 тиков.
- **8 кварталов** — проигрывание эффекта мер по формуле лага. Критическая пара Нуры гаснет прямо на карте, `− N_crit 2` перечёркивается в `1`, в Q8 число совпадает с Score по ТЗ.
- **Вердикт** — «отчёт за смену»: Q0 | Q8, вклады мер по Шепли (сумма сходится к ΔScore), изменение D районов, трасса анализа, записка акиму с бейджем «N/N чисел подтверждены движком». Рекомендации можно «Примерить» и «Применить».
- **Сравнение** — база, пример ТЗ, самый дешёвый набор, оптимум полного перебора 694 395 наборов и ваш сценарий в одной шкале, с гистограммой всех допустимых планов.

## Быстрый старт

Ключ OpenAI не обязателен: без него анализ отдаётся из сохранённых ответов агента (5 пресетов) или по правилам.

### Путь А — Docker (одна команда)

Нужен Docker с Compose. PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --build -d --wait
```

bash:

```bash
test -f .env || cp .env.example .env
docker compose up --build -d --wait
```

Откройте http://localhost:8000 — Пульт; Swagger — http://localhost:8000/docs. Образ сам собирает фронт (`node:24-alpine`) и запускает FastAPI (`python:3.14-slim`); остановка — `docker compose down`. Проверка собранного приложения по HTTP: `scripts/container_smoke.py` (см. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#docker-и-compose)).

### Путь Б — без Docker, одно приложение на :8000 (FastAPI отдаёт собранный фронт)

Нужны **Python 3.12+** (проверено на 3.14) и **Node.js 20+** (проверено на 24).

PowerShell (из корня клона; активация venv не нужна):

```powershell
$env:PYTHONUTF8='1'
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd web; npm ci; npm run build; cd ..
cd backend; ..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

bash:

```bash
export PYTHONUTF8=1
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
(cd web && npm ci && npm run build)
cd backend && ../.venv/bin/python -m uvicorn app.main:app --port 8000
```

Откройте http://localhost:8000 — Пульт; Swagger — http://localhost:8000/docs.

### Путь В — только фронт (без Python, всё считается в браузере)

```bash
cd web
npm ci
npm run dev
```

Откройте http://localhost:5173. Бэкенд не нужен: TS-движок в браузере — зеркало Python-движка (паритет доказан тестом на `data/golden.json`), записка строится по шаблону на числах движка, в шапке горит бейдж «офлайн». Если рядом запущен uvicorn на :8000, dev-сервер проксирует `/api` и приложение переходит на сервер само.

### Ключ OpenAI (необязательно)

```powershell
Copy-Item .env.example .env
```

```bash
cp .env.example .env
```

Заполните `OPENAI_API_KEY` и `OPENAI_MODEL` (id из `GET /v1/models` вашего ключа). Цепочка провайдеров — `llm → cache → rules`, ответ всегда HTTP 200. Числа одинаковы с ключом и без: LLM их не считает. Переменные окружения и режимы кэша описаны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#настройки).

## Как проверить за 5 минут

| Проверка | Команда | Ожидается |
|---|---|---|
| Тесты фронта и паритет двух движков | `cd web; npm test` | **142 passed**: эталоны 52.558 / 56.543 / 55.667 / 54.009 / 52.041 / 57.237, все 12 невалидных наборов дают ровно свой код, 71 кейс `golden.json` совпадает с Python до 1e-6 |
| UI smoke (Playwright) | `cd web; npx playwright install chromium; npm run e2e` | 2 passed: «Пример ТЗ» → 56.54 и 95/100, невалидный бюджет → причина вместо Score |
| Тесты бэкенда | `$env:PYTHONUTF8='1'; .\.venv\Scripts\python.exe -m pytest -q backend/tests` | 298 passed, 1 deselected (полный перебор — `-m slow`) |
| Эталон ТЗ в CLI | `cd backend; ..\.venv\Scripts\python.exe -m app.cli evaluate ../data/scenarios/example_tz.json` | `Score 56.543`, `cost 95`, `n_crit 0`, `percentile 99.918%`, `scenario_id efb979f1c9c1` |
| Собранный контейнер | `docker compose up --build -d --wait`, затем `python scripts/container_smoke.py` | health, 5 районов / 14 мер, 694 395 / 20 003, example 56.543 / 95 / 0, 422, SSE, HTML, 5/5 demo из кэша |
| Бюджет не превысить | Swagger → `POST /api/evaluate` с телом `data/scenarios/invalid_budget.json` | **HTTP 422**, `BUDGET_EXCEEDED`, «превышение на 29 у.е.» |
| AI-анализ без ключа | `POST /api/analyze` с `example_tz.json` (по умолчанию `AI_CACHE=first`) | `provider: "cache"` — сохранённый ответ агента, в трассе шаг `kind: "agent"`, `verified_numbers` 10/10; `?provider=rules` — записка по правилам, 21/21 |
| Пресеты в UI | «Пресеты ▾» → «Пример ТЗ» / «Дешёвый» / «Невалидный: бюджет» | 56.54 / 95, 55.67 / 61 и КРИТ 1, «+29 → 129/100» и заблокированные кнопки |
| Одинаковый старт | `GET /api/config` → `data_hash`; внизу Пульта `data 1172683703cf` | один хэш датасета на сервере и в UI |

## Основной сценарий (что делать в UI)

1. Откройте Пульт: база **52.56**, КРИТ 2, у Нуры пульсирует штриховка (школы 38, поликлиники 35 < 40).
2. Наведите курсор на «M7 Школа + детсад»: карта и число уже показывают `→ 54.01` (ghost-превью, ничего не поставлено).
3. Кликните M11 «Безопасные переходы»: на районах появятся предсказанные дельты. Алматы **−0.87** (T1 40 → 38.25, новая критическая пара), Нура **+0.32** «лучший». Esc — отмена.
4. «Пресеты ▾» → «Пример ТЗ»: **56.54** (+3.99), 95/100 у.е., КРИТ 0, валидатор 6/6, «лучше ≈99.92% сценариев».
5. Space — «Прожить 8 кварталов»: в **Q4** у Нуры появляется «S1 40.0 ✓», `− N_crit 2` перечёркивается в `1`, в **Q6** КРИТ 0, в **Q8** — те же 56.54.
6. «AI-анализ →»: Вердикт с трассой анализа, waterfall по Шепли и запиской. Наведите курсор на «+1.45» в записке — подсветится столбик M7. Наведите на «Примерить» у рекомендации «M5 → M3 Нура», затем нажмите «Применить»: Пульт, гнездо M3 подсвечено, Score **57.21**.
7. Кнопка сравнения в шапке: база 52.56 · пример ТЗ 56.54 · дешёвый 55.67 · оптимум **57.24** · ваш 57.21 на гистограмме всех 694 395 наборов.

Сценарий питча на 3 минуты с таймкодами — [docs/DEMO.md](docs/DEMO.md).

## Критерии ТЗ → как закрыты → чем доказано

| Пункт ТЗ | Реализация | Где в коде | Как проверить |
|---|---|---|---|
| Единый бюджет и данные | один `data/*.json`, `data_hash` в `/api/config` и в UI, пользовательских настроек нет | `data/`, `web/src/engine/hash.ts`, `backend/app/engine/catalog.py` | тест `data_hash` в `engine.parity.test.ts`, `/api/config` |
| Решения по 5 направлениям | каталог 14 мер по направлениям ТЗ, лимит ≤2 на направление, 5 гнёзд «час n/5» | `web/src/components/catalog/`, `validate.ts`, `validator.py` | UI, `invalid_direction.json` |
| Контроль превышения бюджета | тики бюджета с красными тиками перерасхода, блок карточки «+28 → 109/100», 422 на сервере | `BudgetTicks.tsx`, `validate.ts::blockReason`, `routes.py` | `invalid_budget.json` → 422, e2e smoke |
| AI-анализ решений | `/api/analyze`: факты движка → LLM или rules → guard; офлайн — шаблон на тех же числах | `backend/app/ai/`, `web/src/store/analysis.ts`, `MemoTemplate.ts` | Вердикт, `test_ai_guardrail.py`, `memo.test.ts` |
| Итоговый Score | формула ТЗ в двух движках с паритетом 1e-6 | `backend/app/engine/scoring.py`, `web/src/engine/score.ts` | pytest, vitest, CLI |
| Сильные стороны, риски, последствия | разделы записки: итог, сильные стороны, риски, последствия, компромиссы, «что это значит для города», рекомендации | `rules.py`, `MemoTemplate.ts`, `MemoDocument.tsx` | Вердикт |
| Опц.: сравнение команд и сценариев | экран Сравнения, 5 сценариев в одной шкале и перцентиль | `web/src/screens/Compare.tsx` | UI |
| Опц.: визуализация изменений районов | карта Q0 \| Q8, матрица 5×10, slope районов, 8 кварталов | `components/map`, `bottom/IndicatorMatrix.tsx`, `verdict/DistrictSlope.tsx` | UI (M — матрица) |
| Опц.: AI-рекомендации | соседние наборы на один шаг, каждый пересчитан движком, «Примерить/Применить» | `search.py`, `neighbors.ts`, `MemoDocument.tsx` | Вердикт |

| Критерий проверки жюри | Как закрываем | Чем доказываем |
|---|---|---|
| Все начинают с одинакового бюджета и данных | один датасет и `data_hash` | `/api/config`, футер Пульта |
| Система не позволяет превысить бюджет | блокировка в UI + `BUDGET_EXCEEDED` на сервере | e2e smoke, HTTP 422 |
| Решения влияют на показатели | 50 показателей до и после, карта, матрица, ловушка M11 (набор хуже бездействия) | тесты движка, пресет «Худший» 52.04 |
| AI объясняет результат и компромиссы | записка с разделами и evidence, проверка чисел guard'ом | бейдж «N/N подтверждены», `verified_numbers` |
| Изменение набора меняет Score | ghost-превью, what-if на 5 районах, пресеты 56.54 / 55.67 / 57.24 | UI, vitest |

## Что считает движок, что делает LLM

| Движок (Python `backend/app/engine`, зеркало TS `web/src/engine`) | LLM (`backend/app/ai`) |
|---|---|
| валидатор ТЗ: 12 кодов, все нарушения сразу | получает только таблицу фактов F1..Fn из движка, свободный текст пользователя в промпт не идёт |
| I′ = clip(I + эффект × (8−L)/8 + синергии), D, D_avg, min D, N_crit, Score | пишет разделы записки со ссылками evidence на F-id |
| вклады Шепли по 32 подмножествам, LOO, waterfall | предлагает улучшения; сервер перевалидирует и пересчитывает каждое (`verified`) |
| соседние наборы, перцентиль по полному перебору 694 395 наборов | числа не считает: guard сверяет каждое десятичное число с фактами (±0.005) |
| таймлайн Q0..Q8, what-if, ghost-превью (TS, < 1 мс) | нет ключа, таймаут или ошибка → кэш или rules, HTTP 200 |

Реальный ответ агента (OpenAI `gpt-4.1-mini`, tool-loop) на «Пример ТЗ» сохранён в [data/cache/demo/efb979f1c9c1.json](data/cache/demo/efb979f1c9c1.json) — без ключа сервер отдаёт его из кэша для всех пяти пресетов. Фрагмент:

```json
{
  "summary": "Сценарий улучшил Score до 56.54, закрыл 2 критических показателя Нуры.",
  "strengths": [{ "text": "Score вырос на 3.99 до 56.54, что лучше базового 52.56.", "evidence": ["F1", "F2", "F3"] }],
  "risks": [{ "text": "Лаг мер M7, M8 по 3 квартала, M10 — 1 квартал, эффект реализуется не сразу.", "evidence": ["F94", "F100", "F106"] }],
  "recommendations": [
    { "change": "Заменить M5 (Сарыарка) на M3 (Нура) для транспорта.", "rationale": "Повышение Score до 57.21, полный бюджет 100 у.е.",
      "score": 57.20556, "delta": 4.64788, "cost": 100, "verified": true }
  ],
  "provider": "llm",
  "model": "gpt-4.1-mini",
  "trace": [
    { "n": 1, "kind": "server", "tool": "evaluate_scenario", "output_summary": "Score 56.543; критических пар 0" },
    { "n": 2, "kind": "server", "tool": "build_facts", "output_summary": "Сформировано фактов: 120" },
    { "n": 3, "kind": "agent", "tool": "best_neighbors", "output_summary": "Проверено альтернатив: 3." },
    { "n": 4, "kind": "server", "tool": "agent_loop", "output_summary": "Получен отчёт агента; модель gpt-4.1-mini-2025-04-14; токены: вход 28923, выход 1688." },
    { "n": 5, "kind": "server", "tool": "guard_report", "output_summary": "Подтверждено чисел: 10 из 10." }
  ],
  "verified_numbers": { "total": 10, "confirmed": 10, "unverified": [] }
}
```

Шаг `kind: "agent"` — инструмент, который вызвала сама модель: она проверила альтернативы движком, прежде чем советовать. Score и дельту рекомендации сервер перезаписал своим пересчётом (`verified: true`).

Архитектура AI-слоя, guard, кэш и провайдеры описаны в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Модель (кратко)

- Датасет ТЗ: 5 районов × 10 показателей (0–100, больше = лучше), доли населения, 14 мер с направлением, типом «Район»/«Город», стоимостью, лагом и эффектами — [data/](data/).
- Доля эффекта меры с лагом L: (8 − L)/8. Синергии (M1+M2, M10+M12, M5+M6) дают фиксированный бонус без лага в районе районной меры пары. Несовместимости: M1 и M3 в любых районах, M4 и M7 или M5 и M13 в одном районе.
- `Score = 0.7 · D_avg + 0.3 · min D − N_crit`, где N_crit — число пар район × показатель строго ниже 40 после clip.
- Эталоны: база **52.558**, пример ТЗ **56.543** (95 у.е., N_crit 0; в ТЗ ≈56.5), самый дешёвый **55.667** (61, N_crit 1), оптимум полного перебора **57.237** (M2, M3 Нура, M8 Нура, M9 Нура, M14; 98 у.е.). 20 003 допустимых набора хуже бездействия.
- **Округление.** Движок хранит 10 знаков, UI показывает 2: 56.543 → «56.54», дельта считается от неокруглённых значений: +3.985 → «+3.99».
- **Предпросмотр ≠ Score по ТЗ.** Пока набор не собран по правилам (ровно 5, без нарушений), число на Пульте подписано «предварительно», стоит серым с пунктиром и не имеет перцентиля. «Astana Quality of Life Score» появляется только при 6/6 валидатора, сервер на невалидный набор отвечает 422 без числа.
- **Модель рампы таймлайна** — наша визуализация лага сверх ТЗ: к кварталу q эффект равен `эффект × max(0, q − L)/8`, синергия входит целиком с квартала `max(L_a, L_b) + 1`, пин загорается в квартале L + 1. В Q8 это ровно формула ТЗ.

## Архитектура

```
Браузер: web/ (React 19 + Vite + TypeScript)
  Пульт → Вердикт → Сравнение (экран в zustand + location.hash, пермалинк #/pult?d=M7:nura,M12,...)
  web/src/engine — TS-зеркало движка: ghost-превью, what-if, таймлайн, офлайн-режим
        │ HTTP JSON · SSE (trace → report → done)
FastAPI: backend/app/api/routes.py
  /api/health · /api/config · /api/validate · /api/evaluate · /api/analyze
  engine/ (истина: валидатор, Score, Шепли, соседи, факты, перебор)  ←  ai/ (провайдеры llm/cache/rules, guard)
  StaticFiles(web/dist) на /
```

Паритет двух движков механический: `python -m app.cli golden` пишет `data/golden.json`, `web/src/engine/engine.parity.test.ts` сверяет с ним TS-движок по всем полям `EvalResult` с допуском 1e-6.

## Стек

| Слой | Выбор |
|---|---|
| Движок и API | Python 3.14, FastAPI, pydantic v2, uvicorn, pytest, Ruff |
| LLM | официальный OpenAI Python SDK (Responses API, structured outputs), адаптер llm → cache → rules |
| Фронт | React 19, Vite 8, TypeScript 5.9, Tailwind 4 (только токены), motion, zustand, модульные d3-geo / d3-scale / d3-shape / d3-interpolate, lucide-react |
| Шрифты (в бандле, офлайн) | Unbounded (Score), Golos Text (интерфейс), JetBrains Mono (числа) |
| Тесты фронта | vitest (движок, паритет, валидатор, записка, SSE), Playwright smoke |

## Структура репозитория

```
backend/            FastAPI: app/engine (движок), app/ai (провайдеры, guard), app/api, tests
data/               датасет ТЗ, границы районов (GeoJSON), сценарии-эталоны, golden.json, plan_distribution.json
docs/               ARCHITECTURE.md, DEMO.md, PLAN.md, TASK_SPEC.md, VISUAL_SPEC.md, screenshots/, demo.gif
scripts/            enumerate_plans.py — полный перебор допустимых наборов
web/
  src/engine/       TS-движок: score, validate, timeline, contributions, whatif, neighbors, evaluate
  src/screens/      Pult, Verdict, Compare
  src/components/   map, catalog, score, header, bottom, verdict
  src/store/        scenario (набор + undo), ui (экран, режим, квартал), analysis
  src/lib/          api (офлайн-фолбэк), sse, geo, format, permalink, verify
  e2e/              Playwright smoke
```

## Ограничения и допущения

- Модель линейная и условная (датасет ТЗ синтетический); лаг упрощён до доли эффекта за 8 кварталов.
- Таймлайн по кварталам — визуализация сверх ТЗ; итоговый Score всегда считается только по формуле ТЗ.
- Guard проверяет происхождение чисел, а не смысл каждого утверждения; стиль текста LLM не гарантирован.
- Без ключа AI-анализ строится по правилам, сервер кэширует ответы LLM. Числа при этом одинаковы.
- Перцентиль офлайн считается по сжатой таблице (расхождение с сервером < 0.005 п.п.), на сервере — точно.

## Потенциал развития

Реальные показатели акимата и Smart Astana вместо синтетики, калибровка весов, многопериодная симуляция с переносом бюджета, городские события (шоки бюджета и показателей), лидерборд команд, интеграция с eGov, полный интерфейс на казахском (названия районов RU/KZ уже переключаются в шапке Пульта).

## Команда и роли

Команда **lowtap**. Бэкенд, движок и AI-слой — `backend/`, `scripts/` ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); фронтенд, визуал, README и демо — `web/`, `docs/`. Процесс: этапы в отдельных ветках, squash-merge в `main` после зелёных тестов.

## Лицензия и атрибуции

- Код — MIT, см. [LICENSE](LICENSE).
- Границы районов — © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/).
- Шрифты Unbounded, Golos Text, JetBrains Mono — SIL Open Font License 1.1; иконки lucide — ISC.
