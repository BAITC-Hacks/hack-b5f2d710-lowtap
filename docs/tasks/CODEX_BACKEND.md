# Задание для Codex: бэкенд «Аким на 5 часов» (движок, API, AI-слой, Docker, CI)

Ты — бэкенд-инженер команды lowtap на хакатоне (спец-трек Astana Innovations, кейс «Аким на 5 часов»). Работаешь в этом репозитории. Второй исполнитель (Claude) параллельно делает фронтенд в папке `web/`. Ваши зоны не пересекаются, общий контракт зафиксирован ниже. Цель команды — выиграть трек; жюри оценивает работоспособность (25), техническую реализацию с agentic AI (25), README и воспроизводимость (25), ценность (15), оригинальность (10).

Перед началом прочитай целиком: `docs/TASK_SPEC.md` (условие, датасет, формула, правила), `docs/PLAN.md` (разделы 3, 4, 5, 9, 13, 14), `data/*.json` и `data/scenarios/*.json`. Не читай `docs/VISUAL_SPEC.md` дальше раздела 6 — фронт не твоя зона.

## 1. Твоя зона и границы

**Владеешь (создаёшь и правишь только ты):**
- `backend/**` — весь Python-код, тесты, `requirements.txt`, `pyproject.toml`
- `scripts/**` — `enumerate_plans.py`, `ai_eval.py`
- `data/plan_distribution.json`, `data/golden.json`, `data/cache/demo/**`, `data/cache/eval/**` — генерируешь ты
- `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`
- `docs/ARCHITECTURE.md`

**Не трогаешь:** `web/**`, `README.md`, `docs/PLAN.md`, `docs/VISUAL_SPEC.md`, `docs/DEMO.md`, `docs/tasks/**`, `data/districts.json`, `data/measures.json`, `data/rules.json`, `data/scenarios/**`, `data/astana_districts.geojson`, `.env.example`, `.gitignore`, `.gitattributes`, `LICENSE`. Данные ТЗ заморожены. Если тебе нужно изменить контракт или данные — не меняй, а опиши в описании PR, что и зачем; решает человек.

**Для README:** свои разделы (запуск бэкенда, тесты, переменные окружения, API, AI-слой, «движок vs LLM») пиши в `docs/ARCHITECTURE.md`. Claude соберёт из них финальный `README.md`.

## 2. Git-правила

- Никогда не коммить в `main`. Ветки: `feat/backend-engine`, `feat/backend-api`, `feat/backend-ai`, `feat/backend-agent`, `feat/backend-docker` — по одной на этап, от свежего `main` (`git fetch origin; git switch -c feat/backend-engine origin/main`).
- Перед push: `git fetch origin; git rebase origin/main`; тесты зелёные (`cd backend; python -m pytest -q`).
- PR создаётся в веб-интерфейсе GitHub (CLI `gh` не установлен). В описании: что сделано, как проверить (команды и ожидаемые числа), открытые вопросы. Merge делает человек (squash). После merge ветка удаляется, следующий этап — новая ветка от `main`.
- Commit message: Conventional Commits, `feat(engine): validator with 12 codes`, `test(api): 422 shape`.
- Секреты: только `.env` (в `.gitignore`). Ключ в код, тесты, логи и PR не попадает. Если увидел ключ в diff — убери до коммита.
- Windows 11 у команды: команды в документации давать для PowerShell и bash; `make` не использовать; перед запуском Python ставить `PYTHONUTF8=1` в окружении; в `main.py` и `cli.py` первой строкой `sys.stdout.reconfigure(encoding="utf-8")`; JSON писать с `ensure_ascii=False`; пути через `Path(__file__).resolve().parents[2]` (не через cwd).

## 3. Стек (зафиксирован, не менять)

Python 3.14 (локально и в Docker `python:3.14-slim`), FastAPI, pydantic v2, uvicorn, pytest + httpx `TestClient`, `python-dotenv`, официальный `openai` Python SDK (Responses API). Пины в `backend/requirements.txt` после проверки установки на 3.14. Без Makefile, без Agents SDK, без LangChain, без БД в must-have (SQLite stdlib — только для опционального `/api/scenarios`). Ruff для lint/format.

