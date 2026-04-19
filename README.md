# ПомРеж — Run of Show Tool

Пульт управления сценарием мероприятия с real-time экранами для сцены, техники и ведущего, таймером cue-блоков и OSC-интеграцией.

![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![Electron](https://img.shields.io/badge/electron-33-blue)
![License](https://img.shields.io/badge/license-MIT-success)

## Что это

`ПомРеж` помогает оператору вести шоу под нагрузкой: быстро переключать текущий cue, отмечать выполненные блоки, держать синхрон между операторским пультом и внешними экранами, а также отправлять OSC-команды в внешние системы (Resolume, QLab, TouchDesigner, Ableton и др.).

Приложение работает в двух режимах:
- как web-пульт (`node server.js`);
- как desktop-приложение на Electron (со встроенным сервером).

## Ключевые возможности

- Управление сценарием: текущий/следующий cue, отметка `ГОТОВО`, drag-and-drop reorder.
- Три внешних экрана: `Stage`, `Tech`, `Speaker` с синхронизацией по `postMessage`.
- Таймер с корректной паузой/продолжением и расчетом из state.
- OSC через HTTP->UDP мост (`POST /api/osc`) с глобальными и покьюшными командами.
- Импорт сценария из Excel (`.xlsx/.xls`) и работа с show-файлами (`.show.json`).
- Темы интерфейса: темная, светлая, high-contrast.
- Горячие клавиши для работы без мыши в критических моментах.

## Архитектурные принципы

- `window.appState` — единственный источник правды.
- Поток данных: `UI -> appState -> notifyStateChange() -> postMessage -> screen.html`.
- Внешние экраны рендерят только состояние и не изменяют сценарий напрямую.
- Связь DOM со state через `dataset.actionId`.

## Технологии

- Frontend: Vanilla JS + HTML/CSS
- Reorder: `sortablejs`
- Импорт Excel: `xlsx`
- Сервер: `Express`
- OSC: `osc-min` + UDP (`dgram`)
- Desktop: `Electron` + `electron-builder`

## Быстрый старт

### 1) Локальный web-режим

```bash
npm install
npm start
```

Пульт будет доступен по адресу `http://localhost:3000`.

### 2) Удобный запуск на macOS

```bash
chmod +x start.sh
./start.sh
```

Скрипт проверит Node.js, зависимости, порт и автоматически откроет браузер.

### 3) Desktop-режим (Electron)

```bash
npm install
npm run electron-dev
```

## Скрипты

- `npm start` — запуск локального сервера.
- `npm run electron-dev` — запуск desktop-приложения в dev-режиме.
- `npm run electron-build` — сборка через `electron-builder`.
- `npm run dist` — сборка macOS app (`--dir`) и подготовка ссылки на `.app`.
- `npm run dist:dmg` — сборка `dmg` и `zip` для macOS.
- `npm run test:osc-receiver` — локальный UDP-приемник для проверки OSC.

## Операторский workflow

1. Загрузить/создать сценарий.
2. Открыть нужные внешние экраны (`Stage`/`Tech`/`Speaker`).
3. Вести шоу через `GO (▶)` и `ГОТОВО (✓)`.
4. При необходимости управлять таймером (`P`) и переходом к следующему cue (`Space`).
5. Сохранять шоу-файл и использовать автосохранение.

## OSC и интеграции

- Клиент отправляет OSC-команды на `POST /api/osc`.
- Сервер нормализует payload и пересылает команду по UDP на целевой `host:port`.
- Поддерживаются:
  - глобальные события (`onPause`, `onResume`, `onNext`, `onShowEnd`);
  - команды конкретного cue (`onStart`, `onEnd`).
- Для диагностики включите подробные логи:

```bash
OSC_DEBUG=1 npm start
```

## Структура проекта

- `index.html` — операторская панель.
- `screen.html` — внешние экраны.
- `js/script.js` — основная логика UI/state/синхронизации.
- `js/stateManager.js` — вспомогательная логика state.
- `server.js` — статика + OSC API.
- `electron/main.js` — desktop-shell и IPC.

## Документация

- [Руководство оператора](./OPERATOR_GUIDE.md)
- [Контекст архитектуры](./CONTEXT.md)
- [Тестовый чек-лист](./TEST.md)
- [Инструкция для тестирования сборки](./TEST_INSTRUCTIONS.md)

## Релиз на GitHub (рекомендации)

- Добавьте скриншоты интерфейса в папку `docs/` и вставьте их в этот README.
- В `Releases` прикрепляйте `dmg` и `zip` артефакты из `dist/`.
- В описании релиза указывайте:
  - изменения в UX оператора;
  - изменения в экранах;
  - изменения OSC-поведения;
  - совместимость (macOS / версия).

## Лицензия

MIT
