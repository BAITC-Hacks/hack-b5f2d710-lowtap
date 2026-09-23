# План проекта «Аким на 5 часов» — команда lowtap

Спец-трек Astana Innovations. Условие: [TASK_SPEC.md](TASK_SPEC.md). Визуальный спек: [VISUAL_SPEC.md](VISUAL_SPEC.md). Репозиторий `BAITC-Hacks/hack-b5f2d710-lowtap`, ветка `main`, сдача по тегу.

Цель — выиграть трек. Визуал — первоклассный приоритет с первого часа, параллельно с движком и AI, а не «после».

## 0. Главная идея и что продаём жюри

**Движок считает, AI объясняет и советует через инструменты движка, guard проверяет каждое число, без ключа всё работает.**

- **Один бюджет, один датасет, одна формула.** 100 у.е., 5 реальных районов Астаны, 14 мер, ровно 5 решений. Python-движок — единственный источник истины для официального Score, валидации и инструментов агента. `data_hash` датасета в `/api/config` и в футере: все стартуют с одних данных.
- **Пульт акима.** Один рабочий экран: настоящая карта Астаны (границы OSM), меры ставятся кликом, город меняет цвет ещё до клика (ghost-превью), формула ТЗ `0.7·D_avg + 0.3·min D − N_crit` написана на экране тремя карточками с зачёркнутой базой. Клиентский TS-движок даёт предварительный расчёт за <1 мс, сервер — официальный Score.
- **Правила показаны, а не рассказаны.** 6 маркеров валидатора, одна приоритетная причина блокировки на карточке, тики бюджета с «призраками» перерасхода, невалидный набор → причины, а не число; сервер отвечает тем же 422.
- **Agentic AI, которому можно верить.** Агент на OpenAI получает таблицу фактов F1..Fn и три инструмента движка; trace вызовов виден карточками; каждая рекомендация пересчитана движком; каждое десятичное число в записке — бейдж «N/N чисел подтверждены движком». Цепочка `llm → cache → rules`, всегда HTTP 200 — демо не зависит от Wi-Fi.
- **Числа, которых нет у других.** Перцентиль среди всех 694 395 валидных наборов, оптимум 57.237, «20 003 плана хуже бездействия», худший 52.041, таймлайн 8 кварталов, выведенный из формулы лага (в Q8 — точь-в-точь ТЗ).
- **Нарратив «5 решений = 5 часов смены».** Гнёзда подписаны «час 3/5», Вердикт — «Отчёт за смену», записка адресована «Кому: Акиму г. Астаны». Блок «Что это значит для города» переводит баллы в людей: доля жителей, вышедших из зоны критических показателей, у.е. на 1 % населения по районам.

Сдаём: репозиторий с тегом `v1.0`+, README с запуском в 3 команды двумя путями, тесты на эталонах, `docs/ARCHITECTURE.md`, `docs/DEMO.md`, GIF, закоммиченные реальные ответы агента, видео-страховка 60–90 с.

## 1. Что уже проверено кодом (таблица чисел + OSM)

Числа Score, стоимости и N_crit — из независимого прогона формулы ТЗ на Python (полный перебор 34 с). Они становятся эталонами pytest/vitest с допуском `abs=5e-4`.

| Проверка | Набор | Стоимость | N_crit | Score | Δ к базе |
|---|---|---|---|---|---|
| База | — | 0 | 2 (S1 38, S2 35 в Нуре) | **52.558** = 0.7·56.862 + 0.3·49.18 − 2 | — |
| Пример из ТЗ | M7 Нура, M8 Нура, M10 Нура, M12, M5 Сарыарка | 95 | 0 | **56.543** (ТЗ: ≈56.5) | **+3.99** (3.985 от неокруглённых) |
| Самый дешёвый | M9, M11, M10, M4 в Нуре + M12 | 61 | 1 (S2 Нуры 37.6) | **55.667** | +3.11 |
| Наивный аким | M3, M7, M8, M10 в Есиле + M12 | 100 | 2 (в Нуре только городская M12: D 49.18 → 49.62, S1/S2 остаются <40) | **54.009** | +1.45 |
| Худший из 694 395 | M8, M9, M10, M13 Байконур + M11 Алматы | 80 | 3 (T1 Алматы 40 → 38.25) | **52.041** — хуже бездействия | −0.52 |
| Оптимум (перебор) | M2, M3 Нура, M8 Нура, M9 Нура, M14 | 98 | 0 | **57.237** | +4.68 |
| Всего валидных наборов | — | — | — | **694 395** | квантили ≈ медиана 53.83 · P90 54.98 · P99 55.83 — сверить с `data/plan_distribution.json` после `scripts/enumerate_plans.py` в Этапе 1 |
| Хуже бездействия | — | — | — | **20 003** (≈2.9 %) | — |
| Частичные наборы (паритет движков) | M11 Алматы один / M11 Нура один | 10 | 3 / 2 | 51.687 / 52.875 | −0.87 / +0.32 |

Следствия: разброс Score 52–57 узкий → показываем дельту и перцентиль крупнее самого числа; пример ТЗ входит в топ-1 % (утверждение `56.543 > P99` проверяется в `test_enumerate_slow`); ловушки — демо-момент «тратишь 80 и делаешь хуже»; оптимизатор точный (предрасчитанный перебор), а не эвристика.

**Карта.** `data/astana_districts.geojson` (51 КБ, ~2500 точек) собран из OSM-реляций и проверен визуально: Есиль юг, Алматы восток, Сарыарка северо-запад, Байконур север, Нура запад. Overpass отдаёт 406 на POST — источник `polygons.openstreetmap.fr/get_geojson.py?id=<rel>&params=0`. У Байконура, Алматы и Есиля есть мелкие эксклавы. GeoJSON грузится напрямую через `d3-geo`; TopoJSON не используется.

| `district_id` | Датасет | OSM (kk) | relation | pop |
|---|---|---|---|---|
| `esil` | Есиль | Есіл | 3479876 | 0.27 |
| `almaty` | Алматы | Алматы | 3482819 | 0.24 |
| `saryarka` | Сарыарка | Сарыарқа | 3486954 | 0.20 |
| `baikonur` | Байконур | Байқоңыр | 8593081 | 0.13 |
| `nura` | Нура | Нұра | 20593940 | 0.16 |

Маппинг фиксируется в `data/districts.json` (`id`, `name_ru`, `name_kk`, `osm_relation`) в scaffold Этапа 0; в API и URL ходит только `district_id`.

**Окружение.** Windows 11, git 2.55, node 24, npm 11, python 3.14, docker 29; gh CLI нет; `git user.name/email` заданы локально в репозитории (`coolbay` / `beb.kz0@gmail.com` — имя при желании поменять; у остальных участников — задать у себя); в `main` уже есть коммит `docs: add project plan and task spec` (первая версия плана и ТЗ); push работает; PowerShell 5.1 с политикой выполнения по умолчанию (Restricted).

## 2. Стек и почему (таблица + стоп-правило по фронту)

| Слой | Выбор | Почему |
|---|---|---|
| Движок + API | Python 3.14 (локально и `python:3.14-slim` — одна версия), FastAPI, pydantic v2, uvicorn | Формула проверена на Python; pydantic-схемы = валидация входа + структурированный вывод LLM + источник истины для README и фронта; Swagger `/docs` — проверка жюри без UI |
| Тесты бэкенда | pytest + httpx `TestClient`; перебор 694 395 как `@pytest.mark.slow` | Эталоны, граничные тесты формулы, гардрейл AI — один `pytest -q` (<10 с без slow) |
| LLM | OpenAI Python SDK, Responses API, strict function tools, `responses.parse(text_format=…)`; ручной tool-loop, без Agents SDK | Единственный доступный ключ; ручной цикл держит `trace[]` у нас — жюри видит агентность на экране; `OPENAI_BASE_URL` — локальные модели как страховка |
| Фронт | React 19 + Vite + TypeScript + Tailwind 4 (`@theme`-токены) + motion + zustand + модульные `d3-geo/d3-scale/d3-shape/d3-interpolate` + `@fontsource-variable/*` + `lucide-react` + vitest — актуальные версии из `npm create vite@latest`, зафиксированы в `package-lock.json` (`npm ci` в CI и Docker) | По VISUAL_SPEC §6: единая палитра и анимация, карта через `geoMercator` (проекция снимает растяжение на 51° с.ш.), GeoJSON напрямую через `d3-geo` (TopoJSON не используется — файл уже 51 КБ), шрифты в бандле офлайн. **Не ставим:** ECharts/Recharts, shadcn/ui, react-router (экран в сторе + hash), dnd-kit, react-markdown, topojson-client, d3-selection/transition/zoom, three/mapbox |
| Клиентский движок | `web/src/engine/*.ts` — зеркало Python-движка | Ghost-превью и what-if <1 мс, фронт работает без бэкенда; паритет доказан golden-фикстурами (§3) |
| Хранение | JSON в `data/` + `data_hash`; SQLite (stdlib) только для опционального лидерборда | БД в must-have нет; JSON в репо — артефакт «одинаковый старт» |
| Запуск | Путь А: `docker compose up --build` (multi-stage: node build → python). Путь Б: venv + uvicorn с закоммиченным `web/dist` | Два пути в PowerShell и bash; никакого Makefile (`make` на Windows нет) |
| Качество | ruff (check + format), prettier, Playwright smoke (1 тест), GitHub Actions | 15 минут настройки, плюс в «техническую реализацию» |

**Пины `backend/requirements.txt`** (dry-run на 3.14.7, колёса бинарные): `fastapi==0.141.1 uvicorn==0.53.0 pydantic==2.13.5 pytest==9.1.1 httpx==0.28.1` + `openai` и `python-dotenv` — версии фиксируются после повторного dry-run в Этапе 0. Без `python-dotenv` в pip-пути `.env` никто не читает: `load_dotenv(ROOT/".env")` вызывается **один раз, на уровне модуля `config.py` до `Settings()`** — не в `lifespan` (там уже поздно, `has_key=false`).

**Стоп-правило по фронту.** Если к концу часа 2 в команде нет человека, пишущего React ежедневно, — vanilla TypeScript без сборки: те же `tokens.css`, та же SVG-карта через `d3-geo` (ESM, vendored в `web/vendor/`), тот же TS-движок, те же экраны. Меняется способ сборки, не дизайн. Решение принимает тимлид, фиксируется в README.

## 3. Архитектура и поток данных (схема ASCII, два движка и паритет, роли LLM, guard, fallback)