## 4. Данные и идентификаторы (общий контракт с фронтом)

- Районы: `id` ∈ {`esil`, `almaty`, `saryarka`, `baikonur`, `nura`} (`data/districts.json`: `name_ru`, `name_kk`, `pop_share`, `indicators` T1..C2, `profile_ru`).
- Меры: `M1`..`M14` (`data/measures.json`: `direction` T/E/S/B/C, `type` `district`|`city`, `cost`, `lag`, `effects`).
- Правила: `data/rules.json` — бюджет 100, ровно 5 решений, ≤2 на направление, веса показателей, синергии (`district_from` — район бонуса), несовместимости, порог критичности 40, baseline 52.558.
- Решение: `{"measure_id": "M7", "district": "nura"}`; для мер `type=city` — `"district": null`.
- Сценарий: `{"decisions": [Decision, ...]}`. Порядок решений не влияет ни на что.
- `data/scenarios/*.json` — пресеты и невалидные наборы с полем `expected` (валидные: `score`, `cost`, `n_crit`; невалидные: ровно один код в `violations`). Это эталоны тестов.
- `data_hash` = sha256 конкатенации байтов `districts.json`, `measures.json`, `rules.json` (в этом порядке), в API — первые 12 hex.
- `scenario_id` = первые 12 hex sha256 канонического JSON: решения отсортированы по `measure_id`, затем по `district`, без пробелов (`separators=(",", ":")`).

## 5. Движок — правила расчёта (точно по ТЗ; всё покрыть тестами)

1. Доля эффекта меры: `(8 − lag) / 8`. `type=district` — эффекты в одном районе, `type=city` — во всех пяти.
2. Синергия: если выбраны обе меры пары — фиксированный бонус (без лага) в районе меры `district_from` (M1, M10, M5). Не зависит от порядка решений.
3. `I' = clip(I + Σ эффектов + синергии, 0, 100)` по каждому из 50 значений (5 районов × 10 показателей).
4. `D_d = Σ w_k · I'_dk`; `D_avg = Σ pop_d · D_d`; `N_crit` = число значений **строго меньше 40 после clip по всем 5 × 10, включая районы без мер**.
5. `Score = 0.7 · D_avg + 0.3 · min(D_d) − 1.0 · N_crit`. Остаток бюджета ни на что не влияет.
6. Эталоны: база `52.558`; `example_tz` `56.543` (95 у.е., N_crit 0); `cheapest` `55.667` (61, N_crit 1); `naive_esil` `54.009` (100, N_crit 2); `worst_of_all` `52.041` (80, N_crit 3); `optimum` `57.237` (98, N_crit 0). Полный перебор: 694 395 валидных наборов, 20 003 хуже базы. Допуск в тестах `abs=5e-4`.
7. Таймлайн (для фронта, одинаково в обоих движках): `Score(q)` для q = 0..8 считается с эффектами `эффект × max(0, q − lag) / 8`; синергия пары входит целиком с квартала `q = max(lag_a, lag_b) + 1`; `N_crit(q)` по clip'нутым `I'(q)`. `Q0 == база`, `Q8 == Score`.
8. Вклады: Шепли по 5 решениям (32 подмножества; на подмножествах правило «ровно 5» не применяется, синергия срабатывает только если обе меры пары в подмножестве; функция — полный Score с N_crit). `Σ shapley == score − baseline` (тест). Плюс leave-one-out и `per_unit = shapley / cost`. `waterfall` = 5 элементов Шепли в порядке `M1..M14`, сумма равна `delta`.
9. Декомпозиция для трёх карточек формулы: `components = {d_avg_term: 0.7·D_avg, min_term: 0.3·min, crit_term: −N_crit, d_avg_term_base, min_term_base, crit_term_base}`.
10. Перцентиль: доля валидных наборов со Score строго меньше данного, в процентах, по `data/plan_distribution.json`.

## 6. Валидатор

Коды (все нарушения сразу, не первое; сообщения по-русски; `decision_idx` где применимо; `measures` — задействованные id):
`NOT_FIVE`, `DUPLICATE`, `UNKNOWN_MEASURE`, `UNKNOWN_DISTRICT`, `DISTRICT_REQUIRED`, `DISTRICT_FORBIDDEN`, `DIRECTION_LIMIT` (лимит считает уникальные меры), `INCOMPATIBLE_M1_M3` (в любых районах), `CONFLICT_M4_M7`, `CONFLICT_M5_M13` (только в одном районе), `BUDGET_EXCEEDED` («превышение на N у.е.»), `BAD_REQUEST` (структурно сломанный JSON, через `exception_handler(RequestValidationError)` — та же форма ответа).
Позитивные тесты: `M4 nura + M7 esil` валидно; `M5 saryarka + M13 esil` валидно; `M1 esil + M3 nura` невалидно.

## 7. API-контракт (схемы — только в `backend/app/engine/models.py`, pydantic v2)

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/health` | `{status, provider: "llm"\|"rules", ai_cache, model, model_fast, has_key, model_status: "ok"\|"not_in_list"\|"unchecked", data_hash, version}` |
| GET | `/api/config` | `{districts[], measures[], rules, baseline: 52.558, distribution: {count, worse_than_baseline, best, worst, quantiles[], bins[]}, data_hash}` |
| POST | `/api/validate` | `{ok: bool, violations: Violation[]}` (200 при структурно корректном JSON) |
| POST | `/api/evaluate` | `EvalResult` \| `422 {ok: false, violations: Violation[]}` |
| POST | `/api/analyze?stream=0\|1&provider=auto\|rules` | `AnalysisReport` (200) \| 422; `stream=1` → `text/event-stream` с событиями `trace` (по одному на шаг), `report` (полный JSON после guard), `done` |
| GET/POST | `/api/scenarios`, `/api/scenarios/{id}` | опция: сохранённый `EvalResult` + `team`, одна запись на команду |

