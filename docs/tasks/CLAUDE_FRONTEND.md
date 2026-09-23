# Задание для Claude: фронтенд «Пульт акима», README и демо

Ты — фронтенд-инженер и «упаковщик» команды lowtap на хакатоне (спец-трек Astana Innovations, кейс «Аким на 5 часов»). Работаешь в этом репозитории. Второй исполнитель (Codex) параллельно делает бэкенд в `backend/` по заданию `docs/tasks/CODEX_BACKEND.md` — прочитай его разделы 4, 5, 7: это общий контракт. Цель команды — выиграть трек; пользователь прямо просил «топ-проект с выдающимся визуалом». Жюри оценивает работоспособность (25), техническую реализацию (25), README и воспроизводимость (25), ценность (15), оригинальность (10).

Перед началом прочитай целиком: `docs/VISUAL_SPEC.md` (главный документ для тебя), `docs/TASK_SPEC.md`, `docs/PLAN.md` (разделы 3, 4, 7, 8, 10, 12), `data/*.json`, `data/scenarios/*.json`.

## 1. Твоя зона и границы

**Владеешь:** `web/**`, `README.md`, `docs/DEMO.md`, `docs/PITCH.md`, `docs/screenshots/**`, `docs/demo.gif`.
**Не трогаешь:** `backend/**`, `scripts/**`, `Dockerfile`, `docker-compose.yml`, `.github/**`, `docs/ARCHITECTURE.md`, `docs/PLAN.md`, `docs/VISUAL_SPEC.md`, `data/**` (кроме чтения). Нужен другой контракт или данные — опиши в PR, решает человек.

## 2. Git-правила

- В `main` попадают только squash-merge готовых этапов (см. ниже), прямых коммитов в `main` нет. Ветки по этапам: `feat/web-scaffold`, `feat/web-pult`, `feat/web-verdict`, `feat/web-timeline`, `feat/web-compare`, `docs/readme`. От свежего `main`: `git fetch origin; git switch -c feat/web-pult origin/main`.
- Перед push: `git fetch origin; git rebase origin/main`; `cd web; npm test` и `npm run build` зелёные.
- Мержишь сама, человека не ждёшь. Условие merge: `npm test` и `npm run build` зелёные после `git rebase origin/main`. Команды: `git fetch origin; git rebase origin/main` (на своей ветке) → `git switch main; git pull --ff-only` → `git merge --squash feat/web-pult` → `git commit -m "feat(web): ... (stage F1)"` (в теле: что сделано, как проверить, скриншот в `docs/screenshots/`, вопросы) → `git push origin main` (отклонён? `git pull --ff-only` и повторить) → `git push origin --delete feat/web-pult; git branch -D feat/web-pult`. PR на GitHub не нужен. Отчёт этапа дублируй в чат человеку. Следующий этап — новая ветка от свежего `origin/main`.
- Conventional Commits: `feat(web): map with real district boundaries`.
- Windows 11: команды для PowerShell и bash; никаких `make`.

## 3. Стек (зафиксирован, по VISUAL_SPEC §6)

React 19 + Vite + TypeScript, Tailwind 4 (`@theme` — только токены и утилиты), `motion` (framer-motion 12), `zustand`, модульные `d3-geo`, `d3-scale`, `d3-shape`, `d3-interpolate`, `@fontsource-variable/unbounded`, `@fontsource-variable/golos-text`, `@fontsource-variable/jetbrains-mono`, `lucide-react`, `vitest`, Playwright (один smoke-тест), `openapi-typescript` (dev, типы из `/api/openapi.json` когда бэкенд появится). Версии фиксирует `package-lock.json`.
**Не ставим:** ECharts/Recharts, shadcn/ui, react-router (экран в сторе + `location.hash`), dnd-kit, react-markdown, topojson-client, d3-selection/transition/zoom, three/mapbox/deck.gl.
`vite.config.ts`: alias `@data` → `../data`, `server.fs.allow: ['..']`, proxy `/api` → `http://localhost:8000`. Папка `web/dist` в `.gitignore`; коммитится только на тегах (`git add -f web/dist`), это делает человек.

## 4. Контракт с бэкендом (совпадает с CODEX_BACKEND.md)

