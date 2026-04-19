# ПомРеж — Документация проекта

## 1. Общая архитектура

Проект построен как desktop/web-гибрид с единой frontend-логикой:

- **Electron** (`electron/main.js`) поднимает приложение как desktop-обертку, запускает встроенный Express и открывает операторское окно.
- **Express** (`server.js`) раздает статику проекта и предоставляет API `POST /api/osc` для отправки OSC через UDP.
- **Vanilla JS** (`js/script.js`, `js/stateManager.js`, `js/constants.js`) реализует всю бизнес-логику оператора, состояние, таймеры, синхронизацию экранов, OSC, импорт/экспорт.
- **SortableJS** подключен, но drag-and-drop reorder в текущей версии фактически отключен (`initializeSortable` сразу `return`), приоритет у кнопок `↑/↓` и контекстного меню.
- **xlsx** используется для импорта сценария из Excel.
- **osc-min** используется на сервере для OSC-пакетов.

### Схема потока данных

Базовый паттерн соблюден:

`Операторский UI -> window.appState -> notifyStateChange() -> postMessage -> screen.html (Stage/Tech/Speaker/Prompter)`

Ключевые детали:

- `window.appState` — единый источник истины.
- `notifyStateChange()` централизованно:
  - диспатчит `appStateChanged`,
  - отправляет `STATE_UPDATE` всем открытым экранам,
  - обновляет UI оператора (таймер, cue-bar, статусбар, визуальные классы),
  - запускает debounced autosave.
- Для перехода cue применяется `setActiveAction()`: сначала DOM `.active`, затем `syncStateFromDomOrder({ notify: false })`, затем `notifyStateChange()` (архитектурно корректно).

### Роль ключевых файлов

- `index.html` — операторский интерфейс: меню, сценарий, sticky cue-bar, таймер, модальные окна OSC/кастомизации/заметок.
- `screen.html` — универсальный шаблон экранов (`type=stage|tech|speaker|prompter`) с рендером только из состояния.
- `js/script.js` — основной orchestration-слой: UI-события, show lifecycle, OSC-команды, таймер, screen management, import/export, hotkeys.
- `js/stateManager.js` — state core: shape-гидрация, синхронизация состояния из DOM, notify-цикл, `setActiveAction`.
- `js/constants.js` — константы версий, тем, message types, action types, дефолтные OSC-команды.
- `server.js` — HTTP+OSC-шлюз (Express + UDP via `osc-min`).
- `electron/main.js` — single-instance, запуск embedded server, window lifecycle, IPC для системных диалогов/файлов.
- `styles.css`, `css/speaker-screen.css`, `css/screen-cards.css`, `css/fireworks.css` — стили оператора/экранов, карточек, сплэша и эффектов.

## 2. Основные модули и их назначение

### `index.html` + `script.js` (операторский UI)

- Управление cue-листом: создание, удаление, дублирование, перестановка, GO/DONE, контекстное меню.
- Управление временем: запуск cue, пауза/resume, отображение `elapsed/total`.
- OSC:
  - глобальные команды (`onPause`, `onResume`, `onNext`, `onShowEnd`),
  - cue-специфичные (`onStart`, `onEnd`),
  - тест соединения.
- Работа с show-файлами: save/save as/open (через Electron IPC или browser download/input), localStorage-слой.
- Импорт Excel через `xlsx`.
- Кастомизация экранов Speaker/Tech + пресеты.
- Управление окнами экранов и их жизненным циклом.

### `screen.html` (экранная часть)

- Принимает `INIT_STATE`, `STATE_UPDATE`, `APPLY_THEME`, `APPLY_SPEAKER_CUSTOMIZATION`, `SYNC_SCROLL`.
- Имеет отдельные рендереры:
  - `renderStage`,
  - `renderTech`,
  - `renderSpeaker`,
  - `renderPrompter`.
- В speaker/prompter реализована синхронизация скролла суфлера в обе стороны.
- Есть fallback-синхронизация через `window.opener.appState` и interval-тикер.

### `stateManager.js` (управление состоянием)

- Инициализация и поддержание формы `appState` (в т.ч. миграция старых данных).
- `notifyStateChange()` как единая точка публикации state.
- `syncStateFromDomOrder()` строит `appState.actions` из текущего DOM-порядка и `dataset.actionId`.
- `setActiveAction()` корректно делает cue текущим и опционально сбрасывает таймер.

### `server.js` + OSC

- `POST /api/osc` принимает JSON (адрес/аргументы/host/port).
- Нормализует аргументы для `osc-min`.
- Формирует OSC buffer и отправляет по UDP (`dgram`).
- Есть `GET /health` для readiness-check.
- Поддержка диагностического режима `OSC_DEBUG=1`.