После роутов — `StaticFiles(ROOT/"web"/"dist", html=True)` на `/`, если папка существует (иначе `/` отдаёт JSON-подсказку). CORS для `http://localhost:5173` в dev.

```
Decision       {measure_id: str, district: str | null}
Scenario       {decisions: Decision[]}                    # длину проверяет валидатор, не pydantic
Violation      {code, message, decision_idx: int | null, measures: str[]}
EvalResult     {ok: true, scenario_id, score, baseline, delta, percentile: float | null,
                cost, remaining, d_avg, min_district: {id, name_ru, d}, n_crit,
                components: {d_avg_term, min_term, crit_term, d_avg_term_base, min_term_base, crit_term_base},
                critical_pairs: {before[], after[], closed[], new[]},        # элемент: {district_id, indicator, value}
                districts: {id: {d_before, d_after, delta, indicators_before[10], indicators_after[10], deltas[10]}},
                contributions: {M7: {shapley, loo, per_unit}},
                waterfall: [{label, measure_id, delta}],                    # сумма == delta
                synergies_triggered: [{pair, district_id, indicator, bonus}],
                timeline: [{q, score, n_crit, d: {id: value}}],             # q = 0..8
                data_hash, engine_version}
Fact           {id: "F12", key: "district.nura.d_after", value: 52.96, text_ru}
Claim          {text, evidence: str[]}                                      # F-id
Recommendation {change, decisions: Decision[], rationale, score, delta, cost, verified: bool, invalid_reason: str | null}
TraceStep      {n, kind: "server"|"agent", tool, input, output_summary, ms, ok}
AnalysisReport {summary, strengths: Claim[], risks: Claim[], consequences: Claim[], tradeoffs: Claim[],
                city_impact: Claim[], recommendations: Recommendation[],
                provider: "llm"|"cache"|"rules"|"rules(fallback:...)", model, prompt_version,
                trace: TraceStep[], verified_numbers: {total, confirmed, unverified: str[]}, cached: bool}
```