```
┌──────────────────── Браузер: web/ (React 19 + Vite + TS) ─────────────────────┐
│ Пульт → Вердикт → Сравнение (screen в zustand + location.hash, пермалинк ?d=…) │
│ web/src/engine — TS-зеркало: validate·score·whatif·timeline·contributions·     │
│ neighbors → ghost-превью <1 мс, предварительная оценка (пунктир)               │
│ «Рассчитать» (TS-движок + MemoTemplate → подмена на /api/analyze?provider=rules)│
│ «AI-анализ» (агент, /api/analyze?stream=1)                                     │
└──────────────┬─────────────────────────────────────────────┬───────────────────┘
               │ HTTP JSON                                    │ SSE: только события trace,
┌──────────────▼──── FastAPI: backend/app/api/routes.py ──────▼───────────────────┐
│ GET /api/health · GET /api/config · POST /api/validate · POST /api/evaluate     │
│ POST /api/analyze → evaluate → FactTable → provider-цепочка → guard → 200       │
│ exception_handler(RequestValidationError) → 422 {ok:false, violations[]}        │
│ (опц.) /api/scenarios · /api/compare · /api/event · /api/report ·               │
│ StaticFiles(web/dist) после /api                                                │
└─────────┬──────────────────────────────────────────┬────────────────────────────┘
┌─────────▼─── engine/ (чистый Python, не импортирует ai/) ─┐ ┌▼──────── ai/ ────────────────────┐
│ models.py pydantic-схемы (истина) · catalog.py data_hash  │ │ llm.py  LLMClient: structured_call │
│ validator.py 12 кодов · scoring.py лаги/синергии/clip/    │ │         / tool_loop; openai|cache|  │
│ N_crit/Score/декомпозиция/timeline · attribution.py Шепли │ │         rules; резолвинг модели    │
│ + LOO + waterfall · search.py neighbors/best_neighbors    │◄┤ tools.py 3 strict-инструмента      │
│ facts.py FactTable · distribution.py перцентиль           │ │ agent.py tool-loop → parse         │
│ golden.py фикстуры для TS · stress.py/events.py (опц.)    │ │ rules.py · guard.py · cache.py     │
└───────────────────────────────────────────────────────────┘ │ prompts.py PROMPT_VERSION · eval.py│
                                                              └────────────────────────────────────┘
```

**Поток `/api/analyze`:** `validate → evaluate → attribution → facts` (эти три шага сервер записывает в `trace[]` с `kind="server"`), затем ветвление по провайдеру:
- `?provider=rules` (кнопка «Рассчитать», таймер 8 с) → `RuleBasedExplainer` мимо семафора и LLM, <50 мс, `provider="rules"`; в trace добавляется серверный `best_neighbors`;
- `AI_CACHE=first` (без ключа, тесты, жюри) → `cache → llm → rules`;
- `AI_CACHE=fallback` (демо с ключом) → `llm → cache(demo) → rules`;
- `AI_CACHE=0` → `llm → rules`.

Далее `tool_loop → responses.parse → guard → AnalysisReport{provider, model, trace, verified_numbers}`. Невалидный сценарий до LLM не доходит (422). Ошибка SDK / таймаут / `incomplete` / refusal / плохой JSON / занятый семафор → следующее звено цепочки, в конце `RuleBasedExplainer` с `provider="rules(fallback:<причина>)"`, HTTP 200.