### `electron/main.js` (десктопная обертка)

- Single instance lock.
- Старт embedded Express-сервера и ожидание `/health`.
- Создание BrowserWindow c preload.
- IPC:
  - save/open dialogs,
  - save to path,
  - message box,
  - quit,
  - open external URL,
  - devtools.

## 3. Ключевые подсистемы

### Управление сценарием (cue, GO/DONE, reorder, таймер)

- Cue-модель хранит `id/title/type/notes/plannedStart/durationSec/completed/script*` и OSC-настройки.
- **GO (▶)**: делает cue активным, запускает/перезапускает таймер, отправляет `cue onStart`, обновляет экраны.
- **DONE (✓)**: только переключает completed; для активного cue отправляет `cue onEnd`, для последнего — `onShowEnd` и завершает шоу.
- Reorder в проде реализован через:
  - кнопки вверх/вниз,
  - контекстное меню (`moveAfterActive`, `move up/down`),
  - drag-and-drop код есть, но отключен.
- Таймер вычисляется по корректной формуле:
  - run: `Date.now() - startedAt - accumulatedPause`,
  - pause: `pausedAt - startedAt - accumulatedPause`.

### OSC-интеграция (глобальные команды, покьюшные)

- Глобальные OSC-команды хранятся в `appState.oscSettings.globalCommands`, имеют дефолты и миграцию.
- Для cue можно задать индивидуальные `onStart/onEnd` с аргументами-шаблонами (`{title}`, `{id}`, `{duration}`, `{type}`).
- Frontend отправляет OSC через HTTP API, backend уже шлет UDP.
- Есть визуальная индикация OSC-настроек на cue и тестовая команда `/ping`.

### Синхронизация экранов (Stage, Tech, Speaker, Prompter)

- Экраны открываются отдельными окнами `screen.html?type=...`.
- Оператор хранит ссылки в `window.openScreens`, отправляет всем `STATE_UPDATE`.
- Экраны рендерят состояние сами, без прямого DOM-доступа к операторскому окну.
- Добавлен fallback `syncFromOpener()` + интервал 1 сек для устойчивости при частичной потере сообщений.

### Строгий режим суфлера (`strictScriptSync`) и адаптивный промптер

- В strict-режиме фиксируются точные параметры рендера: width/height/font/lineHeight/padding.
- Синхронизация идет не только по проценту скролла, но и по `scrollTopPx` (важно для pixel-perfect соответствия).
- Prompter поддерживает:
  - адаптивный расчет размеров под контейнер,
  - зеркальный режим (`mirrorScript`),
  - отдельный screen mode.

### Заметки к cue (множественные)

- Заметки хранятся массивом объектов `{id, text}`.
- Поддержаны:
  - drag note из note-creator,
  - modal-редактор заметок cue,
  - inline edit/delete,
  - dropdown summary на карточке cue.

### Кастомизация экранов (Speaker, Tech)

- Настройки в `speakerCustomization` и `techCustomization`:
  - видимость блоков,
  - пресеты layout,
  - размер шрифтов,
  - theme/logo,
  - спец-параметры strict script для speaker.
- Настройки сохраняются в localStorage и включаются в show-файл.

## 4. Анализ стабильности и выявленные риски

### Общая оценка стабильности

Архитектура **в целом стабильная и рабочая** для production use в рамках локального desktop/web сценария:

- Есть единая модель состояния.
- Есть централизованная публикация изменений.
- Критичные функции (`setActiveAction`, таймер, экранная синхронизация) структурированы корректно.
- Есть совместимость старых данных и fallback-механизмы.

При этом присутствуют технические риски, способные давать редкие сбои под нагрузкой и в edge-cases.

### Текущие проблемные места

1. **Монолитность `script.js` (~4300+ строк)**  
   Высокая связанность UI/state/network/window logic увеличивает риск регрессий при локальных правках.

2. **Гибрид state<->DOM синхронизации**  
   Большая часть логики корректно идет через `appState`, но `syncStateFromDomOrder()` регулярно “считывает истину” из DOM. При сложных гонках событий это может кратковременно перетирать состояние.

3. **Отключенный Sortable при сохраненном коде**  
   Поведение reorder формально безопасно, но наличие “мертвого” DnD-кода может путать сопровождение и тестирование.

4. **Интервальные механизмы на экранах**  
   `setInterval`-перерисовка и fallback через `opener` устойчивы, но могут:
   - давать лишний рендер,
   - в неактивных вкладках/окнах сталкиваться с browser throttling и визуальными задержками.