`/api/evaluate` и `/api/analyze` на невалидном наборе → 422 (Score не считается). Ошибки LLM никогда не дают 5xx: цепочка провайдеров всегда заканчивается `rules`, HTTP 200.

## 8. AI-слой

**Принцип:** LLM не считает числа. Вход LLM — только `FactTable` (F1..Fn: score, baseline, delta, percentile, cost, remaining, n_crit, критические пары до/после, D_d по районам до/после, топ-дельты показателей, вклады мер, лаги с долей эффекта, сработавшие и упущенные синергии, доля бюджета по районам vs доля населения) плюс каталог мер и профили районов в системном промпте. Свободный текст пользователя в промпт не попадает.

**Адаптер `backend/app/ai/llm.py`:** класс `LLMClient` с методами `structured_call(system, user, schema_model) -> model` и `tool_loop(system, user, tools, max_rounds) -> (final_model, trace)`. Реализации: `OpenAIClient` (Responses API: `client.responses.create(...)` с `tools=[{type:"function", strict: true, ...}]`, вручную обрабатываешь items `function_call` → отвечаешь `function_call_output` **строкой JSON**, финальный ответ через `client.responses.parse(text_format=AnalysisReport, tools=TOOLS, tool_choice="none")`; `temperature=0`), `CacheClient` (sha256(канонический сценарий + model + PROMPT_VERSION) → `data/cache/**.json`), `RulesClient` (не LLM: `RuleBasedExplainer` строит тот же `AnalysisReport` из FactTable по шаблонам, рекомендации из `best_neighbors`, все `verified=true`).
Цепочки по `AI_CACHE`: `first` → cache → llm → rules; `fallback` → llm → cache → rules; `0` → llm → rules. `?provider=rules` — сразу rules, мимо семафора (<50 мс). Исключения `openai.RateLimitError | APIConnectionError | APITimeoutError | APIStatusError`, `status == "incomplete"`, refusal, невалидный JSON, занятый семафор (`ANALYZE_CONCURRENCY`) → следующее звено; в `provider` пишется `rules(fallback:<причина>)`.
Асинхронность: `AsyncOpenAI` в async-роутах (или sync-клиент в `def`-роутах), таймаут 120 с, `max_retries=1`, семафор на `/api/analyze`.

**Модели:** `OPENAI_MODEL`, `OPENAI_MODEL_FAST` из `.env`. При старте (lifespan) вызывать `client.models.list()` и выставлять `model_status`; если модель не в списке — предупреждение в лог и `/api/health`, работа продолжается. Не хардкодить названия моделей в коде: только env, дефолт пустой → `provider=rules`.

**Инструменты агента (3, strict-схемы, enum из 5 district id):** `evaluate_scenario(decisions)` → компактный EvalResult или violations; `best_neighbors(decisions, objective ∈ {score, zero_crit, min_district, budget_cap}, k)` → k лучших соседей (замена меры / смена района, через валидатор); `compare_scenarios(a, b)`. Ошибки исполнителя → `function_call_output` с `{"error": ...}`, цикл продолжается. `MAX_TOOL_ROUNDS` из env.

**Guard (после любого провайдера):** (a) каждая `recommendations[i].decisions` → validate + evaluate, сервер перезаписывает `score/delta/cost`, ставит `verified=true` или `invalid_reason`; (b) evidence без существующего F-id удаляется, утверждение остаётся; (c) factcheck только чисел с десятичной точкой (regex `[+−\-–]?\d+[.,]\d{1,2}`, `,`→`.`, допуск ±0.005) против FactTable и результатов инструментов, whitelist констант ТЗ; результат `verified_numbers{total, confirmed, unverified[]}`; ничего не блокируется.

**Промпт** (`prompts.py`, константа `PROMPT_VERSION`): системный на русском — роль аналитика акимата; правила игры (бюджет 100, ровно 5, ≤2 на направление, несовместимости, лаг, синергии); «каждое число — из факта или инструмента, каждое утверждение — с evidence; хочешь оценить альтернативу — вызови инструмент»; ≤300 слов на текстовые поля. Блок `city_impact` — «что это значит для города» (люди, а не баллы). Пользовательское сообщение — FactTable JSON + «Проанализируй сценарий и предложи до 3 улучшений».