- Районы `esil | almaty | saryarka | baikonur | nura`; меры `M1..M14`; решение `{measure_id, district | null}` (`type=city` → `null`); сценарий `{decisions: []}`.
- Эндпоинты: `GET /api/health`, `GET /api/config`, `POST /api/validate`, `POST /api/evaluate` (422 `{ok:false, violations[]}` на невалидном), `POST /api/analyze?stream=0|1&provider=auto|rules` (`stream=1` — SSE события `trace`, `report`, `done`; читать через `fetch` + `ReadableStream`).
- Схемы `EvalResult`, `AnalysisReport`, `Violation`, коды валидатора — раздел 7 задания Codex. До появления бэкенда типы описываешь вручную в `web/src/types/api.ts` по этому разделу; потом заменяешь на сгенерированные.
- **Фронт полностью работает без бэкенда:** локальный TS-движок считает всё, записка строится из `MemoTemplate.ts` по тем же фактам, `lib/api.ts` при недоступном `/api` прозрачно уходит в локальный режим и показывает бейдж «офлайн».
- Пермалинк: `#/pult?d=M7:nura,M8:nura,M10:nura,M12,M5:saryarka`.

## 5. TS-движок (`web/src/engine/`) — зеркало Python

Правила расчёта — раздел 5 задания Codex, слово в слово (лаг, синергии в районе `district_from` без лага, clip, N_crit строго <40 после clip по всем 5×10, Score, таймлайн `эффект × max(0, q − lag)/8` с синергией целиком с квартала `max(lag_a, lag_b) + 1`, Шепли по 32 подмножествам, компоненты формулы). Файлы: `score.ts`, `validate.ts` (12 кодов, все нарушения сразу, приоритет причины блокировки на карточке), `timeline.ts`, `contributions.ts`, `whatif.ts` (мера на каждом из 5 районов + блок несовместимых), `neighbors.ts`.
Тесты `engine.test.ts`: все `data/scenarios/*.json` через `expected` (5 валидных — score/cost/n_crit с допуском 5e-4; 12 невалидных — ровно тот код); порядок решений; синергия без лага; clip; Q0 == база, Q8 == score. `engine.parity.test.ts`: когда Codex положит `data/golden.json`, прогнать все кейсы с допуском `1e-6` по всем полям `EvalResult` (score, d_avg, n_crit, 50 индикаторов, timeline, waterfall). До этого тест помечен `skip` с понятной причиной.
«Официальный» Score в UI подписывается только при 6/6 валидатора (локально) или по ответу сервера; всё остальное — «предварительная оценка», `--ink-2`, пунктир. В dev при расхождении локального и серверного Score — предупреждение в консоли.

## 6. Что строим (сжатая версия VISUAL_SPEC; детали, размеры, токены, motion — там)

Три экрана, отполированных до конца: **Пульт → Вердикт → Сравнение**. Светлая тема на демо; dark-токены задаются с первого часа, но не полируются.

- **Пульт** (70 % демо): карта настоящей Астаны из `data/astana_districts.geojson` (`geoMercator` + `fitExtent`, у каждого района рисуется крупнейший полигон, эксклавы opacity 0.35, подписи по центроиду крупнейшего полигона, заливка по `D_d` шкалой 40–80, штриховка `<40` пульсирует пока N_crit > 0), каталог 14 мер по направлениям с лимитами и одной приоритетной причиной блокировки, click-to-place (мера → клик по району; `type=city` ставится сразу, пины на всех районах), 5 гнёзд «час n/5» в шапке, правая рейка: тики бюджета, Score-герой (предварительно/официально, spring только на подтверждённом изменении), три карточки формулы `0.7·D_avg + 0.3·min D − N_crit` с базой, строки районов с крит-бейджами, полоса валидатора 6/6, пресеты (5 валидных + «Невалидный: бюджет»), undo. Ghost-превью при наведении на меру/район: карта, число, матрица переходят в «что если» за 200 мс. Две кнопки: «Рассчитать» (мгновенно: локальный движок + шаблонная записка; при доступном бэкенде — `provider=rules`) и «AI-анализ» (`/api/analyze?stream=1`, трасса приходит по SSE, текст — после guard).
- **Вердикт:** Score-герой с досчётом от базы, пара «Q0/Q8» карты, waterfall вкладов (Шепли, сумма == дельта), slope-график районов, AgentTrace карточками по `kind`, записка акиму (`MemoDocument`: абзацы + чипы-числа, бейдж «N/N чисел подтверждены движком», hover на evidence подсвечивает факт), блок «Что это значит для города», рекомендации с «Примерить» (ghost) и «Применить».
- **Таймлайн 8 кварталов** (внизу Пульта): линейка, маркеры `lag+1`, скраббер, Play (500 мс/квартал), перекраска районов по q, пин загорается в квартале `lag+1`, снятие критической пары in-place (штриховка гаснет, `− N_crit 2` перечёркивается в `1`). Hotkeys: Space, Esc, Ctrl+Z, M.
- **Сравнение:** 5 строк-сценариев (пресеты + текущий), мини-карты, маркеры на гистограмме распределения из `/api/config.distribution` (до бэкенда — `data/plan_distribution.json`, когда появится).
- **Матрица 5×10** до/после (вкладка) с подсветкой `<40`.

