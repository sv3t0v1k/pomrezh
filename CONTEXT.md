# ПомРеж — контекст кода

## index.html — операторский UI

- Заставка (splash) на старте, затем основной интерфейс.
- Заголовок мероприятия с редактированием (`eventTitle`), счётчики «всего / выполнено».
- **Меню**: Файл (новое / открыть / сохранить / импорт Excel / выход), Правка (добавить действие / заметку), Мониторы (Stage / Tech / Speaker, обновить экраны, настройка ведущего), OSC (вкл/выкл, настройки, тест, пункты пресетов Resolume/QLab/Ableton — см. ниже), Вид (темы тёмная/светлая/высокий контраст, sticky-бар), Помощь (руководство, горячие клавиши, о программе, логи/DevTools).
- **Sticky-бар**: карточки «СЕЙЧАС» / «СЛЕДУЮЩИЙ» и компактный таймер с кнопкой паузы.
- Список cue (`#scenario-items`), шаблон строки, создание примечаний (drag на действие).
- Модалки: OSC, кастомизация ведущего, горячие клавиши, «О программе», **OSC по строке** (onStart/onEnd для cue).
- **Контекстное меню по cue**: дублировать, вверх/вниз, удалить.
- Строка состояния: имя шоу, версия, автосохранение, число открытых экранов, тема, режим Web/Desktop, статус файла, OSC.
- Подключение: `js/fireworks.js` (финал шоу), `js/script.js`.

## js/script.js — логика

### Источник правды

- `window.appState` — единственный источник правды для сценария и экранов.
- Поля включают: `actions`, `currentIndex`, таймер (`startedAt`, `isRunning`, `pausedAt`, `accumulatedPause`), `showMeta`, `oscSettings`, `speakerCustomization`, **`uiTheme`** (dark / light / highContrast), при необходимости `currentFilePath` и служебные флаги (`ensureAppStateShape` дополняет старые шоу).

### Синхронизация DOM ↔ state

- Связь строк с данными через `dataset.actionId`.
- После reorder (Sortable) вызывается `syncStateFromDomOrder({ notify })` — пересобирает `appState.actions` из DOM, выставляет `currentIndex` по строке с классом `active`.

### `notifyStateChange()`

1. `CustomEvent('appStateChanged', { detail: appState })` на `window`.
2. Во все окна из `window.openScreens` (живые): `postMessage({ type: 'STATE_UPDATE', payload: appState })`.
3. Локальный UI: `renderOperatorTimer`, `renderOperatorCueBar`, `updateMonitorIndicators`, `updateActionItemsVisualState`, `updateStatusBar`, `debouncedAutoSave`.

### `setActiveAction(actionItem, { resetTimer, notifyState, autoScroll })`

1. При смене cue на предыдущем — `sendCueOscOnEnd(prevAction)`.
2. Снять `active` со всех строк, выставить `active` на выбранной.
3. **`syncStateFromDomOrder({ notify: false })`** — обновить `actions` и `currentIndex`.
4. При `resetTimer`: новый отсчёт таймера (`startedAt`, сброс паузы), `sendCueOscOnStart` для нового cue.
5. При `notifyState: true` — **`notifyStateChange()`** (после синка).

### GO / ГОТОВО

- **GO (▶)** — делает cue текущим через `setActiveAction` (таймер с нуля, OSC onStart/onEnd по правилам выше).
- **ГОТОВО (✓)** — `applyDoneOscAndMaybeFinishShow`: OSC onEnd для текущего в эфире cue; фиксация паузы таймера; на **последнем** событии — глобальный `onShowEnd`, сброс таймера, уведомление «Шоу завершено». Следующий cue **не** выбирается автоматически.

### OSC

- **Глобальные команды** (`mergeGlobalCommands`): `onPause`, `onResume`, `onNext`, `onShowEnd` — дефолтные адреса в `DEFAULT_GLOBAL_COMMANDS`, пустой адрес в шоу → подставляется дефолт.
- **Покьюшные** (`action.osc.onStart` / `onEnd`): при пустом адресе используются `DEFAULT_CUE_COMMANDS`; аргументы через `interpolateArgs` (плейсхолдеры вроде `{title}`, `{id}`).
- Отправка: `fetch` на `POST /api/osc` (тот же origin), тело `{ host/port или remoteIP/remotePort, address, args }`.
- Пауза таймера шлёт глобальный OSC pause/resume; **Space** на следующий cue вызывает `sendGlobalOsc('onNext')`.