**Кэш демо:** после того как агент заработал, прогнать все 5 валидных пресетов с ключом и закоммитить ответы (trace + отчёт) в `data/cache/demo/<scenario_id>.json`. Жюри без ключа увидит настоящие ответы.

**Мини-eval (`scripts/ai_eval.py`):** 5–8 сценариев × автопроверки: все `recommendations` verified, ≥90 % утверждений с валидным evidence, ноль неверифицированных десятичных чисел, упомянуты критические пары Нуры и лаг M3/M13. Результаты в `data/cache/eval/*.jsonl`.

## 9. Этапы, приёмка и что сдавать

Каждый этап — отдельная ветка и PR. В конце этапа напиши отчёт в PR: что сделано, команды проверки с ожидаемыми числами, что не сделано и почему, вопросы.

**B0. Старт (0.5 ч).** `python -m venv .venv`, установка пинов, `python -c "import fastapi, pydantic, openai"`. Если есть `.env` с ключом — `client.models.list()` и один короткий `responses.create`; записать в отчёт доступные модели (без ключа в тексте). Скелет `backend/app/{main,config,cli}.py`, `api/`, `engine/`, `ai/`, `tests/`, `pyproject.toml` (`[tool.pytest.ini_options] pythonpath="." markers=["slow"]`), `requirements.txt`. `uvicorn app.main:app` отвечает на `/api/health`.

**B1. Движок + валидатор + тесты (4–5 ч) → PR `feat/backend-engine`.** `models.py`, `catalog.py` (загрузка `data/*.json`, `data_hash`), `validator.py`, `scoring.py` (включая timeline и components), `attribution.py` (Шепли, LOO, waterfall), `facts.py`, `search.py` (neighbors, best_neighbors), `distribution.py`, `scripts/enumerate_plans.py` → `data/plan_distribution.json` (count 694395, worse_than_baseline 20003, best, worst, 1000 квантилей, бины шага 0.05, top20), `cli.py evaluate <scenario.json>`.
Тесты: все `data/scenarios/*.json` через `expected`; порядок решений (reversed → тот же Score); синергия M1 esil + M2 → T1 +2 в Есиле, без лага, независимо от порядка; синергия не срабатывает при одной мере пары; clip прямым вызовом (I=95 + 16 → 100); граница 39.9/40; набор без мер в Нуре и без M11 в Алматы → n_crit 2; `worst_of_all` → n_crit 3; Шепли `Σ == delta` на `example_tz` (синергия M10+M12); timeline Q0 == база, Q8 == score; перебор 694 395 / 57.237 как `@pytest.mark.slow`.
Приёмка: `cd backend; python -m pytest -q` зелёный (<10 с без slow); `python -m app.cli evaluate ../data/scenarios/example_tz.json` печатает `56.543`, `95`, `n_crit 0`, перцентиль.

**B2. API + rules-объяснитель + golden (3 ч) → PR `feat/backend-api`.** `routes.py` по разделу 7 (без LLM: `provider=rules`), `exception_handler`, CORS, StaticFiles, семафор-заглушка; `ai/rules.py`, `ai/base.py`; `cli.py golden` → `data/golden.json`: массив `{name, decisions, valid, violations?, eval?}` для всех `data/scenarios`, частичных наборов (1–4 меры из `example_tz`; для них `eval` считается с флагом `allow_partial`, остальные правила действуют) и 50 случайных валидных наборов (seed 42), плюс `data_hash`, `engine_version`. Это фикстуры паритета для TS-движка фронта.
Тесты `test_api.py`: 422 `BUDGET_EXCEEDED` на `invalid_budget.json`; `M99` → 422 `UNKNOWN_MEASURE`; `"nura "` → 422 `UNKNOWN_DISTRICT` с `decision_idx`; `{"decisions":"x"}` → 422 `BAD_REQUEST` той же формы; `example_tz` → 200, `score == 56.543`; `/api/analyze?provider=rules` → непустые strengths/risks/consequences/tradeoffs, все recommendations `verified`; `/api/config.data_hash` стабилен; `test_golden.py` падает, если `data/golden.json` устарел относительно движка.
Приёмка: Swagger `/docs` открывается; команды из тестов воспроизводятся curl'ом.