**Два движка и паритет.** Python — истина. TS-движок нужен для ghost-превью, what-if на 5 районах, таймлайна и работы без бэкенда. Минимальные `score.ts` + `validate.ts` (формула ТЗ, ≤100 строк, три эталона 52.558/56.543/55.667 в vitest) B пишет в Этапе 1, чтобы не ждать бэкенд; с Этапа 2 `web/src/engine/*` владеет A и доводит его до полного зеркала. Паритет механический: `python -m app.cli golden` пишет `web/src/engine/__fixtures__/golden.json` — все пресеты, все `invalid_*`, частичные наборы (1–4 меры), 50 случайных валидных наборов (seed 42) → полный `EvalResult` (score, d_avg, min, n_crit, 50 индикаторов, timeline, waterfall); `engine.parity.test.ts` прогоняет TS-движок с допуском `1e-6`. Golden хранит `data_hash` и `engine_version`; `test_golden.py` падает, если файл устарел. **Правило таймлайна (одинаково в обоих движках):** Score(q) считается по эффектам `эффект × max(0, q−L)/8`; синергия пары входит целиком (без рампы) с квартала `q = max(L_a, L_b) + 1` — первого, когда обе меры дают ненулевой эффект; `N_crit(q)` считается по clip'нутым `I'(q)`; `Q0 == база`, `Q8 == Score` по формуле ТЗ. В UI «официальный» Score подписывается только по ответу сервера (или при 6/6 валидатора локально — по спеку), предварительный — `--ink-2` и пунктир; в dev при расхождении — предупреждение в консоли.

**Роли LLM (все через один адаптер):** аналитик — структурированный отчёт по FactTable; советник — агент с инструментами движка, рекомендации с пересчитанной дельтой; опционально ведущий событий — текст новости о шоке (эффект из `events.json`, быстрая модель). Свободный текст пользователя в промпт не попадает — только ID мер и районов.

**Guard (после любого провайдера):** (a) каждая `recommendations[i].decisions` → `validate + evaluate`, сервер перезаписывает `score/delta/cost`, ставит `verified=true` или `invalid_reason`; (b) evidence без существующего F-id удаляется, утверждение помечается; (c) factcheck **только чисел с десятичной точкой** (`[+−\-–]?\d+[.,]\d{1,2}`, нормализация `,`→`.`, `−/–`→`-`, допуск ±0.005) против чисел FactTable и результатов инструментов; целые и константы ТЗ (100, 5, 8, 0.7, 0.3, веса, pop) — whitelist; результат `verified_numbers{total, confirmed, unverified[]}`, ничего не блокируется и не перегенерируется. Evidence-id — основной механизм, числа — дополнительный.

**Пути и кодировка.** `ROOT = Path(__file__).resolve().parents[2]`, `DATA_DIR = ROOT/"data"`, `WEB_DIST = ROOT/"web"/"dist"` — работает из `cd backend; uvicorn`, из Docker и из pytest в любом каталоге. `PYTHONUTF8=1` должен быть в окружении **до старта Python**: Docker — `ENV` в Dockerfile, локально — `$env:PYTHONUTF8=1` / `export PYTHONUTF8=1`; плюс `sys.stdout.reconfigure(encoding="utf-8")` первой строкой `main.py` и `cli.py`; JSON `ensure_ascii=False`.

## 4. API-контракт и схемы (эндпоинты, Scenario/Violation/EvalResult/AnalysisReport, коды ошибок, 422)

Схемы живут в `backend/app/engine/models.py` (pydantic v2) и только там; README и `ARCHITECTURE.md` ссылаются на них; фронт получает типы из `/api/openapi.json` (`openapi-typescript`, dev-зависимость).

| Метод | Путь | Выход | Заметки |
|---|---|---|---|
| GET | `/api/health` | `{status, provider:"llm"\|"rules", ai_cache:"first"\|"fallback"\|"0", model, model_fast, has_key, model_status:"ok"\|"not_in_list"\|"unchecked", data_hash, version}` | резолвинг модели при старте |
| GET | `/api/config` | районы, меры, правила, `baseline:52.558`, `distribution{count:694395, worse_than_baseline:20003, quantiles, bins}`, `data_hash` | всё из `data/*.json` |
| POST | `/api/validate` | `{ok, violations[]}` | 200 при структурно корректном JSON |
| POST | `/api/evaluate` | `EvalResult` \| **422** `{ok:false, violations[]}` | без LLM, <5 мс |
| POST | `/api/analyze?stream=0\|1&provider=auto\|rules` | `AnalysisReport` (200 для валидного) \| 422 | `provider=rules` — мимо семафора и LLM, <50 мс; `stream=1` → `text/event-stream`: события `trace` (серверные шаги, затем по одному на вызов инструмента), `report` (полный JSON после guard), `done`; фронт читает `fetch` + `ReadableStream` |
| POST/GET | `/api/scenarios`, `/api/scenarios/{id}` | сохранённый `EvalResult` + `team` | опция: SQLite, одна запись на команду, `id` = 12 hex `sha256` канонического JSON |
| GET | `/api/compare?a=&b=` | различия + комментарий агента | опция |
| POST | `/api/event` | `{event, budget_after, eval_before, eval_after, violations_after}` | опция (§11) |
| GET | `/api/report?d=` | записка markdown (бриф акима) | опция (§11 #9) |

```
Decision       {measure_id: str, district: str | null}   # «Город» → district=null; существование id проверяет
                                                          # validator.py (UNKNOWN_*), enum из 5 id — только в strict-схемах tools.py
Scenario       {decisions: Decision[]}                    # длину проверяет валидатор (NOT_FIVE), не pydantic
Violation      {code, message (ru), decision_idx: int | null, measures: str[]}
EvalResult     {ok: true, scenario_id, score, baseline: 52.558, delta, percentile: float | null,
                cost, remaining, d_avg, min_district: {id, name_ru, d}, n_crit,
                components: {d_avg_term, min_term, crit_term, *_base},          # три карточки формулы
                critical_pairs: {before[], after[], closed[], new[]},
                districts: {id: {d_before, d_after, delta, indicators_before[10], indicators_after[10], deltas[10]}},
                contributions: {M7: {shapley, loo, per_unit}},
                waterfall: [{label, kind: "measure"|"synergy"|"crit", delta}],  # канонический порядок, сумма == delta
                synergies_triggered: [{pair, district_id, indicator, bonus}],
                timeline: [{q, score, n_crit, d: {id: value}}],                 # q = 0..8, Q8 == score
                data_hash, engine_version}
Fact           {id: "F12", key: "district.nura.d_after", value: 52.96, text_ru}
Claim          {text, evidence: str[]}                                          # F-id
Recommendation {change, decisions: Decision[], rationale, score, delta, cost, verified: bool, invalid_reason: str | null}
TraceStep      {n, kind: "server"|"agent", tool, input, output_summary, ms, ok}
AnalysisReport {summary, strengths: Claim[], risks: Claim[], consequences: Claim[], tradeoffs: Claim[],
                city_impact: Claim[], recommendations: Recommendation[],
                provider: "llm"|"cache"|"rules"|"rules(fallback:…)", model, prompt_version,
                trace: TraceStep[], verified_numbers: {total, confirmed, unverified: str[]}, cached: bool}
```

**Коды валидатора:** `NOT_FIVE`, `DUPLICATE`, `UNKNOWN_MEASURE`, `UNKNOWN_DISTRICT`, `DISTRICT_REQUIRED`, `DISTRICT_FORBIDDEN`, `DIRECTION_LIMIT`, `INCOMPATIBLE_M1_M3` (в любых районах), `CONFLICT_M4_M7`, `CONFLICT_M5_M13` (один район), `BUDGET_EXCEEDED` («превышение на N у.е.»), `BAD_REQUEST` (структурно сломанный JSON через `RequestValidationError`-хендлер, та же форма). Возвращаются все нарушения, не первое; `DUPLICATE` проверяется до `DIRECTION_LIMIT`, лимит считает уникальные меры; сообщения по-русски. Тесты в `test_api`: `{"measure_id":"M99"}` → 422 `UNKNOWN_MEASURE`; `{"measure_id":"M7","district":"nura "}` → 422 `UNKNOWN_DISTRICT` (`decision_idx` заполнен); `{"decisions":"x"}` → 422 `BAD_REQUEST` той же формы.

**Семантика 422.** `/api/evaluate` и `/api/analyze` на невалидном наборе → `422 {ok:false, violations[]}` — «Score не считается, валидатор возвращает причину». `/api/validate` → 200 при структурно корректном JSON; битый JSON → 422 `BAD_REQUEST` той же формы на любом эндпоинте. Ошибки LLM никогда не дают 5xx.

**Пермалинк.** Фронт держит набор в hash: `#/pult?d=M7:nura,M8:nura,M10:nura,M12,M5:saryarka`; сервер отдаёт `scenario_id` (канонический хэш, порядок решений не влияет) — им ключуются кэш, лидерборд и `/api/compare`.

## 5. Структура репозитория (дерево с комментариями)

```
hackalem/
├── README.md  LICENSE (MIT)  .env.example  # OPENAI_API_KEY OPENAI_MODEL OPENAI_MODEL_FAST OPENAI_BASE_URL AI_PROVIDER=auto AI_CACHE=first MAX_TOOL_ROUNDS=6 ANALYZE_CONCURRENCY=2
├── .gitattributes                 # * text=auto eol=lf · *.png *.gif *.woff2 binary — первым в scaffold
├── .gitignore                     # .env .venv/ __pycache__/ .pytest_cache/ .ruff_cache/ node_modules/ web/dist/* *.db data/cache/* !data/cache/demo/ !data/cache/eval/
├── .github/workflows/ci.yml       # pytest -q (без slow) · ruff · vitest · npm ci && npm run build · prettier --check
├── docker-compose.yml             # app: build ., ports 8000:8000, env_file .env, volume ./data/cache
├── Dockerfile                     # multi-stage: node:24-alpine (COPY web/ data/ → npm ci && npm run build) → python:3.14-slim, ENV PYTHONUTF8=1
├── scripts/enumerate_plans.py     # перебор 694 395 → data/plan_distribution.json (квантили, бины 0.05, топ-20, worse_than_baseline)
├── scripts/ai_eval.py             # мини-eval AI → data/cache/eval/*.jsonl (владеет C)
├── data/                          # заморожено после scaffold; правит тимлид
│   ├── districts.json measures.json rules.json plan_distribution.json events.json (опц., PR от D)
│   ├── astana_districts.geojson   # © OpenStreetMap contributors, ODbL (уже в репо)
│   ├── scenarios/                 # example_tz cheapest naive_esil worst_of_all optimum; invalid_* — ровно одно нарушение (тест):
│   │                              # invalid_four (пример ТЗ без M5) · invalid_six («Дешёвый» + M14: 77 у.е., сервисы 2/2)
│   │                              # invalid_dup (пример ТЗ, M8 Нура дважды вместо M5: 85) · invalid_district_required (пример ТЗ, M7 district=null)
│   │                              # invalid_city_with_district (пример ТЗ, M12 district="nura") · invalid_direction (M4 Есиль, M5 Сарыарка, M6 Сарыарка, M12, M10 Нура)
│   │                              # invalid_incompat_m1m3 (M1 Есиль, M3 Нура, M12, M10 Нура, M8 Нура: 94) · invalid_conflict_m4m7 (M4 Нура, M7 Нура, M10 Нура, M12, M8 Нура: 85)
│   │                              # invalid_conflict_m5m13 (M5 Сарыарка, M13 Сарыарка, M12, M10 Нура, M9 Нура: 89) · invalid_budget (M3 Нура, M13 Алматы, M5 Сарыарка, M7 Нура, M2: 129)
│   │                              # unknown_measure (M99) · unknown_district ("nura ")
│   └── cache/demo/*.json          # реальные ответы агента (trace + отчёт) для пресетов — коммитим
├── backend/
│   ├── requirements.txt pyproject.toml   # pytest pythonpath="." markers=slow; ruff
│   ├── app/main.py                # reconfigure utf-8; lifespan: catalog, резолвинг модели; StaticFiles(web/dist)
│   ├── app/config.py app/cli.py   # load_dotenv на уровне модуля → Settings; python -m app.cli evaluate|analyze|golden|eval <файл>
│   ├── app/api/routes.py          # §4 + exception_handler + SSE-генератор + семафор
│   ├── app/engine/{models,catalog,validator,scoring,attribution,search,facts,distribution,golden,stress,events}.py
│   ├── app/ai/{llm,prompts,tools,agent,rules,guard,cache,eval}.py   app/storage/db.py (опц.)
│   └── tests/ test_scoring test_validator test_attribution test_timeline test_api test_golden
│              test_rules_explainer test_ai_guardrail test_ai_loop test_enumerate_slow (@slow)
├── web/
│   ├── package.json package-lock.json vite.config.ts   # alias @data → ../data, server.fs.allow ['..'], proxy /api → 8000
│   ├── src/engine/  score validate timeline contributions whatif neighbors .ts · engine.test.ts (9 эталонов) · engine.parity.test.ts · __fixtures__/golden.json
│   ├── src/store/   scenario.ts (zustand + undo) ui.ts (screen, mode, q, ghost, scoreStatus)
│   ├── src/screens/ Pult.tsx Verdict.tsx Compare.tsx
│   ├── src/components/{map,catalog,score,header,bottom,verdict,compare}/   # по VISUAL_SPEC §6; verdict/MemoTemplate.ts — офлайн-шаблон записки
│   ├── src/styles/tokens.css (@theme light + dark)  src/lib/{api,sse,geo,format,hotkeys,permalink}.ts  src/types/api.ts
│   ├── e2e/smoke.spec.ts          # Playwright (владеет A): пресет «Пример ТЗ» → «56.54» и «95»
│   └── dist/                      # коммитится на тегах (pip-путь без node)
└── docs/ PLAN.md TASK_SPEC.md VISUAL_SPEC.md ARCHITECTURE.md DEMO.md PITCH.md screenshots/ demo.gif
```

## 6. Git-процесс: что делать первым, ветки, владение файлами, PR, теги, freeze

**Прямой ответ на «что делать первым»: НЕ ветку. Сначала identity у каждого и общий scaffold в `main` от тимлида** — иначе три человека создадут три разных дерева папок и три `requirements.txt`.

1. **Каждый, локально в папке репозитория (без `--global`):**
   ```powershell
   cd C:\Users\coolbay\hackalem
   git config user.name "Имя Фамилия"; git config user.email "email-привязанный-к-GitHub"
   git config --list --local; git remote -v
   ```
2. **Тимлид, единственный прямой push в `main` (Этап 0):** уборка рабочей копии (`docs/PLAN.md` = этот документ; из `docs/TASK_SPEC.md` убрать локальный путь и приватную ссылку; geojson и VISUAL_SPEC оставить) → `.gitattributes` **первым** (глобально `core.autocrlf=true`):
   ```powershell
   Set-Content -Encoding utf8 .gitattributes "* text=auto eol=lf`n*.png binary`n*.gif binary`n*.woff2 binary"
   git add .gitattributes; git add --renormalize .
   ```
   → scaffold: `.gitignore`, `.env.example` (OpenAI-переменные, `AI_CACHE=first`), `LICENSE`, `data/*.json` (UTF-8; `districts.json` с `name_kk` и `osm_relation`; `direction_tz_ru`: Транспорт→транспорт, Экология→озеленение, Соцсфера→социальная инфраструктура, Безопасность→безопасность, Сервисы→городской сервис), дерево `backend/app/**/__init__.py`, пины, **заглушка `engine/scoring.py`** (EvalResult правильной формы, `baseline=52.558`), `main.py` с `/api/health` и статикой, `npm create vite@latest web -- --template react-ts` + зависимости §2 + `tokens.css`, Dockerfile/compose, CI, README-скелет →
   ```powershell
   git add -A; git commit -m "chore: scaffold backend, web, data, CI and README skeleton"; git push origin main
   ```
   После push открыть вкладку **Actions**: если в org отключены — бейдж заменяется выводом `pytest -q` в README, локальный зелёный прогон — условие merge.
3. **Все:** `git pull`, затем ветки по зонам.

| Роль | Ветки (одна ветка — один squash-merge) | Владеет (один файл — один владелец до merge) |
|---|---|---|
| A — движок + API | `feat/engine`, `feat/api`, `feat/web-waterfall` | `app/engine/*`, `app/api/*`, `cli.py`, `scripts/enumerate_plans.py`, `tests/test_scoring\|validator\|attribution\|timeline\|api\|golden\|enumerate_slow`, `web/src/engine/*` (B создаёт минимум в Этапе 1, A владеет с Этапа 2), `web/e2e/*`, `web/src/components/verdict/ContributionWaterfall.tsx`, `web/src/lib/sse.ts` |
| B — фронт | `feat/web-pult`, `feat/web-verdict`, `feat/web-timeline` | `web/*` кроме файлов A, `docs/screenshots/*`, `demo.gif` |
| C — AI + упаковка | `feat/ai-rules`, `feat/ai-structured`, `feat/ai-agent`, `docs/readme` | `app/ai/*`, `tests/test_ai_*`, `test_rules_explainer`, `scripts/ai_eval.py`, `data/cache/demo/*`, README, `ARCHITECTURE.md`, `DEMO.md`, Dockerfile, compose, CI |
| D (если есть) — продукт | `docs/pitch`, `feat/events` | `PITCH.md`, видео, RU/KZ, ревью README/DEMO.md; `data/events.json` — исключение из заморозки: PR от D, merge тимлидом |

`requirements.txt`, `package.json`, `data/*.json`, `engine/models.py` после scaffold правит только тимлид. Данные заморожены после Этапа 0.

**Цикл:** мелкие коммиты, Conventional Commits (`feat(engine): validator incompatibilities`); перед push `git fetch origin; git rebase origin/main`; `git push -u origin feat/engine` → ссылка «Create a pull request» → PR в веб-интерфейсе GitHub (gh CLI нет) → **squash-merge** после зелёных тестов (CI или локально `pytest -q` + `npm test`); ревью ≤ 10 минут. **Одна ветка — один squash-merge:** после merge ветку удалить и следующую начать от свежего `main` (`feat/ai-rules` → `feat/ai-structured` → `feat/ai-agent`); повторный PR из смерженной squash'ем ветки даёт конфликты при rebase. Кто спешит: `git switch feat/x; git fetch; git reset --hard origin/main` сразу после merge. При спешке с merge: `git switch main; git pull; git merge --squash feat/x; git commit -m "feat: …"; git push`. Инвариант: **`main` всегда запускается, тесты зелёные**; merge не реже раза в 3 часа.

**Порядок merge и теги:** scaffold → `feat/engine` (первым) → `feat/api` → `feat/ai-rules` (rules + адаптер + `provider=rules`) → `feat/web-pult` (СТОП 1) → **`v0.1-static`** → `feat/ai-structured` (живой structured-вызов + guard + cache) → **`v0.2-mvp`** (must-have «AI-анализ» закрыт настоящим LLM) → `feat/ai-agent` (tool-loop + trace) + `feat/web-waterfall` + `feat/web-verdict` → **`v0.3-agent`** → `docs/readme` + Docker + чистый клон → **`v1.0`** → опции дня 2 (`feat/web-timeline` первой) → `v1.1`… Тег: `git tag -a v1.0 -m "Hackathon submission"; git push --tags`. **`web/dist` на тегах:** в `.gitignore` стоит `web/dist/*`; перед тегом тимлид делает `npm run build; git add -f web/dist` коммитом `build(web): dist for v1.0` — pip-путь у жюри работает без node; между тегами dist не коммитится.

**Секреты:** `.env` в `.gitignore` с первого коммита; утёк ключ — отозвать, историю не переписывать. **Freeze за 60 минут:** только `docs/` и `fix:`; проверка на чистом клоне (§14); последний тег.

## 7. Этапы работ (часы на человека, точки сдачи; таблица параллельности A/B/C/D; вариант 2 человека / 1 день)

Часы — на человека. Итого до `v1.0` при 3 людях: **≈ 36 чел.-ч** (A 13 · B 13 · C 10) — 2 дня. Фронт-порядок из VISUAL_SPEC §7 (стоп-точки 1–3) встроен в колонку B; самая плотная клетка — B в Этапе 3, первое вырезание из неё — SSE.

| Этап | A — движок + API | B — фронт | C — AI + упаковка | D (если есть) | Точка сдачи |
|---|---|---|---|---|---|
| **0. Старт** (1 ч каждый) | identity; данные ТЗ → `data/*.json` (с `name_kk`, `osm_relation`); заглушка `scoring.py`; `/api/health`; `docker info` | identity; `npm create vite`, зависимости §2, `tokens.css` (light + dark), шрифты, проверка цифр Unbounded 48–56px | identity; **первые 15 минут: `.env`, `client.models.list()`, один живой `responses.parse` полного отчёта на `example_tz` — записать `usage.output_tokens`** (открытый вопрос №1); `.env.example`; CI | читает ТЗ; питч-тезис | scaffold в `main`, ветки созданы |
| **1. Движок · каркас · адаптер** (A 5 · B 3 · C 2) | `models`, `validator` (12 кодов), `scoring` (лаги, синергии, clip, N_crit, декомпозиция, timeline по правилу §3), `attribution` (Шепли + LOO + waterfall), `facts`, `search`, `distribution`, `enumerate_plans.py` (сверка квантилей §1), `cli.py`; все тесты §14 | минимальные `engine/score.ts` + `validate.ts` (≤100 строк, 3 эталона в vitest); grid Пульта 1280×720 (`[44][1fr][120]` × `[264][1fr][300]`), стор, `MapAstana` (geoMercator fitExtent, крупнейший полигон, эксклавы opacity 0.35, подписи по центроиду, штриховка <40, легенда) | `llm.py` (интерфейс + openai/cache/rules), `prompts.py`, `tools.py` (strict-схемы, enum районов), `rules.py`, `test_rules_explainer`, моки адаптера | `PITCH.md`, проверка Actions | **merge `feat/engine`** |
| **2. API · TS-движок · Пульт · один вызов LLM** (A 4 · B 4 · C 2) | `routes.py` (+422, `provider=rules`, SSE-каркас, семафор), `test_api`; `golden.py` → `golden.json`; TS-движок целиком (timeline, contributions, whatif, neighbors) + vitest 9 эталонов + parity | Каталог (MeasureCard 44px, лимиты, приоритетная причина, click-to-place «Город», гнёзда «час n/5»), правая рейка (BudgetTicks, ScoreHero preliminary/official, три карточки формулы, DistrictRows с крит-бейджами, ValidationStrip, CritBadge, «Пресеты ▾», undo), hover-карточка карты, кнопки «Рассчитать»/«AI-анализ» | 3a: `structured_call` → `AnalysisReport`; `guard.py`; `cache.py` (режимы `first/fallback/0`); `test_ai_guardrail` | ревью README-черновика, `DEMO.md` (черновик с C) | **СТОП 1: Пульт без пинов сдаваем** → `v0.1-static`; после merge 3a → `v0.2-mvp` |
| **3. Агент · Вердикт** (A 2 · B 4 · C 3.5) | `ContributionWaterfall` (знает формулу и attribution), `lib/sse.ts`, бины перцентиля, `test_timeline` | Пины + what-if на 5 районах + ghost (карта, число) + режим постановки (2.5); **Вердикт v1.0** (1.5): шапка + Score-герой, AgentTrace карточками по `kind`, `MemoDocument` + `MemoTemplate.ts`, чипы + VerifiedBadge, Recommendations «Примерить/Применить», SSE-клиент | 3b: tool-loop на Responses API, `trace[]` с `kind`, лимиты, семафор, `test_ai_loop`; прогрев `data/cache/demo` | видео-страховка (черновик), `events.json` (PR) | **СТОП 2** → `v0.3-agent` |
| **4. README · Docker · чистый клон** (A 1 · B 1 · C 1.5) | чистый клон, путь Б в свежем PowerShell (без Activate) и Git Bash, ruff, Playwright smoke | GIF v1.0 (ghost → постановка → Вердикт; перезапись после Этапа 5), 1280×720 и 1440×900, `prefers-reduced-motion`, prettier; кнопка «Прожить 8 кварталов» скрыта, пока Timeline не смержен | README по §10, `ARCHITECTURE.md`, `docker compose up --build` с нуля, `web/dist` в тег | скриншоты, атрибуции | **`v1.0`** (конец дня 1 / утро дня 2) |
| **5. СТОП 3 и опции** (день 2; A 3 · B 3.5 · C 2 + опции §11) | **Таймлайн 8 кварталов первым** (step-line, скраббер, Play, перекраска по q, пин в L+1, снятие крит-пары in-place, hotkeys; 2 ч), Матрица 5×10 (1 ч) | QuarterPair + DistrictSlope (1), Сравнение (1.5), «Что это значит для города» (1) | промпт-итерации + `ai_eval.py` (2); опции §11 по «баллам за час»; публичное демо | питч-дек, видео финал | **СТОП 3: полный питч** → `v1.1` |
| **6. Репетиция и freeze** (1 ч, все) | | | | | DEMO.md ×3 с таймером, офлайн-прогон, проектор, freeze за 60 мин, финальный тег |

**Параллельность.** B в Этапе 1 не ждёт бэкенд: минимальный `score.ts`/`validate.ts` и фикстуры `data/scenarios/*.json` дают все числа Пульта; с Этапа 2 A доводит TS-движок до полного зеркала. C до merge `feat/engine` — на заглушке и FactTable-фикстуре. A после Этапа 2 уходит на фронт (waterfall, SSE-клиент, в день 2 таймлайн и матрица) — он знает формулу лучше всех; если A закончил Этап 3 раньше, начинает step-line таймлайна в день 1. Промпт-итерации — в Этапе 5 у C по таблице мини-eval.

**Вырезания до ≈ 30 чел.-ч (в этом порядке):** SSE trace → `trace` приходит целиком в `report` (−1.5: A `sse.ts` 0.5, B клиент 0.5, C `emit` 0.5); `ContributionWaterfall` → таблица вкладов под тремя карточками формулы (−1 A); Playwright + ruff/prettier (−0.5 A); GIF → 3 скриншота (−0.5 B); «Примерить» (ghost рекомендации) → только «Применить» (−0.5 B); hover-карточка карты и раскрытие MeasureCard с LagStrip (−0.5 B); бины перцентиля → только `count`/`worse_than_baseline` (−0.5 A); `test_ai_loop` — только 2 случая (строка в `function_call_output`, `incomplete` → rules) (−0.5 C); Docker multi-stage → один python-stage с закоммиченным dist (−0.5 C). Итого −6 → 30.

**Вариант «2 человека / 1 день» (≈ 22–24 чел.-ч, по 11–12 ч на человека).** P1 = A + C, P2 = B. Обязательны Этапы 0, 1, 2, 4. Вырезания внутри Этапов 1–2: без TS-движка и golden-паритета — предварительная оценка через `POST /api/evaluate` на частичном наборе (`percentile: null`, debounce 60 мс; −4 ч A); без `distribution`/перебора — `plan_distribution.json` уже в репо (−0.5); без `stress`/`events`/`ai_eval` (−1); 3b (tool-loop) только при ≥ 4 ч запаса — иначе один structured-вызов + серверная трасса (validate → evaluate → best_neighbors выполняет код, `kind:"server"`); без SSE; Шепли остаётся (20 строк); кэш только для 5 пресетов; `test_ai_loop` не пишется; без пинов на карте (район выбирается в карточке меры), без таймлайна, матрицы и Сравнения (пресеты и перцентиль остаются на Пульте); Вердикт упрощённый (Score-герой, три карточки, таблица вкладов, записка из `MemoTemplate.ts`/rules, рекомендации «Применить»); React только если P2 пишет его ежедневно, иначе vanilla TS; Docker без multi-stage (dist в репо); без Playwright и публичного демо; `docs/` = README + ARCHITECTURE + DEMO. Расклад: P1 — Этап 0 1.5, Этап 1 5.5 (движок 4 + rules/адаптер/промпты 1.5), Этап 2 3.5 (routes + `test_api` 2, structured_call + guard + кэш 1.5), Этап 4 1 = 11.5; P2 — Этап 0 1, Этап 1 3, Этап 2 4, Вердикт упрощённый 2, Этап 4 1 = 11.

## 8. Визуал и UX (концепт «Пульт акима», токены, типографика, экраны, motion, порядок сборки фронта — сжатая версия спека со ссылкой на docs/VISUAL_SPEC.md за деталями)

Полный спек — [VISUAL_SPEC.md](VISUAL_SPEC.md); ниже — обязательный минимум, проверяемый при merge `feat/web-*`.

**Концепт.** Стол акима при дневном свете: пять реальных районов лежат на столе как живая карта, меры ставятся кликом, город меняет цвет до подтверждения. Три отполированных экрана: **Пульт → Вердикт → Сравнение**. Одна светлая тема на демо; dark-токены в `tokens.css` с первого часа, без QA и без места в питче. Всё офлайн: векторные контуры, шрифты в бандле.

**Токены (`:root`, Tailwind 4 `@theme`):** `--bg #F2F5F7` · `--panel #FFFFFF` · `--line #D8DEE6` · `--ink #0B1622` · `--ink-2 #5B6B7C` · `--accent #137F96` («Ишим», единственный интерактивный цвет) · `--gold #B8841C` («Байтерек», **только деньги**) · `--up #1F8A64` · `--down #C2452F` (критические <40 — заливка + диагональная SVG-штриховка 4px) · `--paper #FBFAF6`. Шкала карты, домен 40–80: `#DCEFF3 → #9ED3DE → #56AEC1 → #1F7F98 → #0E5468`. Дивергентная Δ: `--down → --panel → --up`, домен ±3 для ΔD, ±1 для ΔScore. Цвета направлений (только 3px-полоски и сегменты бюджета): Транспорт `#4C7BD9`, Экология `#5C9E7A`, Соцсфера `#C4784A`, Безопасность `#8A63C9`, Сервисы `#5F7C8A`. Палитра своя, без отсылок к флагу.

**Типографика (`@fontsource-variable`):** Unbounded 500/600 — только число Score (44–64px), номер квартала, названия экранов из 1–2 слов; Golos Text — весь UI и записка (15/1.55); JetBrains Mono с `tabular-nums` — все числа, ID мер, коды показателей, формула. Формат: Score и дельты — 2 знака со знаком (`+3.99`), показатели — 1 знак, стоимость — целое золотом.

**Пульт (70 % демо).** CSS-grid под 1280×720, растущий до 1920×1080; строки `[44][1fr][120]`, столбцы `[264 catalog][1fr map][300 score]`; без прокрутки страницы.
- Header: «ПУЛЬТ АКИМА»; 5 гнёзд (`M7 · Нура` / `M12 · город`, пустое «— час 3/5 —»); бейдж «КРИТ 2»; справа одна кнопка **«Пресеты ▾»** (меню из 6 строк с числами: `Пример ТЗ 56.54 / 95 · Дешёвый 55.67 / 61 · Наивный аким 54.01 / 100 · Худший 52.04 / 80 · Оптимум 57.24 / 98 · Невалидный: бюджет — / 129`) и отдельная «Сброс» — семь кнопок в 280px не помещаются.
- Catalog: 5 секций с счётчиком «ТРАНСПОРТ · 1/2»; MeasureCard 44px (раскрывается до 68px с LagStrip «лаг 3 · 62 %» и чипами эффектов); состояния `default | hover(ghost) | placing | placed | blocked`; **одна причина блокировки, самая ранняя по приоритету:** «5/5 — снимите меру» → «лимит: Соцсфера 2/2» → «несовместимо с M3» → «+28 → 109/100». При 5/5 режим постановки не открывается.
- Map: SVG, `geoMercator().fitExtent` padding 40 по GeoJSON из `lib/geo.ts`; **крупнейший полигон каждого района, эксклавы opacity 0.35 без подписей, подписи по центроиду крупнейшего полигона**; Байконур — только код и число; пины 22px с полосой направления (смещения 0/+26/−26px), «Город» — пины 16px на всех районах; слои `districts → hatch → whatif-labels → pins → ghost → selection`; легенда `D · T1…C2 · Δ`; hover — «Нура · D 49.18 · pop 16 % · крит 2 · слабее всего: S2 35». Линия Ишима — если найдётся 30 минут на polyline из OSM.
- Score-рейка: BudgetTicks (100 тиков, потраченные — цвет направления, остаток — золото, перерасход — красные призраки за край; «остаток не влияет на Score»); ScoreHero (`scoreStatus`: серое с пунктиром «ПРЕДВАРИТЕЛЬНО · 3/5» → «ASTANA QUALITY OF LIFE SCORE» + чип дельты + перцентиль-гистограмма 260×32 по `plan_distribution.json`); **три карточки формулы** `0.7 × D_avg` / `0.3 × min D` / `− N_crit` с текущим и зачёркнутым базовым значением; DistrictRows (pop-бар, bullet-bar 40–80, дельта, крит-бейдж «S1 38 · S2 35»); ValidationStrip — 6 маркеров (ровно 5 · без повторов · ≤2 на направление · районы · несовместимости · бюджет) с причиной только при нарушении; кнопки «Рассчитать» (мгновенно: TS-движок + `MemoTemplate.ts`, затем подмена на серверную rules-записку; без бэкенда остаётся шаблон с бейджем «шаблон»), «Прожить 8 кварталов» (видна только со смерженным Timeline), «AI-анализ →» (только при 6/6).
- Bottom: вкладки «8 КВАРТАЛОВ» (step-line Score(q), пин в L+1, скраббер, Play; футер «эффект × max(0, q−L)/8 · в Q8 = формула ТЗ») и «МАТРИЦА 5×10» (50 чисел, дивергентный фон, штриховка <40, ghost-дельты) — обе в Этапе 5; до этого bottom-строка показывает три карточки формулы крупно.
- Интеракции: hover меры → ghost-превью (карта, число пунктиром `52.56 → …`, матрица), debounce 60 мс; клик «Город» → ставится сразу; клик «Район» → режим постановки с what-if ярлыками ΔScore на всех 5 районах, лучший — обводка, несовместимые — штриховка и блок клика; клик по пину/гнезду → «Переставить / Снять»; клавиши `Space`, `Esc`, `Ctrl+Z`, `M`.

**Вердикт («Отчёт за смену»).** Шапка: «ВЕРДИКТ», «Сценарий #… · 95 / 100 у.е.», гнёзда, Score-герой `52.56 → 56.54` (spring 64px), чип `+3.99`, «лучше ≈N % · до оптимума −0.69». Левая колонка: ContributionWaterfall (канонический порядок по ID, «Город» последними; синергии и «снятие критических» отдельными столбиками; сходится точно); QuarterPair (Q0 | Q8) и DistrictSlope (толщина ∝ pop) — Этап 5. Правая: **AgentTrace карточками только из реального `trace[]`**: `kind:"server"` серые (`validate ✓ · evaluate ✓ 56.54 · facts ✓ F1..F37`), `kind:"agent"` с `--accent` (например `best_neighbors ✓ {n}`, `{n}` — из длины реального массива; состав агентских шагов берётся из ответа, не из спека), переключатель «офлайн-режим»; **MemoDocument** на `--paper`: «Кому: Акиму г. Астаны · От: Аналитический штаб», разделы ИТОГ / СИЛЬНЫЕ СТОРОНЫ / РИСКИ / ПОСЛЕДСТВИЯ / КОМПРОМИССЫ / ЧТО ЭТО ЗНАЧИТ ДЛЯ ГОРОДА / РЕКОМЕНДАЦИИ (те же разделы в `RuleBasedExplainer` и `MemoTemplate.ts`); текст приходит целиком после guard, рендерится абзацами (fade-in 200 мс); чипы-числа mono с подчёркиванием, hover подсвечивает столбик waterfall / район / строку slope; бейдж **«11/11 чисел подтверждены движком»** (`--down` и пунктир при расхождении); бейдж провайдера `llm | cache | rules | шаблон`; Recommendations — 1–3 карточки «Перенести M3 Есиль → Нура · +Δ → N · бюджет 0» с «Примерить» (ghost) и «Применить» (возврат на Пульт, Score катится). Кнопки: «Сравнить» (со смерженным Compare, иначе «На Пульт» с раскрытым меню пресетов), «На Пульт», «Переанализировать».

**Сравнение.** Ровно 5 строк × 140px: мини-карта 200×130 в той же шкале, гнёзда + бюджет-полоска, Score Unbounded 28px, дельта, «КРИТ n», перцентиль; предзаполнено **Базовый 52.56 · Пример ТЗ 56.54/95 · Дешёвый 55.67/61 · Оптимум 57.24/98 · Ваш**; внизу гистограмма 694 395 с маркерами. Строки других команд — только если бэкенд хранит сценарии.

**Motion.** Анимируется только то, что выводится из данных. Easing `cubic-bezier(0.2, 0.8, 0.2, 1)`; 150/200/300/450/500 мс; ничего дольше 1.2 с; `prefers-reduced-motion` — всё мгновенно. Заливка районов — CSS `transition: fill 300ms` (не d3-transition: DOM принадлежит React); Score — `useSpring` (120/20) только при подтверждённом изменении, ghost — пунктир без spring; постановка пина — падение 250 мс + кольцо по `clipPath` района + тики гаснут stagger 12 мс; playback — 500 мс/квартал, пин загорается в L+1, штриховка гаснет in-place, `− N_crit 2` перечёркивается в `1`, подпись «S1 40.0 ✓» 1.5 с; единственный idle-цикл — пульсация штриховки (3 с) пока N_crit > 0. Запрещено: карточки-плитки, тени, градиенты, glassmorphism, спиннеры, skeleton, каретка, эмодзи, gauge/пончики/прогресс-бар Score, радары, лендинг, тосты по центру, Inter/Roboto.

**Порядок сборки фронта (часы в §7):** (1) scaffold + токены + grid + стор + минимальный `score.ts` → (2) карта → (3) каталог + гнёзда → (4) правая рейка + пресеты + валидатор → **СТОП 1: Пульт без пинов сдаваем** → (5) пины + what-if + ghost → (6) Вердикт с шаблонной запиской, trace, чипы, рекомендации; затем кэш; затем SSE trace → **СТОП 2** → (7) таймлайн → (8) матрица → **СТОП 3: полный питч** → (9) QuarterPair + slope, Сравнение → (10) полировка, GIF, проектор. Print-бриф — только после GIF и трёх прогонов питча, таймбокс 2 ч, при провале кнопка убирается.

## 9. AI-слой (адаптер, промпт-контракт, инструменты, tool-loop на Responses API, guard, кэш, rules, мини-eval, лимиты)

**Роль по ТЗ:** аналитик-советник акима; объясняет, сравнивает, советует на основе посчитанных чисел; числа не считает и не придумывает.

**Адаптер `backend/app/ai/llm.py` — first-class сущность:**
```python
class LLMClient(Protocol):
    async def structured_call(self, system: str, user: str, schema: type[BaseModel]) -> BaseModel: ...
    async def tool_loop(self, system: str, user: str, tools: list[Tool],
                        final_schema: type[BaseModel], trace: list[TraceStep]) -> BaseModel: ...
# реализации: OpenAIClient (основная) · CacheClient (data/cache/**, демо и тесты) · RulesClient (без сети)
```
Движок не импортирует `ai/`; `ai/` вызывает движок только через `tools.py`. Смена провайдера — один файл; тесты мокают `LLMClient`, не SDK.

**Env и резолвинг модели.** `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODEL_FAST` (короткие тексты, резерв при 429), `OPENAI_BASE_URL` (Ollama/LM Studio best-effort), `AI_PROVIDER=auto|llm|rules`, `AI_CACHE=first|fallback|0` (`first` — кэш до LLM: без ключа, тесты, жюри; `fallback` — LLM первым, при ошибке/таймауте/семафоре → кэш демо → rules: демо с ключом; `0` — без кэша), `MAX_TOOL_ROUNDS=6`, `ANALYZE_CONCURRENCY=2`. В `lifespan`: `client.models.list()` → если `OPENAI_MODEL` нет в списке — предупреждение и `/api/health.model_status="not_in_list"` (вызов всё равно пробуется); без ключа — `provider="rules"` с предупреждением в UI. **Живой вызов, список моделей и `usage.output_tokens` полного отчёта — в первые 15 минут Этапа 0; ключ и модели пока не подтверждены (открытый вопрос №1).**

**Детерминизм.** `temperature=0` там, где модель принимает параметр; для reasoning-моделей адаптер по ошибке 400 «unsupported parameter» снимает `temperature` и передаёт `reasoning={"effort":"low"}` (reasoning-токены входят в `max_output_tokens`); имя модели и `PROMPT_VERSION` входят в ключ кэша; JSONL-лог вызовов (`data/cache/log/`, в `.gitignore`) — источник примеров для README. Воспроизводимость для жюри даёт закоммиченный кэш, а не температура.

**Промпт-контракт (system, ru, `PROMPT_VERSION="2026-09-23.1"`):**
> Ты аналитик акимата Астаны. Тебе дан результат детерминированной модели в виде таблицы фактов F1..Fn. Ты НЕ вычисляешь числа: каждое число берётся из факта или результата инструмента и копируется как есть; каждое утверждение ссылается на evidence (id фактов). Хочешь оценить альтернативу — вызови `evaluate_scenario` или `best_neighbors`; не оценивай «на глаз». Не упоминай чисел, которых нет в данных. Объясняй компромиссы простым языком для управленца: summary ≤ 80 слов, ≤ 120 слов на остальные поля, ≤ 3 рекомендации. Правила: бюджет 100, ровно 5 решений, ≤ 2 на направление, несовместимости M1/M3 (везде), M4/M7 и M5/M13 в одном районе, лаг L → доля эффекта (8−L)/8, синергии M1+M2, M10+M12, M5+M6 (в районе районной меры, без лага). Каталог 14 мер и профили 5 районов: … Числа, разрешённые к цитированию: [все value из FactTable].

User: FactTable компактным JSON (~2k токенов) + «Проанализируй сценарий и предложи до 3 улучшений». **FactTable** (`facts.py`): score, baseline, delta, percentile, cost, remaining, n_crit, критические пары до/после/закрытые/новые, D_d до/после, топ-дельты показателей, вклады (Шепли), лаги с долей эффекта, синергии сработавшие/упущенные, доля бюджета по районам vs доля населения, доля населения с закрытыми критическими парами.

**Инструменты (3, strict):** `evaluate_scenario(decisions)` → компактный EvalResult или violations; `best_neighbors(decisions, objective ∈ {score, zero_crit, min_district, budget_cap}, k ≤ 5)`; `compare_scenarios(a, b)`. Схемы `{"type":"function","name":…,"strict":true,"parameters":{…,"additionalProperties":false,"required":[…]}}`; `district` — enum из 5 id + null, `measure_id` — enum из 14 id (только здесь; в API-схемах это `str`); вход валидируется pydantic; ошибка исполнителя → `{"error": "..."}`, цикл продолжается. **Вывод инструмента всегда строка:** `json.dumps(out, ensure_ascii=False, separators=(",", ":"))` — тест на тип.

**Tool-loop на Responses API (ручной, `AsyncOpenAI`):**
```python
class FallbackToRules(Exception): ...
client = AsyncOpenAI(timeout=60.0, max_retries=1)                       # api_key/base_url из env
kw = model_kwargs(MODEL)                                                # temperature=0 | reasoning={"effort":"low"}
items = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
for _ in range(settings.MAX_TOOL_ROUNDS):
    r = await client.responses.create(model=MODEL, input=items, tools=TOOLS, tool_choice="auto",
                                      max_output_tokens=16000, **kw)
    if r.status == "incomplete": raise FallbackToRules(r.incomplete_details)
    items += r.output                                                    # reasoning/message/function_call как есть
    calls = [it for it in r.output if it.type == "function_call"]
    if not calls: break
    for c in calls:
        out, err, ms = run_tool(c.name, json.loads(c.arguments))         # json → pydantic → engine
        trace.append(TraceStep(n=len(trace) + 1, kind="agent", tool=c.name, input=..., output_summary=..., ms=ms, ok=not err))
        await emit("trace", trace[-1])                                   # SSE, если stream=1
        items.append({"type": "function_call_output", "call_id": c.call_id,
                      "output": json.dumps(out if not err else {"error": err}, ensure_ascii=False)})
final = await client.responses.parse(model=MODEL, tools=TOOLS, tool_choice="none",
                                     input=items + [{"role": "user", "content": "Сформируй итоговый отчёт по схеме"}],
                                     text_format=AnalysisReportLLM, max_output_tokens=16000, **kw)
if final.status == "incomplete" or _refused(final): raise FallbackToRules("incomplete/refusal")
report = final.output_parsed                                             # далее guard.apply(report, eval_result, facts, trace)
```
`openai.RateLimitError | APIConnectionError | APITimeoutError | APIStatusError | ValidationError | FallbackToRules` → при 429 одна попытка на `OPENAI_MODEL_FAST`, затем `cache`, затем `rules`. `AnalysisReportLLM` — та же схема без серверных полей (`provider`, `trace`, `verified_numbers`; `score/cost` рекомендаций заполняет guard). Серверные шаги `validate`, `evaluate`, `facts` кладутся в `trace[]` с `kind="server"` до первого вызова модели.

**Event loop и лимиты.** Только `AsyncOpenAI`; исполнители инструментов <5 мс, inline; `asyncio.Semaphore(ANALYZE_CONCURRENCY)` на `/api/analyze` без `provider=rules` (ключ один на всех, жюри жмёт кнопку несколько раз); ожидание >20 с → `rules(fallback:busy)`; общий таймаут анализа 90 с; UI после 8 с показывает записку с `provider=rules` и подписью «черновик», AI-версия заменяет её по готовности. **SSE** — только `trace`, `report` (после guard), `done`; текст записки никогда не стримится — его нельзя проверить guard'ом по частям.

**Guard** — §3. **Кэш**: ключ `sha256(канонический JSON сценария + model + PROMPT_VERSION + tools_version)`; `data/cache/demo/<scenario_id>.json` для всех пресетов коммитятся (trace + отчёт + модель + дата) — жюри без ключа видит настоящий вывод агента, бейдж `cache`.

**RuleBasedExplainer** (`rules.py`) — тот же `AnalysisReport` из FactTable: strengths = топ-3 вклада по Шепли + закрытые критические пары; risks = меры с лагом ≥ 3 (доля эффекта), районы без мер, оставшиеся/новые <40, min-район, неиспользованный остаток; consequences = дельты по направлениям и по районам; tradeoffs = доля бюджета vs доля населения, упущенные синергии; city_impact = «Y % жителей вышли из зоны критических показателей», у.е. на 1 % населения; recommendations = топ-3 из `best_neighbors(objective="score")` (`verified=true`). Это же отдаёт `POST /api/analyze?provider=rules` на кнопку «Рассчитать»; `test_api`: `provider=rules` → все разделы непустые, `trace` — серверная трасса.

**Мини-eval (`scripts/ai_eval.py` / `python -m app.cli eval`, Этап 5):** 6–8 сценариев (5 пресетов + 2 случайных) × автопроверки: все рекомендации `verified` или с `invalid_reason`; ≥ 90 % утверждений с валидным evidence; ноль неподтверждённых десятичных чисел; при `n_crit>0` упомянута Нура и её пары; при M3/M13 упомянут лаг; ≤ `MAX_TOOL_ROUNDS` раундов; ≥ 1 вызов инструмента; финал не `incomplete`. Отчёт в `data/cache/eval/<date>.jsonl` (не игнорируется git) + таблица в README («8/8 сценариев прошли автопроверки»). Промпт-итерации — по этой таблице.

**Тесты AI (без сети):** `test_ai_guardrail` (мок отдаёт `score=99`, evidence `F999`, число «57.777» → API отдаёт число движка, evidence очищен, `unverified=["57.777"]`); `test_ai_loop` (мок `responses.create/parse`: 2 раунда, `function_call_output` — строка, ошибка инструмента продолжает цикл, лимит раундов, `incomplete` → `rules(fallback)`, занятый семафор → fallback, `AI_CACHE=first` отдаёт кэш без вызова модели, `/api/health` отвечает во время долгого мок-анализа); `test_rules_explainer` (непустые разделы, включая `consequences`, на всех пресетах).

## 10. README — чек-лист под 25 баллов

- [ ] Заголовок + одна фраза: «Аким на 5 часов» — AI-симулятор бюджетных решений по районам Астаны (детерминированный движок + агент-аналитик на OpenAI + проверка каждого числа); бейдж CI (или блок с выводом `pytest -q`, если Actions недоступны); ссылка на публичное демо (если поднято).
- [ ] **GIF в шапке** (v1.0: ghost → постановка → Вердикт; после Этапа 5: + playback) + скриншоты Пульта, Вердикта с trace и бейджем верификации, Сравнения.
- [ ] **Быстрый старт А (3 команды):** `Copy-Item .env.example .env` (bash: `cp`) → `docker compose up --build` → http://localhost:8000. **Б (без Docker и без node — `web/dist` в репо), PowerShell и bash отдельными блоками.** PowerShell без активации venv (политика Restricted по умолчанию блокирует `Activate.ps1`):
  ```powershell
  $env:PYTHONUTF8=1; python -m venv .venv
  .\.venv\Scripts\python -m pip install -r backend\requirements.txt
  cd backend; ..\.venv\Scripts\python -m uvicorn app.main:app --port 8000
  ```
  Примечание: «либо `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` и `.\.venv\Scripts\Activate.ps1`». bash: `export PYTHONUTF8=1; python -m venv .venv; source .venv/bin/activate; pip install -r backend/requirements.txt; cd backend; uvicorn app.main:app --port 8000`. Требования: Docker 24+ или Python 3.12+ (проверено на 3.14). Разработка фронта: `cd web; npm ci; npm run dev`.
- [ ] Ключ опционален: таблица переменных `.env` (включая `AI_CACHE=first|fallback|0`); «с ключом — агент, без ключа — кэш и правила; числа одинаковы»; пункт «pip-путь с ключом → `/api/health.has_key == true`».
- [ ] **Как проверить за 5 минут:** `cd backend; pytest -q` (52.558 / 56.543 / 55.667 / 54.009 / 52.041 / 57.237 + гардрейл; `pytest -m slow` — 694 395 / 20 003 / argmax == `optimum.json` / квантили), `python -m app.cli evaluate ../data/scenarios/example_tz.json`, `cd web; npm test` (9 эталонов + паритет golden), Swagger `/docs` → `POST /api/evaluate` с `invalid_budget.json` → 422, `POST /api/analyze?provider=rules` → записка без ключа, пресеты в UI, `data_hash` в `/api/config` и футере.
- [ ] Основной сценарий с ожидаемыми числами: база 52.56 → «Наивный аким» 54.01 (КРИТ 2 остаются: в Нуре только городская M12, D 49.18 → 49.62) → «Худший» 52.04 → «Пример из ТЗ» 56.54 (+3.99) при 95, КРИТ 2→0, топ-1 % → «AI-анализ» → «Применить» → Сравнение с оптимумом 57.24.
- [ ] Абзацы: округление («56.543 ≈ 56.5 из ТЗ»; дельта от неокруглённых: +3.99); «предпросмотр ≠ Score по ТЗ» (предварительная оценка при <5 мер подписана и без перцентиля); «модель рампы таймлайна»: эффект × max(0, q−L)/8, синергия с q = max(L)+1, пин в L+1, в Q8 = формула ТЗ.
- [ ] **Пример реального ответа агента:** JSON из `data/cache/demo/` (trace + отчёт), скриншот, таблица мини-eval.
- [ ] Таблица «пункт ТЗ (must/optional) → реализовано → где в коде → как проверить» (обновляется при каждом merge).
- [ ] **Таблица «критерий проверки → как закрываем → чем доказываем»:**

| Критерий из условия | Как закрываем | Чем доказываем |
|---|---|---|
| Одинаковый бюджет и данные | один `data/*.json`, `data_hash` в `/api/config`, футере и лидерборде, нет пользовательских настроек | тест стабильности `data_hash` + скриншот |
| Нельзя превысить бюджет | тики-призраки и блок в UI + `BUDGET_EXCEEDED` на сервере (422) | `test_api.py`, Swagger вживую |
| Решения влияют на показатели | матрица 5×10 до/после, карта Q0 \| Q8, ловушка 52.04 < базы | тесты движка, пресеты |
| Понятное объяснение и компромиссы | записка с разделами, evidence, чипы, бейдж верификации, waterfall | пример в README, `test_ai_guardrail` |
| Другой набор → другой Score | ghost-превью, живой пересчёт, перцентиль, пресеты 56.54 / 55.67 / 57.24 | vitest/pytest эталоны, демо |

- [ ] Таблица «что считает движок / что делает LLM» + 3 инструмента, лимиты, guard, цепочка fallback, режимы кэша, паритет двух движков (golden).
- [ ] Архитектура (схема §3) и ссылка на `ARCHITECTURE.md`; стек и почему; структура репозитория.
- [ ] Модель кратко (датасет, 14 мер с направлениями ТЗ, формула, веса, синергии в районе районной меры, несовместимости) + ссылка на `data/*.json`; перебор 694 395 и скрипт.
- [ ] Дополнительные возможности; ограничения и допущения (модель линейная, лаги упрощены, стиль текста LLM не гарантирован, без ключа — кэш/шаблон); потенциал развития (реальные данные акимата, калибровка весов, многопериодная симуляция, eGov, RU/KZ).
- [ ] Команда и роли; MIT; атрибуции: границы районов © OpenStreetMap contributors (ODbL), шрифты Unbounded / Golos Text / JetBrains Mono (SIL OFL), lucide (ISC).
- [ ] Формат сдачи: тег, ссылка на видео 60–90 с, `PITCH.md`, `DEMO.md`.

## 11. Опциональные фичи — «баллы за час» и стоп-правила

| # | Фича | Часы | Критерий жюри | Стоп-правило |
|---|---|---|---|---|
| 0 | Перцентиль среди 694 395, «20 003 хуже бездействия», пресеты «Худший»/«Оптимум» | в Этапах 1–2 | оригинальность, ценность, «изменение набора меняет Score» | — |
| 1 | Таймлайн 8 кварталов + матрица 5×10 (СТОП 3) | 3 | визуализация изменений районов (опц. ТЗ), оригинальность | первая опция дня 2; раньше него Сравнение и опции 3–13 не начинать; режется только вместе со всем днём 2 — тогда демо идёт по варианту v1.0 (§12) |
| 2 | Экран Сравнение (5 строк, гистограмма) + QuarterPair и DistrictSlope на Вердикте | 2.5 | сравнение результатов (опц. ТЗ) без бэкенда | — |
| 3 | «Что это значит для города» в людях: доля жителей вне критической зоны, у.е. на 1 % населения, индекс равенства (разброс D_d) | 1 | ценность (15) | — |
| 4 | «Улучшить сценарий» с целью (`score / zero_crit / min_district / budget_cap`) → 3 проверенных варианта | 1 | AI-рекомендации (опц. ТЗ), agentic AI | — |
| 5 | Стресс-тест L+1 («каждая мера задержится на квартал»): `engine/stress.py`, строка в записке | 0.7 | риски в цифрах | — |
| 6 | Лидерборд: `POST /api/scenarios` (Score пересчитывает сервер, одна запись на команду), `GET /api/compare` с комментарием агента, строки в Сравнении | 1.5–2 | сравнение команд (опц. ТЗ) | не начинать при <6 ч |
| 7 | События с seed: `events.json` (авария теплосети в Алматы: C1 −12, бюджет −15; смог в Сарыарке: E2 −10; наплыв учеников в Есиле: S1 −8). **Механика:** шок применяется к базовым I_dk и к бюджету; набор перевалидируется по новому бюджету → при `BUDGET_EXCEEDED` UI пишет «план не помещается: −15 у.е.», советник вызывает `best_neighbors(objective="budget_cap")`; «Score после события» = формула на шокированной базе; сравнение команд только внутри одного `event_id`; текст новости — быстрая модель, эффект — из данных | 2–2.5 | события (опц. ТЗ) | не начинать при <6 ч |
| 8 | Публичное демо (Render/Railway): серверный ключ, `ANALYZE_CONCURRENCY`, 10 запросов/мин на IP, `AI_ENABLED=0` kill-switch, ссылка в README | 1.5 | жюри пробует AI без ключа | день 2, после проверки Docker-пути |
| 9 | Бриф акима: `@media print` на Вердикте (A4) / `GET /api/report` markdown | 1–2 | презентация (опц. ТЗ) | после GIF и 3 прогонов питча; таймбокс 2 ч |
| 10 | NL what-if («а если вместо ЛРТ в Есиле — парк в Сарыарке?») → `structured_call` в strict-схему `DecisionsEdit` → движок → compare; изолированный вызов, честно в README | 1 | agentic AI | не начинать при <6 ч |
| 11 | «Голоса районов»: 5 реплик по дельтам (быстрая модель) | 1 | вау-эффект | после 1–5 |
| 12 | RU/KZ переключатель названий (`name_kk` в данных) | 0.5 | ценность для Астаны | — |
| 13 | Тёмный скриншот для README | 0.5 | — | только если всё выше отполировано |

## 12. Сценарий демо на 3 минуты (таймкоды, числа, вау-моменты)

Подготовка: fullscreen 1280×720 / 1366×768, светлая тема, `.env` с ключом и `AI_CACHE=fallback` (живой агент первым, кэш — страховка), кэш прогрет для всех пресетов, второй ноутбук с README и терминалом. Один говорит, второй кликает. Числа — из §1; числа рекомендации агента берутся из движка на репетиции. Та же последовательность — в `DEMO.md`; Playwright-smoke проверяет только пресет → 56.54/95.

| Время | На экране | Слова ведущего | Вау |
|---|---|---|---|
| **0:00–0:20** | Пульт: база **52.56**, Нура пульсирует штриховкой, «КРИТ 2», карточки формулы `0.7×56.86 = 39.80 · 0.3×49.18 = 14.75 · −2`, футер `data_hash` | «Вы — аким Астаны на 5 часов: 100 у.е., ровно 5 решений, 5 реальных районов, формула из ТЗ — вот она. У Нуры школы 38 и поликлиники 35 — минус два балла сразу. Все команды стартуют с одного датасета — вот его хэш» | карта настоящей Астаны |
| **0:20–0:50** | Hover на M7 → пунктир `52.56 → …` до клика; клик M7 → what-if на 5 районах, Нура «лучший»; Esc. Пресет **«Наивный аким»**: 100/100, **54.01** (+1.45), «КРИТ 2» остаётся, Нура красная (только городская M12: 49.18 → 49.62) | «Вижу последствия до клика. Типичный аким даёт всё богатому району: сто у.е. потрачены, плюс полтора балла, Нура так и горит» | **вау 1: ghost + what-if** |
| **0:50–1:05** | Пресет **«Худший из 694 395»**: 80/100, **52.04** (−0.52), «КРИТ 3» — T1 Алматы 40 → 38.25 | «Можно потратить 80 и сделать хуже, чем ничего: переходы в Алматы срезают T1 ниже 40 — новый штраф. Таких планов 20 003» | ловушка |
| **1:05–1:30** | Пресет **«Пример из ТЗ»**: 95/100, **56.54** (+3.99), «КРИТ 0», штриховка гаснет, «топ-1 %». Клик M9 → «5/5 — снимите меру»; снять M12 (4/5, 81 у.е., число пунктиром); клик M9 → «лимит: Соцсфера 2/2»; клик M13 → «+28 → 109/100», красные призраки за краем тиков; клик M4 → режим постановки, Нура заштрихована «M4 несовместим с M7 здесь», клик по ней заблокирован, Esc; вернуть M12 → 95/100, **56.54** | «Те же деньги в Нуру — плюс четыре балла, обе критические зоны сняты. Правила нарушить нельзя: на карточке одна причина — самая ранняя по приоритету, — а сервер отвечает тем же 422» | правила показаны |
| **1:30–1:50** | «Прожить 8 кварталов» (`Space`): Q2 — M10, M12 включаются, синергия B1 +2; **Q4 — S1 Нуры 38.0 → 40.0**, штриховка гаснет in-place, `− N_crit 2` → `1`, «S1 40.0 ✓» (пауза 2 с); **Q6 — S2 35 → 40.25**, «КРИТ 0»; Q8 — Score 56.54. **Фолбэк v1.0 (Timeline не смержен):** шаг пропускается, на Вердикте показываем DistrictRows Q0 → Q8, речь та же без «анимации» | «Школа с лагом 3 квартала даёт первый эффект в четвёртом — ровно 40.0. Кривая выведена из формулы лага: в Q8 число совпадает с ТЗ точь-в-точь» | **вау 2: красные зоны гаснут на карте** |
| **1:50–2:30** | «AI-анализ →»: Вердикт, шапка досчитывает 56.54, waterfall (меры + «синергия M10+M12» + «снятие критических +2.00»); **AgentTrace карточками** по SSE — серые серверные `validate ✓ · evaluate ✓ 56.54 · facts ✓`, затем агентские из реального ответа (например `best_neighbors ✓ {n}`); записка абзацами; hover на чип «+2.00» → столбик; бейдж **«N/N чисел подтверждены движком»**; рекомендация с проверенной дельтой → **«Применить»** → Пульт, Score катится | «AI не считает: агент получает таблицу фактов, вызывает движок как инструмент, когда хочет проверить альтернативу, и цитирует. Каждая рекомендация пересчитана сервером, каждое число сверено — вот бейдж. Применяем совет — Score растёт на глазах» | **вау 3: записка + «Применить»** |
| **2:30–2:45** | Сравнение: Базовый 52.56 · Пример ТЗ 56.54 · Дешёвый 55.67 · Оптимум **57.24** · Ваш — маркеры на гистограмме 694 395. **Фолбэк v1.0:** меню «Пресеты ▾» на Пульте с теми же числами и перцентиль-гистограмма в ScoreHero | «До оптимума из 694 395 сценариев — доли балла. Оптимум найден полным перебором, скрипт в репо» | перцентиль |
| **2:45–3:00** | Wi-Fi выключен → «AI-анализ» отвечает с бейджем `cache` (fallback по таймауту); второй экран: `pytest -q` и `npm test` зелёные, README `docker compose up --build` | «Без сети — кэш и правила, числа те же. Формула из ТЗ, тесты на эталонах, два пути запуска. Дальше — реальные данные акимата и калибровка весов. Готовы к вопросам» | воспроизводимость |

Если спросят «что если ключ отвалится» — переключатель «офлайн-режим» на полосе трассы. Если LLM упал — кэш срабатывает молча, речь не меняется.

## 13. Риски и что делать (таблица; первая строка — провайдер/ключ)

| Риск | Действие |
|---|---|
| **Ключ OpenAI не работает / нужных моделей нет / лимиты и spending cap / `incomplete` из-за лимита токенов** | Живой вызов полного отчёта + `models.list()` в первые 15 минут Этапа 0, `usage.output_tokens` в открытый вопрос №1; `OPENAI_MODEL` из реального списка, `OPENAI_MODEL_FAST` — резерв на 429; `max_output_tokens=16000`, `reasoning.effort=low`, промпт ≤120 слов на поле; `OPENAI_BASE_URL` → локальная модель best-effort; в худшем случае must-have закрывает `rules` + закоммиченный кэш, README честно это описывает |
| Нет интернета на площадке / ключ упал на демо | `AI_CACHE=fallback`: `llm → cache → rules`, всегда 200; `data/cache/demo` в репо; репетиция без Wi-Fi; хотспот |
| LLM выдумывает числа / ломает JSON | FactTable — единственный вход; evidence-id; guard пересчитывает рекомендации; factcheck десятичных с whitelist; `incomplete`/refusal → rules; `test_ai_guardrail`; подаём как фичу |
| Латентность 10–30 с; жюри жмёт кнопку несколько раз | «Рассчитать» мгновенно (TS-движок + `MemoTemplate`, затем `provider=rules`); черновик через 8 с; SSE trace показывает жизнь; `MAX_TOOL_ROUNDS=6`, таймаут 60 с, семафор 2, кэш пресетов |
| Синхронный SDK в async-роуте заморозит сервер | только `AsyncOpenAI`; тест: `/api/health` отвечает во время мок-анализа с задержкой |
| Расхождение TS- и Python-движка (clip, синергия после clip, N_crit до эффектов, T1 −2 у M11, Score на невалидном, синергия на таймлайне) | правило таймлайна §3 зафиксировано; golden из Python, parity 1e-6 в vitest, CI падает при устаревшем golden; официальный Score только с сервера; один источник JSON через `@data` |
| Ошибка в трактовке правил | эталоны §1 + граничные тесты §14 до любого UI; тесты — условие merge |
| Нет фронтендера с ежедневным React | стоп-правило §2 к концу часа 2 |
| Scope creep фронта; B не успевает к СТОП 2 | стоп-точки 1–3; waterfall и SSE-клиент у A; QuarterPair/slope/таймлайн — день 2; вырезания §7 в заданном порядке; print-бриф и тёмная тема после полировки; опции 6/7/10/11 не начинать при <6 ч |
| Карта: эксклавы, широта 51°, kk/ru названия | `geoMercator` (не сырые координаты); крупнейший полигон + бледные эксклавы; подписи по центроиду; `district_id` и таблица §1; geojson уже в репо, `server.fs.allow` для `@data` |
| Конфликты git на Windows | identity + scaffold до веток; `.gitattributes` первым + `--renormalize`; владение файлами; одна ветка — один squash-merge; rebase перед push; общие файлы правит один человек; `web/dist` только на тегах |
| Кодировка cp866 | `PYTHONUTF8=1` до старта Python (Docker `ENV`, локально `$env:`); `reconfigure` в `main.py`/`cli.py`; `ensure_ascii=False` |
| Пути при другом cwd | `Path(__file__).resolve().parents[2]`; `test_api` из корня и из `backend/` |
| В pip-пути `.env` не читается; `Activate.ps1` заблокирован политикой | `python-dotenv` в пинах, `load_dotenv` на уровне модуля `config.py`; путь Б без активации venv; чек-лист `has_key == true` в свежем PowerShell |
| CI/бейдж в приватной org недоступны | проверить Actions после первого push; иначе вывод тестов в README, локальный прогон — условие merge |
| Docker Desktop не запущен / диск не расшарен / node-stage долгий | `docker info` в Этапе 0; multi-stage кэшируется по `package-lock.json`; путь Б проверен на чистом клоне |
| Проектор 1280×720 / 1366×768, контраст | лейаут под 1280×720; проверка на проекторе в Этапе 6; `--ink` ≥ 12:1 |
| Ghost дёргается на слабом ноутбуке | debounce 60 мс; число без spring на ghost; `prefers-reduced-motion`; playback пропускается `Space` |
| Таймлайн по кварталам — интерпретация сверх ТЗ | подпись на таймлайне и абзац README; Score всегда по формуле ТЗ; тест Q8 == Score |
| README расходится с кодом | таблица «ТЗ → код → проверка» при каждом merge; схемы только pydantic; чистый клон |
| Секрет в git | `.env` в `.gitignore` с первого коммита; утёк — отозвать |
| Ноутбук/интернет падают на питче | видео 60–90 с на втором ноутбуке и телефоне; PDF-бриф; README открыт |
| Меньше людей/времени | точки сдачи после Этапов 2, 3, 4; вырезания до 30 ч и вариант «2 человека / 1 день» §7; демо-фолбэк v1.0 §12 |

## 14. Чек-лист перед сдачей (must-have, критерии проверки, правила ТЗ, формула, репозиторий)

**Must-have ТЗ:**
- [ ] Единый бюджет 100 и данные — константы в `data/`, `data_hash` в `/api/config` и футере, пользовательских настроек нет.
- [ ] Решения по 5 направлениям (`direction_tz_ru`), ровно 5 мер, UI показывает направление и счётчик «n/2».
- [ ] Автоконтроль бюджета: `POST /api/evaluate` с `invalid_budget.json` → 422 `BUDGET_EXCEEDED` «превышение на 29 у.е.»; в UI тики-призраки, причина на карточке, «AI-анализ» и перцентиль скрыты.
- [ ] AI-анализ: `/api/analyze` возвращает `AnalysisReport` с ключом (живой вызов OpenAI, минимум 3a) и без (cache/rules); `provider=rules` работает без ключа; бейдж провайдера виден.
- [ ] Score показан; `example_tz` = 56.543 (≈56.5 из ТЗ); официальный — только для валидного набора.
- [ ] Сильные стороны, риски, последствия, компромиссы, рекомендации — непустые в обоих режимах; в записке есть раздел ПОСЛЕДСТВИЯ.

**Критерии проверки ТЗ:** одинаковый старт — `GET /api/config` и `data_hash` совпадают на двух машинах; нельзя превысить бюджет — `test_api` (422 и для схемных ошибок в той же форме); решения влияют в обе стороны — матрица до/после, 56.543 vs 52.041 < базы; понятное объяснение — записка, evidence, чипы, бейдж, trace; изменение набора меняет Score — пресеты 56.543 / 55.667 / 54.009 / 57.237, ghost-превью.

**Правила ТЗ в валидаторе (тест на каждое; у каждого `invalid_*` из §5 ровно одно нарушение — отдельный параметризованный тест):** ровно 5 (`NOT_FIVE` на `invalid_four` и `invalid_six`); без повторов (`invalid_dup`; `DUPLICATE` до `DIRECTION_LIMIT`, лимит по уникальным); район обязателен для «Район» (`DISTRICT_REQUIRED`), запрещён для «Город» (`DISTRICT_FORBIDDEN`, `district=null`); ≤2 на направление (`invalid_direction`); M1×M3 в любых районах (`invalid_incompat_m1m3` с разными районами); M4×M7 и M5×M13 только в одном районе (позитивно: M4 Нура + M7 Есиль валидно; M5 Сарыарка + M13 Есиль валидно); стоимость ≤100 (100 ровно валидно — «Наивный аким»); `M99` → 422 `UNKNOWN_MEASURE`, `"nura "` → 422 `UNKNOWN_DISTRICT` (оба с `decision_idx`), `{"decisions":"x"}` → 422 `BAD_REQUEST`; невалидный → Score не считается, все причины возвращены; остаток не даёт бонуса (два валидных набора с разной стоимостью — Score только от эффектов); порядок не важен (`reversed` → тот же Score и тот же `scenario_id`).

**Формула (`approx(abs=5e-4)`, одинаково в pytest и vitest):** база 52.558; лаг (8−L)/8 (M3 даёт 50 %); синергии фиксированные, без лага, в районе районной меры пары независимо от порядка decisions (M1 Есиль + M2 → T1 +2 в Есиле; M10 Нура + M12 → B1 +2 в Нуре); clip 0..100 прямым вызовом (I=95, +16 → 100; в датасете не срабатывает); N_crit строго <40 после clip по всем 5×10, включая районы без мер (набор без мер в Нуре и без M11 Алматы → 2; «Худший» → 3; граница 39.9/40); веса ТЗ; D_avg по pop; `components` суммируются в Score; Шепли: синергия только при обеих мерах в подмножестве, валидатор количества на подмножествах не применяется, `sum(shapley) == score − baseline` (M10 Нура + M12); waterfall сходится точно; timeline: Q0 == база, Q8 == Score, пин в L+1 (M7 Нура: S1 = 40.0 в Q4; M8 Нура: S2 = 40.25 в Q6), синергия входит целиком с q = max(L пары)+1 (пример ТЗ: Q1 — B1 Нуры без +2, Q2 — с +2), N_crit(q) по clip'нутым I'(q); частичные наборы: M11 Алматы 51.687 / M11 Нура 52.875. Быстрые pytest: база, example, cheapest, naive, worst, optimum (57.237 / 98 / 0). Slow (`pytest -m slow`): count 694 395, worse 20 003, argmax перебора == `optimum.json`, квантили из `plan_distribution.json` (медиана, P90, P99, допуск 0.01), `56.543 > P99`. Vitest 9 эталонов: 6 пресетов + M11 Алматы 51.687 + M11 Нура 52.875 + `invalid_budget` → причины без Score.

**AI и паритет:** `test_ai_guardrail`, `test_ai_loop`, `test_rules_explainer` зелёные; golden актуален (`test_golden`); `engine.parity.test.ts` 1e-6 (включая `timeline`); мини-eval пройден на всех пресетах; `data/cache/demo/*.json` для всех пресетов на месте.

**Репозиторий:**
- [ ] `git clone` в пустую папку → README буквально → путь А и путь Б работают в свежем PowerShell 5.1 без изменённой политики выполнения и в Git Bash; `pytest -q`, `npm test`, Playwright smoke зелёные; CI зелёный (или вывод в README).
- [ ] `.env` не в истории; `.env.example` актуален; `web/dist` закоммичен на теге; `astana_districts.geojson` и `plan_distribution.json` на месте.
- [ ] `docs/PLAN.md` = этот документ; `TASK_SPEC.md` без локальных путей и приватных ссылок; `ARCHITECTURE.md`, `DEMO.md` (с фолбэком v1.0), `PITCH.md` соответствуют коду.
- [ ] README: чек-лист §10 закрыт; GIF и скриншоты актуальны; «Пример реального ответа агента» есть; обе таблицы полные; атрибуции OSM ODbL и шрифтов OFL.
- [ ] Все PR смержены, `main` = демонстрируемая версия, последний тег запушен, `git log` без мусора, коммиты по фичам от каждого участника.
- [ ] Демо-ноутбук: `.env` с `AI_CACHE=fallback`, venv и Docker-образ собраны, Docker Desktop запущен, вкладка открыта на Пульте, Wi-Fi- и офлайн-прогон пройдены, проектор проверен, видео и PDF на втором ноутбуке.

## 15. Открытые вопросы к команде

1. **Ключ OpenAI подтверждён живым вызовом? Что возвращает `GET /v1/models`, какие лимиты и spending cap, сколько `usage.output_tokens` уходит на полный отчёт по `example_tz`?** От этого зависят `OPENAI_MODEL`, `OPENAI_MODEL_FAST`, `max_output_tokens`, нужна ли локальная модель через `OPENAI_BASE_URL`, и закрывается ли must-have «AI-анализ» живым агентом или кэшем. Проверяется в первые 15 минут Этапа 0.
2. **Сколько человек и сколько дней?** План рассчитан на 3 человека / 2 дня (≈36 чел.-ч до `v1.0`, ≈30 с вырезаниями §7); вариант «2 человека / 1 день» (≈22–24 чел.-ч) — §7.
3. **Есть ли фронтендер, пишущий React/TS ежедневно?** Иначе к концу часа 2 включается стоп-правило: vanilla TS по той же дизайн-системе.
4. **Точный дедлайн и формат сдачи** (только репозиторий? питч вживую и с каким таймингом? видео? публичная ссылка?) — определяет публичное демо, питч-дек и запись видео.
5. **Включены ли GitHub Actions в org BAITC-Hacks?** Проверяется после первого push; иначе бейдж заменяется выводом тестов в README.
6. **Нужен ли лидерборд команд на демо** (будут ли другие команды с тем же датасетом в момент показа)? Если нет — опция 6 из §11 не делается, Сравнение остаётся на пресетах.
7. **Проектор жюри: разрешение и можно ли подключить свой ноутбук?** Лейаут под 1280×720; если показ только с их машины — заранее проверить путь Б (PowerShell без активации venv) и браузер.