### Экраны

- `openScreen(type)` открывает `screen.html?type=stage|tech|speaker`, кладёт окно в `openScreens`, помечает `__operatorScreenType` для индикаторов мониторов.
- После открытия: `INIT_STATE` + `APPLY_THEME`; далее только `STATE_UPDATE` из `notifyStateChange`.
- «Обновить все экраны» — повторная рассылка `STATE_UPDATE`.

### Тема приложения

- `applyTheme` пишет в `appState.uiTheme` и `localStorage`, шлёт открытым экранам `postMessage({ type: 'APPLY_THEME', theme })`.

### Горячие клавиши (основное)

- **Space** — следующий cue (как GO на следующей строке), плюс `sendGlobalOsc('onNext')`; не срабатывает в полях ввода и на кнопках.
- **P** — пауза/продолжить таймер.
- **Стрелки вверх/вниз** — только **фокус** по списку (`operatorListFocusIndex`, класс `action-item--focused`), без смены текущего cue.
- **⌘/Ctrl+S** — сохранить шоу; **+Shift** — сохранить как; **⌘/Ctrl+O** — открыть; **⌘/Ctrl+1|2|3** — Stage / Tech / Speaker.

### Прочее

- Типы действий: `performance`, `host`, `tech` — иконки в UI и на экранах.
- Таймер в панели оператора обновляется `setInterval(..., 500)` для отображения; истина по-прежнему в `startedAt` / `pausedAt` / `accumulatedPause`.
- Шоу-файлы: сериализация meta/settings/actions/state, автосохранение, Electron — диалоги через `window.electronAPI` (save/open/quit/openExternal/openDevTools).
- **Меню OSC**: пункты «Resolume Arena», «QLab», «Ableton Live» в разметке есть; в `handleMenuAction` для них **нет** веток — клик не меняет настройки (стоит либо добавить логику, либо убрать пункты по правилу «кнопка без действия»).

## screen.html — экраны

- Режим `?type=stage|tech|speaker`; класс `screen-mode-*` на `body`.
- **Сообщения от оператора**: `INIT_STATE`, `STATE_UPDATE` (полный ререндер из `payload`), `APPLY_THEME`, `APPLY_SPEAKER_CUSTOMIZATION` (частичное обновление кастомизации ведущего).
- Рендер только из полученного state; для stage/tech/speaker разные блоки (очередь на tech; у speaker — таймлайн next/prepare, опционально часы, обратный отсчёт, логотип, «В эфире» и т.д. по `speakerCustomization`).
- **Таймер на экране**: `getElapsed` — при паузе `elapsed = pausedAt - startedAt - accumulatedPause`, иначе `Date.now() - startedAt - accumulatedPause`.
- Резерв: раз в ~1 с вызываются `syncFromOpener` (чтение `window.opener.appState`, если ещё не было state) и повторный `renderScreen` — чтобы подтянуть состояние и обновить часы.

## server.js

- Express, статика из корня проекта, `POST /api/osc` (JSON до 256kb), `GET /health`.
- Нормализация аргументов для `osc-min`, цель: `host`/`remoteIP`, `port`/`remotePort`, дефолт порта 7000.
- `module.exports = { app, httpServer }` — для встраивания в Electron.
- Логи OSC: переменная окружения `OSC_DEBUG=1`.

## electron/main.js

- Один экземпляр приложения; встроенный `server.js` на `PORT` (по умолчанию 3000); окно грузит `http://127.0.0.1:PORT/` после успешного `GET /health`.
- IPC: сохранение/открытие файлов, `openExternal`, DevTools, выход.

## js/fireworks.js

- Класс финального действия; по завершении сбрасывает таймер в `appState` и вызывает `notifyStateChange()` при наличии.

---

## Поток данных (сводка)

```text
UI → обновление window.appState → notifyStateChange()
  → postMessage STATE_UPDATE → screen.html
  → при открытии окна: INIT_STATE + APPLY_THEME
```

Экраны **не** должны менять сценарий сами; обратная связь только через postMessage от оператора.