**B3. Один structured-вызов OpenAI + guard + кэш (1–1.5 ч) → PR `feat/backend-ai`.** `llm.py` (OpenAIClient.structured_call, CacheClient, RulesClient), `prompts.py`, `guard.py`, `cache.py`, `config.py` (`AI_PROVIDER`, `AI_CACHE`). `test_ai_guardrail.py`: мок клиента возвращает рекомендацию со `score=99` и evidence `F999` → API отдаёт число движка, evidence очищен, `verified_numbers` заполнен. Приёмка: с ключом `/api/health` → `provider=llm, model_status=ok`; `/api/analyze` на `example_tz` возвращает отчёт с `provider="llm"`; без ключа — `provider="rules"`, HTTP 200.

**B4. Агент с tool-loop, trace, SSE (3–4 ч) → PR `feat/backend-agent`.** `tools.py` (3 strict-инструмента), `agent.py` (цикл → `responses.parse`), `trace[]` с `kind`, лимиты, семафор, SSE (`stream=1`: события `trace`, `report`, `done`). `test_ai_loop.py` с моком клиента (без сети): цикл с одним вызовом инструмента, строка в `function_call_output`, лимит раундов, `incomplete` → rules. Прогреть `data/cache/demo/` на 5 пресетах, закоммитить. `scripts/ai_eval.py` + первый прогон.
Приёмка: в ответе `/api/analyze` на `example_tz` есть `trace` с шагами `kind="agent"` (агент реально вызвал `best_neighbors`/`evaluate_scenario`); все рекомендации `verified`.

**B5. Docker, CI, ARCHITECTURE.md (1.5 ч) → PR `feat/backend-docker`.** `Dockerfile` multi-stage (`node:24-alpine`: `COPY web/ data/` → `npm ci && npm run build`; затем `python:3.14-slim`, `ENV PYTHONUTF8=1`, `uvicorn app.main:app --host 0.0.0.0 --port 8000`); если `web/` ещё пуст — stage сборки фронта делать условным (пропускать при отсутствии `web/package.json`). `docker-compose.yml` (порт 8000, `env_file: .env`, volume `./data/cache`). `.github/workflows/ci.yml`: `pytest -q` (без slow), ruff, и — когда появится `web/` — `npm ci && npm test && npm run build`. `docs/ARCHITECTURE.md`: схема, поток `/api/analyze`, таблица «что считает движок / что делает LLM», инструменты, guard, цепочка провайдеров, переменные окружения, команды запуска (Docker и venv, PowerShell и bash), команды проверки с ожидаемыми числами.
Приёмка: `Copy-Item .env.example .env; docker compose up --build` → `http://localhost:8000/api/health` отвечает; чистый `git clone` + путь через venv работает в PowerShell.

**Опции после B5 (по одной ветке):** `/api/scenarios` + `/api/compare` (SQLite, лидерборд); `stress.py` (стресс-тест «каждая мера задерживается на квартал»); `events.py` + `/api/event` (шоки с эффектами из `data/events.json`, текст — быстрая модель). Не начинать, если до дедлайна меньше 6 часов.

## 10. Чего не делать

- Не менять формулу, веса, данные и правила ТЗ «для реалистичности».
- Не позволять LLM считать: никаких промптов «посчитай Score».
- Не хардкодить названия моделей; не логировать ключ; не коммитить `.env`.
- Не создавать `web/`, не править README и docs других зон.
- Не вводить новые зависимости без необходимости (каждая — строка в `requirements.txt` с пином и одна фраза «зачем» в PR).
- Не отдавать 5xx из-за LLM.