5. **Суфлер и strict sync**  
   Реализация продуманная, но сложная: много `requestAnimationFrame`, resize observers, ignore-flags. Потенциальны редкие race-условия при быстром переключении cue + resize + scroll sync.

### Потенциальные уязвимости

1. **`postMessage(..., '*')` между окнами**  
   Нет проверки `origin/source` у входящих сообщений — в локальном контуре обычно безопасно, но формально поверхность атаки присутствует.

2. **OSC API без auth/ratelimit**  
   `POST /api/osc` принимает команды без авторизации. Для локальной среды допустимо, но в сетевом контуре рискованно.

3. **Файловые операции без granular validation**  
   JSON parsing/structure checks есть, но нет строгой схемной валидации show-файла перед полным применением.

4. **Потенциальные накопления обработчиков/таймеров**  
   При длительных сессиях и большом числе переоткрытий экранов важно следить за cleanup интервалов и listeners (частично реализовано, но не централизовано).

### Ограничения

1. **Зависимость от WebKit/Safari-подобного поведения**  
   В коде есть специальные обходы рефлоу/двойного `requestAnimationFrame` для фоновых окон; это признак зависимости от особенностей движка.

2. **Фокус на macOS Electron pipeline**  
   Сборка и packaging ориентированы на mac (`electron-builder --mac`, entitlements, hardened runtime).

3. **Локальное хранение**  
   LocalStorage как базовый persistence-слой ограничен объемом и устойчивостью к manual cleanup.

## 5. Рекомендации по улучшению кодовой базы

### Архитектурные предложения

1. **Декомпозиция `script.js` на модули**
   - `state/` (actions, timer, persistence),
   - `screens/` (open/sync/postMessage),
   - `osc/` (mapping, interpolation, transport),
   - `ui/` (modals, context menu, hotkeys, notes),
   - `prompter/` (strict sync, scroll pipeline).

2. **Вынести event-bus/command layer**
   - сделать единые команды вида `dispatch({ type: 'CUE_GO', payload })`,
   - внутри них централизовать state-change + side effects (OSC, notify, autosave).

3. **Постепенный переход на TypeScript**
   - начать с `constants/state models/OSC payloads`,
   - затем типизировать screen messages и show-file schema.

4. **JSON schema для show-файлов**
   - валидация до `applyShowData`,
   - мягкая миграция версий данных.

### Оптимизация производительности

1. Снизить частоту лишних `notifyStateChange` на высокочастотных потоках (скролл/typing) через батчинг.
2. Для экранов внедрить diff-aware render (частичный ререндер блоков вместо полного).
3. Централизовать интервалы и их lifecycle для исключения избыточных тиков.

### Улучшение читаемости и поддерживаемости

1. Вычистить legacy/DnD-ветки или явно оградить feature flag-ом.
2. Унифицировать именование (где “plannedStart” фактически duration slot — желательно явнее в нейминге).
3. Добавить smoke-тесты ключевых сценариев:
   - GO/DONE разделены,
   - pause/resume,
   - reorder + state integrity,
   - sync operator <-> speaker/prompter.
4. Добавить structured logging (уровни info/warn/error + контексты cue/actionId).

## 6. Варианты дальнейшего развития приложения

### Возможные функции (сложность/приоритет)

1. **Журнал событий (event log)**
   - Что: лог GO/DONE/OSC/pause/resume/errors c timestamp.
   - Сложность: **средняя**.
   - Приоритет: **высокий**.

2. **OSC-пресеты профилей**
   - Что: наборы адресов под QLab/Resolume/LightDesk и т.д.
   - Сложность: **средняя**.
   - Приоритет: **высокий**.

3. **MIDI-поддержка (триггеры GO/DONE/next/pause)**
   - Сложность: **средняя-высокая**.
   - Приоритет: **средний**.

4. **Облачная синхронизация шоу**
   - Что: backup/restore, командная работа.
   - Сложность: **высокая**.
   - Приоритет: **средний**.

5. **Режим репетиции и симуляции тайминга**
   - Что: прогон сценария без OSC-output.
   - Сложность: **средняя**.
   - Приоритет: **средний**.

6. **Диагностическая панель стабильности**
   - Что: latency postMessage, dropped sync, нагрузка рендера.
   - Сложность: **высокая**.
   - Приоритет: **средний-низкий**.

### Идеи по улучшению UX

1. Быстрые пресеты рабочего режима оператора (концерт/форум/стрим).
2. Явный health-индикатор sync состояния для каждого экрана.
3. Улучшенный “stress-mode” интерфейс: крупнее критичные кнопки, меньше второстепенного шума.
4. Безопасные подтверждения для разрушительных действий с undo-окном (удаление cue/массовые операции).