Анти-паттерны из VISUAL_SPEC §2.4 обязательны к соблюдению (никаких одинаковых скруглённых карточек, тёмного «war-room», эмодзи-маркеров, odometer на hover).

## 7. Этапы, приёмка, что сдавать

Каждый этап — ветка и PR с описанием «что сделано / как проверить / скриншот / вопросы».

**F0. Скаффолд (1 ч) → PR `feat/web-scaffold`.** `npm create vite@latest web -- --template react-ts`, зависимости раздела 3, `tokens.css` (light + dark-токены из VISUAL_SPEC §2.1), шрифты, grid-каркас Пульта под 1280×720 с пустыми рейками, стор (`scenario.ts` с undo, `ui.ts`), `lib/{api,format,geo,permalink}.ts`, `types/api.ts` по контракту, минимальные `engine/score.ts` + `validate.ts` с 3 эталонами в vitest. Приёмка: `npm run dev` показывает каркас; `npm test` зелёный; `npm run build` без ошибок.

**F1. Пульт без пинов (5 ч) → PR `feat/web-pult`.** Карта, каталог, гнёзда, правая рейка, валидатор, пресеты, undo, две кнопки (пока обе — локальный движок + шаблонная записка в панели). Полный TS-движок + `engine.test.ts` по всем сценариям. Приёмка: пресет «Пример из ТЗ» показывает `56.54`, `95`, N_crit 0, три карточки формулы дают в сумме Score; «Невалидный: бюджет» блокирует расчёт и показывает причину; невалидный набор никогда не показывает официальный Score. **СТОП 1: можно сдавать.**

**F2. Пины, ghost, Вердикт (4–5 ч) → PR `feat/web-verdict`.** Пины и what-if на 5 районах, ghost-превью, режим постановки; Вердикт целиком (waterfall, slope, AgentTrace, MemoDocument, рекомендации); подключение к `/api/analyze` (SSE) с fallback на локальный режим; parity-тест с `data/golden.json`. Приёмка: с запущенным бэкендом «AI-анализ» показывает трассу и записку с бейджем подтверждённых чисел; без бэкенда — та же страница в офлайн-режиме. **СТОП 2.**

**F3. Таймлайн и матрица (3 ч) → PR `feat/web-timeline`.** Приёмка: Play от Q0 до Q8, Q8 совпадает с официальным Score, снятие критической пары видно на карте.

**F4. Сравнение и полировка (2.5 ч) → PR `feat/web-compare`.** Экран Сравнения; проверка на 1280×720 и 1440×900 одним лейаутом; `prefers-reduced-motion`; пустые и ошибочные состояния; Playwright smoke: пресет «Пример ТЗ» → на экране `56.54` и `95`.

**F5. README, DEMO.md, GIF (2 ч) → PR `docs/readme`.** README собирается из скелета и `docs/ARCHITECTURE.md` (пишет Codex) по чек-листу PLAN.md §10: одна фраза + GIF; быстрый старт двумя путями (`docker compose up --build`; venv + uvicorn с `web/dist`) в PowerShell и bash; «как проверить за 5 минут» с ожидаемыми числами (52.558 / 56.543 / 55.667, 422 на `invalid_budget.json`); основной сценарий по шагам; таблица «пункт ТЗ → где в коде → как проверить»; таблица «что считает движок / что делает LLM»; пример реального ответа агента из `data/cache/demo/`; стек, структура, ограничения, потенциал развития, команда, атрибуции (OSM ODbL, шрифты OFL). `docs/DEMO.md` — сценарий 3 минуты с таймкодами и числами (PLAN.md §12). Скриншоты и GIF в `docs/screenshots/`. Приёмка: человек с чистым клоном проходит README буквально и получает работающее приложение.

**Опции после F5:** print-бриф акима, RU/KZ подписи, лидерборд (когда бэкенд отдаст `/api/scenarios`), тёмный скриншот для README.

## 8. Чего не делать

- Не менять формулу, данные и правила; не «улучшать» датасет.
- Не показывать официальный Score при невалидном наборе; не считать Score в LLM.
- Не ставить библиотеки из списка «не ставим»; не тянуть тайлы карт и внешние ресурсы в рантайме (демо офлайн).
- Не трогать `backend/`, `data/`, Docker, CI.
- Не начинать опции, пока F0–F5 не сданы.
