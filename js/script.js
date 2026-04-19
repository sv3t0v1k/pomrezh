import {
    ACTION_TYPES,
    APP_THEME_STORAGE_KEY,
    APP_VERSION,
    DEFAULT_CUE_COMMANDS,
    DEFAULT_GLOBAL_COMMANDS,
    EVENT_TITLE_STORAGE_KEY,
    SCREEN_MESSAGE_TYPES,
    SPEAKER_CUSTOMIZATION_STORAGE_KEY,
    TECH_CUSTOMIZATION_STORAGE_KEY,
    THEMES
} from './constants.js';
import { createInitialAppState, createStateManager } from './stateManager.js';

function cloneCmd(cmd) {
    return { address: cmd.address, args: Array.isArray(cmd.args) ? [...cmd.args] : [] };
}

/** Подставляет дефолты, если команда отсутствует или адрес пустой (миграция старых шоу и сессий). */
function mergeGlobalCommands(g) {
    const keys = ['onPause', 'onResume', 'onNext', 'onShowEnd'];
    const out = {};
    keys.forEach((key) => {
        const def = DEFAULT_GLOBAL_COMMANDS[key];
        const cmd = g && g[key];
        const addr = cmd && typeof cmd.address === 'string' ? cmd.address.trim() : '';
        if (addr) {
            const args = Array.isArray(cmd.args) ? cmd.args.map(String) : [];
            out[key] = { address: addr, args };
        } else {
            out[key] = cloneCmd(def);
        }
    });
    return out;
}

function getEffectiveCueCommand(which, cmd) {
    const def = DEFAULT_CUE_COMMANDS[which];
    if (!cmd || typeof cmd.address !== 'string' || !cmd.address.trim()) {
        return cloneCmd(def);
    }
    const args = Array.isArray(cmd.args) ? cmd.args.map(String) : [];
    return { address: cmd.address.trim(), args };
}

function flashOscControlGroup() {
    const el = document.querySelector('.control-group--osc');
    if (!el) return;
    el.classList.remove('osc-sent-flash');
    void el.offsetWidth;
    el.classList.add('osc-sent-flash');
    setTimeout(() => el.classList.remove('osc-sent-flash'), 320);
}

window.appState = window.appState || createInitialAppState(mergeGlobalCommands);
window.openScreens = window.openScreens || [];

/** Индекс строки для навигации стрелками (без смены currentIndex). -1 = не используется. */
let operatorListFocusIndex = -1;

let cueContextActionId = null;
let cueOscEditingActionId = null;
let cueNoteEditingActionId = null;
let cueNoteEditingNoteId = null;

function applyTheme(theme) {
    const themeClass = THEMES[theme] || THEMES.dark;
    Object.values(THEMES).forEach((cls) => document.body.classList.remove(cls));
    document.body.classList.add(themeClass);

    ensureAppStateShape();
    window.appState.uiTheme = theme in THEMES ? theme : 'dark';
    localStorage.setItem(APP_THEME_STORAGE_KEY, window.appState.uiTheme);

    if (Array.isArray(window.openScreens)) {
        window.openScreens
            .filter((s) => s && !s.closed)
            .forEach((screen) => {
                try {
                    screen.postMessage({ type: SCREEN_MESSAGE_TYPES.APPLY_THEME, theme: window.appState.uiTheme }, '*');
                } catch (e) {
                    // ignore
                }
            });
    }
    updateStatusBar();
}

function loadThemePreference() {
    const savedTheme = localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (savedTheme && Object.prototype.hasOwnProperty.call(THEMES, savedTheme)) {
        applyTheme(savedTheme);
        return;
    }
    applyTheme('dark');
}

/** Синхронизирует заголовок мероприятия, поле «Название шоу», appState и localStorage. */
function setEventTitleUI(name, { persistStorage = true, syncLayout = true } = {}) {
    const span = document.getElementById('eventTitleText');
    const trimmed = (name || '').trim() || 'Мероприятие';
    if (span) span.textContent = trimmed;
    if (persistStorage) {
        try {
            localStorage.setItem(EVENT_TITLE_STORAGE_KEY, trimmed);
        } catch (e) {
            /* ignore quota */
        }
    }
    ensureAppStateShape();
    window.appState.showMeta.name = trimmed;
    const showNameEl = document.getElementById('showName');
    if (showNameEl) showNameEl.value = trimmed;
    document.title = 'ПомРеж';
    if (syncLayout) {
        requestAnimationFrame(() => updateOperatorStickyTop());
    }
    if (typeof updateStatusBar === 'function') {
        updateStatusBar();
    }
}

function initEventTitleEditor() {
    const textSpan = document.getElementById('eventTitleText');
    const editBtn = document.getElementById('editEventTitleBtn');
    const inputField = document.getElementById('eventTitleInput');
    if (!textSpan || !editBtn || !inputField) return;

    ensureAppStateShape();
    const saved = localStorage.getItem(EVENT_TITLE_STORAGE_KEY);
    const fromState = (window.appState.showMeta?.name || '').trim();
    let initial = 'Мероприятие';
    if (saved != null && saved.trim() !== '') {
        initial = saved.trim();
    } else if (fromState && fromState !== 'Без названия') {
        initial = fromState;
    }
    setEventTitleUI(initial, { persistStorage: true, syncLayout: false });

    editBtn.addEventListener('click', () => {
        inputField.value = textSpan.textContent;
        textSpan.style.display = 'none';
        editBtn.style.display = 'none';
        inputField.style.display = 'block';
        inputField.focus();
        inputField.select();
    });

    const finishEdit = () => {
        const newTitle = inputField.value.trim() || 'Мероприятие';
        setEventTitleUI(newTitle, { persistStorage: true, syncLayout: true });
        textSpan.style.display = '';
        editBtn.style.display = '';
        inputField.style.display = 'none';
    };

    inputField.addEventListener('blur', finishEdit);
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            inputField.blur();
        }
    });
}

function generateId(prefix = 'a') {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/** Доля прокрутки 0…1 для суфлера (оператор ↔ экран ведущего). */
function clampScriptScrollPos(p) {
    if (typeof p !== 'number' || !Number.isFinite(p)) return 0;
    return Math.max(0, Math.min(1, p));
}

function getScrollPercent(el) {
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return 0;
    return clampScriptScrollPos(el.scrollTop / max);
}

function setScrollPercent(el, p) {
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    el.scrollTop = clampScriptScrollPos(p) * max;
}

function getEditorText(el) {
    if (!el) return '';
    if ('value' in el) return String(el.value || '');
    return String(el.textContent || '');
}

function setEditorText(el, text) {
    if (!el) return;
    const normalized = String(text || '');
    if ('value' in el) el.value = normalized;
    else el.textContent = normalized;
}

function insertPlainTextAtCursor(text) {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount) {
        try {
            document.execCommand('insertText', false, text);
        } catch (e) {
            // ignore
        }
        return;
    }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
}

/**
 * Синхронизирует scriptText текущего cue из DOM-редактора.
 * @param {string} actionId
 * @param {Element} actionItem
 */
function syncScriptToState(actionId, actionItem) {
    if (!actionId || !actionItem) return;
    const st = window.appState.actions.find((a) => a.id === actionId);
    if (!st) return;
    const strict = isStrictScriptSyncEnabled();
    const strictEditor = actionItem.querySelector('.script-editor-strict');
    const textarea = actionItem.querySelector('textarea.script-textarea');
    st.scriptText = getEditorText(strict ? strictEditor : textarea);
    notifyStateChange();
}

function getStrictSyncSettings() {
    ensureAppStateShape();
    return mergeSpeakerCustomization(window.appState.speakerCustomization);
}

function isStrictScriptSyncEnabled() {
    return !!getStrictSyncSettings().strictScriptSync;
}

function applyStrictScriptVars(custom = getStrictSyncSettings()) {
    const root = document.documentElement;
    root.style.setProperty('--strict-script-width', `${custom.strictScriptWidthPx}px`);
    root.style.setProperty('--strict-script-height', `${custom.strictScriptHeightPx}px`);
    root.style.setProperty('--strict-script-font-size', `${custom.strictScriptFontSizePx}px`);
    root.style.setProperty('--strict-script-line-height', `${custom.strictScriptLineHeight}`);
    root.style.setProperty('--strict-script-padding', `${custom.strictScriptPaddingPx}px`);
    document.body.classList.toggle('strict-sync-script-operator', !!custom.strictScriptSync);
    if (custom.strictScriptSync) document.body.style.zoom = '1';
    else document.body.style.removeProperty('zoom');
    applyStrictInlineStylesToOperatorEditors(custom);
}

function applyStrictInlineStylesToOperatorEditors(custom = getStrictSyncSettings()) {
    const strict = !!custom.strictScriptSync;
    const editors = document.querySelectorAll('.script-editor-strict');
    editors.forEach((el) => {
        if (!strict) {
            el.classList.remove('strict-script-reset');
            el.style.removeProperty('width');
            el.style.removeProperty('height');
            el.style.removeProperty('minHeight');
            el.style.removeProperty('maxHeight');
            el.style.removeProperty('padding');
            el.style.removeProperty('fontSize');
            el.style.removeProperty('lineHeight');
            el.style.removeProperty('fontFamily');
            el.style.removeProperty('whiteSpace');
            el.style.removeProperty('wordBreak');
            el.style.removeProperty('boxSizing');
            el.style.removeProperty('overflowY');
            el.style.removeProperty('overflowX');
            el.style.removeProperty('letterSpacing');
            el.style.removeProperty('wordSpacing');
            el.style.removeProperty('textIndent');
            el.style.removeProperty('WebkitFontSmoothing');
            el.style.removeProperty('textRendering');
            return;
        }
        el.classList.add('strict-script-reset');
        el.style.width = `${custom.strictScriptWidthPx}px`;
        el.style.height = `${custom.strictScriptHeightPx}px`;
        el.style.minHeight = `${custom.strictScriptHeightPx}px`;
        el.style.maxHeight = `${custom.strictScriptHeightPx}px`;
        el.style.padding = `${custom.strictScriptPaddingPx}px`;
        el.style.fontSize = `${custom.strictScriptFontSizePx}px`;
        el.style.lineHeight = String(custom.strictScriptLineHeight);
        el.style.fontFamily = "'Helvetica Neue', Helvetica, Arial, sans-serif";
        el.style.whiteSpace = 'pre-wrap';
        el.style.wordBreak = 'break-word';
        el.style.boxSizing = 'border-box';
        el.style.overflowY = 'auto';
        el.style.overflowX = 'hidden';
        el.style.letterSpacing = 'normal';
        el.style.wordSpacing = 'normal';
        el.style.textIndent = '0';
        el.style.WebkitFontSmoothing = 'antialiased';
        el.style.textRendering = 'geometricPrecision';
    });
}

function logStrictOperatorComputedStyle(editor) {
    try {
        if (!editor || localStorage.getItem('STRICT_STYLE_DEBUG') !== '1') return;
        const cs = window.getComputedStyle(editor);
        console.log('[STRICT][operator] computed', {
            fontSize: cs.fontSize,
            lineHeight: cs.lineHeight,
            fontFamily: cs.fontFamily,
            padding: cs.padding,
            width: cs.width,
            height: cs.height,
            letterSpacing: cs.letterSpacing,
            wordSpacing: cs.wordSpacing,
            textRendering: cs.textRendering,
            webkitFontSmoothing: cs.webkitFontSmoothing
        });
    } catch (e) {
        // ignore
    }
}

/**
 * @param {string} actionId
 * @param {number} scrollPercent
 * @param {{ smooth?: boolean, durationMs?: number }} [opts] smooth по умолчанию true; для авто-прокрутки передавать { smooth: false }
 */
function postSpeakerScreensSyncScroll(actionId, scrollPercent, opts = {}) {
    const strict = !!opts.strict;
    const pct = clampScriptScrollPos(scrollPercent);
    if (!actionId || !window.openScreens) return;
    const smooth = opts.smooth !== false;
    const scrollTopPx = typeof opts.scrollTopPx === 'number' && Number.isFinite(opts.scrollTopPx) ? Math.max(0, opts.scrollTopPx) : 0;
    const durationMs =
        typeof opts.durationMs === 'number' && opts.durationMs > 0 ? opts.durationMs : smooth ? 180 : 0;
    window.openScreens
        .filter((s) => s && !s.closed && (s.__operatorScreenType === 'speaker' || s.__operatorScreenType === 'prompter'))
        .forEach((w) => {
            try {
                w.postMessage(
                    {
                        type: SCREEN_MESSAGE_TYPES.SYNC_SCROLL,
                        actionId,
                        mode: strict ? 'strict' : 'percent',
                        percent: pct,
                        scrollTopPx,
                        scrollPercent: pct,
                        smooth,
                        ...(smooth ? { durationMs } : {})
                    },
                    '*'
                );
            } catch (e) {
                // ignore
            }
        });
}

const SCRIPT_AUTO_SPEED_MIN = 0.005;
const SCRIPT_AUTO_SPEED_MAX = 0.15;

function clampScriptAutoSpeed(s) {
    if (typeof s !== 'number' || !Number.isFinite(s)) return 0.05;
    return Math.max(SCRIPT_AUTO_SPEED_MIN, Math.min(SCRIPT_AUTO_SPEED_MAX, s));
}

/**
 * Переключение авто-прокрутки суфлёра для cue: надёжная остановка/запуск одного rAF-цикла.
 */
function toggleScriptAutoForActionId(actionId) {
    const st = window.appState.actions.find((a) => a.id === actionId);
    if (!st) return;
    st.scriptAutoEnabled = !st.scriptAutoEnabled;
    if (st.scriptAutoEnabled) {
        st.scriptAutoStart = true;
        if (actionId === window.appState.actions[window.appState.currentIndex]?.id) {
            startScriptAutoLoop();
        }
    } else {
        st.scriptAutoStart = false;
        stopScriptAutoLoop();
    }
    refreshScriptControlsForActionId(actionId);
    notifyStateChange();
}

/** Единственный цикл авто-прокрутки суфлера (только окно оператора). */
let scriptAutoRafId = null;
let scriptAutoLastTs = 0;
let scriptAutoDebouncedNotifyTimer = null;

function stopScriptAutoLoop() {
    if (scriptAutoRafId) cancelAnimationFrame(scriptAutoRafId);
    scriptAutoRafId = null;
    scriptAutoLastTs = 0;
    if (scriptAutoDebouncedNotifyTimer) {
        clearTimeout(scriptAutoDebouncedNotifyTimer);
        scriptAutoDebouncedNotifyTimer = null;
    }
}

function scheduleScriptAutoNotifyDebounced() {
    if (scriptAutoDebouncedNotifyTimer) clearTimeout(scriptAutoDebouncedNotifyTimer);
    scriptAutoDebouncedNotifyTimer = setTimeout(() => {
        scriptAutoDebouncedNotifyTimer = null;
        notifyStateChange();
    }, 550);
}

function scriptAutoTick(ts) {
    scriptAutoRafId = null;
    const state = window.appState;
    const idx = state.currentIndex;
    const action = state.actions[idx];
    if (!action || !action.scriptAutoEnabled) {
        scriptAutoLastTs = 0;
        return;
    }

    if (!scriptAutoLastTs) scriptAutoLastTs = ts;
    const dt = Math.min((ts - scriptAutoLastTs) / 1000, 0.25);
    scriptAutoLastTs = ts;

    const speed = clampScriptAutoSpeed(action.scriptAutoSpeed);
    let p = clampScriptScrollPos(action.scriptScrollPos + speed * dt);
    action.scriptScrollPos = p;

    const ta = document.querySelector('#scenario-items .action-item.active .script-textarea');
    if (ta) {
        ta.dataset._scriptScrollIgnore = '1';
        setScrollPercent(ta, p);
        requestAnimationFrame(() => {
            ta.dataset._scriptScrollIgnore = '0';
        });
    }

    postSpeakerScreensSyncScroll(action.id, p, {
        smooth: false,
        strict: isStrictScriptSyncEnabled(),
        scrollTopPx: Number.isFinite(action.scriptScrollTopPx) ? action.scriptScrollTopPx : 0
    });
    refreshScriptControlsForActionId(action.id);
    scheduleScriptAutoNotifyDebounced();

    if (p >= 0.999) {
        action.scriptAutoEnabled = false;
        action.scriptAutoStart = false;
        stopScriptAutoLoop();
        refreshAllScriptControlsUI();
        notifyStateChange();
        return;
    }

    scriptAutoRafId = requestAnimationFrame(scriptAutoTick);
}

function startScriptAutoLoop() {
    stopScriptAutoLoop();
    scriptAutoLastTs = 0;
    scriptAutoRafId = requestAnimationFrame(scriptAutoTick);
}

function maybeStartScriptAutoLoopForCurrentCue() {
    const state = window.appState;
    const action = state.actions[state.currentIndex];
    if (action && action.scriptAutoEnabled) {
        startScriptAutoLoop();
    }
}

function disableScriptAutoForAction(action) {
    if (!action) return;
    action.scriptAutoEnabled = false;
    action.scriptAutoStart = false;
}

function refreshScriptControlsForActionId(actionId) {
    if (!actionId) return;
    const item = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    if (!item) return;
    const action = window.appState.actions.find((a) => a.id === actionId);
    if (!action) return;

    const btnAuto = item.querySelector('.script-btn-auto');
    const range = item.querySelector('.script-speed-range');
    const progressEl = item.querySelector('.script-progress');
    const isLive = actionId === window.appState.actions[window.appState.currentIndex]?.id;

    if (btnAuto) {
        btnAuto.classList.toggle('script-btn--active', !!action.scriptAutoEnabled);
        btnAuto.textContent = action.scriptAutoEnabled ? '⏸ Пауза' : '▶️ Авто';
        btnAuto.title = action.scriptAutoEnabled
            ? 'Остановить автопрокрутку'
            : isLive
                ? 'Запустить автопрокрутку (текущий cue в эфире)'
                : 'Автопрокрутка запустится, когда этот cue станет текущим (▶)';
    }
    if (range) {
        range.value = String(clampScriptAutoSpeed(action.scriptAutoSpeed));
    }
    if (progressEl) {
        progressEl.textContent = `${Math.round(clampScriptScrollPos(action.scriptScrollPos) * 100)}%`;
    }
}

function refreshAllScriptControlsUI() {
    document.querySelectorAll('#scenario-items .action-item[data-action-id]').forEach((item) => {
        const id = item.dataset.actionId;
        if (id) refreshScriptControlsForActionId(id);
    });
}

function refreshAllScriptEditorsMode() {
    document.querySelectorAll('#scenario-items .action-item').forEach((item) => syncScriptEditorMode(item));
}

function computeScriptAutoSpeedFitDuration(action) {
    if (!action) return 0.05;
    const dur = getDurationSecFromAction(action);
    if (!dur || dur <= 0) return 0.05;
    return clampScriptAutoSpeed(1 / dur);
}

function wireScriptControls(actionItem, actionId) {
    const action = () => window.appState.actions.find((a) => a.id === actionId);

    const btnAuto = actionItem.querySelector('[data-script-cmd="auto"]');
    const btnReset = actionItem.querySelector('[data-script-cmd="reset"]');
    const btnFit = actionItem.querySelector('[data-script-cmd="fit"]');
    const range = actionItem.querySelector('.script-speed-range');
    const textarea = actionItem.querySelector('textarea.script-textarea');
    let strictEditor = actionItem.querySelector('.script-editor-strict');
    if (!strictEditor && textarea && textarea.parentElement) {
        strictEditor = document.createElement('div');
        strictEditor.className = 'script-editor-strict script-textarea';
        strictEditor.setAttribute('contenteditable', 'plaintext-only');
        strictEditor.setAttribute('role', 'textbox');
        strictEditor.setAttribute('aria-multiline', 'true');
        strictEditor.style.display = 'none';
        textarea.insertAdjacentElement('afterend', strictEditor);
    }
    if (strictEditor && !strictEditor.textContent) {
        setEditorText(strictEditor, getEditorText(textarea));
    }
    applyStrictInlineStylesToOperatorEditors();
    logStrictOperatorComputedStyle(strictEditor);
    const scriptControls = actionItem.querySelector('.script-controls');
    if (scriptControls && !scriptControls.querySelector('.script-sync-lock')) {
        const lock = document.createElement('span');
        lock.className = 'script-sync-lock';
        lock.title = 'Точная синхронизация включена';
        lock.textContent = '🔒 Точная синхронизация';
        lock.style.display = 'none';
        scriptControls.appendChild(lock);
    }

    const syncScriptToState = () => {
        const st = window.appState.actions.find((a) => a.id === actionId);
        if (!st) return;
        const source = isStrictScriptSyncEnabled() ? strictEditor : textarea;
        st.scriptText = getEditorText(source);
        notifyStateChange();
    };

    const handleEditorScrollSync = (editorEl) => {
        if (!editorEl || editorEl.dataset._scriptScrollIgnore === '1') return;
        const st = window.appState.actions.find((a) => a.id === actionId);
        if (!st) return;
        const percent = getScrollPercent(editorEl);
        st.scriptScrollPos = percent;
        st.scriptScrollTopPx = editorEl.scrollTop || 0;
        postSpeakerScreensSyncScroll(actionId, percent, {
            strict: isStrictScriptSyncEnabled(),
            scrollTopPx: st.scriptScrollTopPx
        });
    };

    const applySpeedFromSlider = () => {
        const st = action();
        if (!st || !range) return;
        st.scriptAutoSpeed = clampScriptAutoSpeed(parseFloat(range.value));
        notifyStateChange();
    };

    if (range) {
        range.addEventListener('mousedown', (e) => e.stopPropagation());
        range.addEventListener('input', () => {
            const st = action();
            if (!st) return;
            st.scriptAutoSpeed = clampScriptAutoSpeed(parseFloat(range.value));
            refreshScriptControlsForActionId(actionId);
        });
        range.addEventListener('change', applySpeedFromSlider);
    }

    if (btnAuto) {
        btnAuto.addEventListener('mousedown', (e) => e.stopPropagation());
        btnAuto.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!action()) return;
            toggleScriptAutoForActionId(actionId);
        });
    }

    if (btnReset) {
        btnReset.addEventListener('mousedown', (e) => e.stopPropagation());
        btnReset.addEventListener('click', (e) => {
            e.stopPropagation();
            const st = action();
            if (!st) return;
            st.scriptScrollPos = 0;
            if (textarea) {
                textarea.dataset._scriptScrollIgnore = '1';
                setScrollPercent(textarea, 0);
                requestAnimationFrame(() => {
                    textarea.dataset._scriptScrollIgnore = '0';
                });
            }
            postSpeakerScreensSyncScroll(actionId, 0, {
                smooth: true,
                durationMs: 300,
                strict: isStrictScriptSyncEnabled(),
                scrollTopPx: 0
            });
            refreshScriptControlsForActionId(actionId);
            notifyStateChange();
        });
    }

    if (btnFit) {
        btnFit.addEventListener('mousedown', (e) => e.stopPropagation());
        btnFit.addEventListener('click', (e) => {
            e.stopPropagation();
            const st = action();
            if (!st) return;
            st.scriptAutoSpeed = computeScriptAutoSpeedFitDuration(st);
            if (range) range.value = String(st.scriptAutoSpeed);
            refreshScriptControlsForActionId(actionId);
            notifyStateChange();
        });
    }

    if (textarea) {
        textarea.addEventListener('mousedown', (e) => e.stopPropagation());
        textarea.addEventListener('input', () => {
            const st = action();
            if (!st) return;
            st.scriptText = getEditorText(textarea);
            st.scriptScrollPos = getScrollPercent(textarea);
            st.scriptScrollTopPx = textarea.scrollTop || 0;
            setEditorText(strictEditor, st.scriptText);
            notifyStateChange();
        });
        textarea.addEventListener('blur', syncScriptToState);
        textarea.dataset._scriptScrollIgnore = textarea.dataset._scriptScrollIgnore || '0';
        textarea.addEventListener(
            'scroll',
            () => {
                if (textarea.dataset._scriptScrollIgnore === '1') return;
                handleEditorScrollSync(textarea);
            },
            { passive: true }
        );
        textarea.addEventListener('keydown', (e) => {
            if (e.key === '[' || e.key === '{') {
                e.preventDefault();
                const st = action();
                if (!st) return;
                st.scriptAutoSpeed = clampScriptAutoSpeed(st.scriptAutoSpeed - 0.005);
                if (range) range.value = String(st.scriptAutoSpeed);
                notifyStateChange();
                refreshScriptControlsForActionId(actionId);
            } else if (e.key === ']' || e.key === '}') {
                e.preventDefault();
                const st = action();
                if (!st) return;
                st.scriptAutoSpeed = clampScriptAutoSpeed(st.scriptAutoSpeed + 0.005);
                if (range) range.value = String(st.scriptAutoSpeed);
                notifyStateChange();
                refreshScriptControlsForActionId(actionId);
            }
        });
    }

    if (strictEditor) {
        strictEditor.dataset._scriptScrollIgnore = strictEditor.dataset._scriptScrollIgnore || '0';
        strictEditor.addEventListener('mousedown', (e) => e.stopPropagation());
        strictEditor.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = e.clipboardData?.getData('text/plain') ?? '';
            insertPlainTextAtCursor(text);
            const st = action();
            if (!st) return;
            st.scriptText = getEditorText(strictEditor);
            setEditorText(textarea, st.scriptText);
            notifyStateChange();
        });
        strictEditor.addEventListener('input', () => {
            const st = action();
            if (!st) return;
            st.scriptText = getEditorText(strictEditor);
            st.scriptScrollPos = getScrollPercent(strictEditor);
            st.scriptScrollTopPx = strictEditor.scrollTop || 0;
            setEditorText(textarea, st.scriptText);
            notifyStateChange();
        });
        strictEditor.addEventListener('blur', syncScriptToState);
        strictEditor.addEventListener(
            'scroll',
            () => {
                if (strictEditor.dataset._scriptScrollIgnore === '1') return;
                handleEditorScrollSync(strictEditor);
            },
            { passive: true }
        );
        if (typeof ResizeObserver !== 'undefined' && !strictEditor._strictResizeObserverBound) {
            const ro = new ResizeObserver(() => {
                if (!isStrictScriptSyncEnabled()) return;
                const st = action();
                if (!st) return;
                const max = Math.max(0, strictEditor.scrollHeight - strictEditor.clientHeight);
                const p = max <= 0 ? 0 : clampScriptScrollPos((strictEditor.scrollTop || 0) / max);
                const nextTop = max * p;
                st.scriptScrollPos = p;
                st.scriptScrollTopPx = nextTop;
                strictEditor.dataset._scriptScrollIgnore = '1';
                strictEditor.scrollTop = nextTop;
                requestAnimationFrame(() => {
                    strictEditor.dataset._scriptScrollIgnore = '0';
                });
            });
            ro.observe(strictEditor);
            strictEditor._strictResizeObserverBound = true;
        }
    }

    syncScriptEditorMode(actionItem);
    refreshScriptControlsForActionId(actionId);
}

function handleMenuAction(action) {
    switch (action) {
        case 'newShow':
            createNewShow();
            break;
        case 'openShow':
            void openShowFromFile();
            break;
        case 'saveShow':
            void saveShow();
            break;
        case 'saveShowAs':
            void saveShowAs();
            break;
        case 'importExcel':
            document.getElementById('file-input')?.click();
            break;
        case 'exit':
            if (window.electronAPI && typeof window.electronAPI.quit === 'function') {
                window.electronAPI.quit();
            } else if (confirm('Закрыть окно оператора?')) {
                window.close();
            }
            break;
        case 'addAction':
            addNewAction();
            break;
        case 'addNote':
            toggleNoteCreator();
            break;
        case 'openStage':
            openScreen('stage');
            break;
        case 'openTech':
            openScreen('tech');
            break;
        case 'openSpeaker':
            openScreen('speaker');
            break;
        case 'openPrompterWindow':
            openScreen('prompter');
            break;
        case 'refreshScreens': {
            const opened = Array.isArray(window.openScreens)
                ? window.openScreens.filter((s) => s && !s.closed)
                : [];
            if (!opened.length) {
                showOperatorNotice('Нет открытых экранов');
                break;
            }
            opened.forEach((screen) => {
                try {
                    screen.postMessage({ type: SCREEN_MESSAGE_TYPES.STATE_UPDATE, payload: window.appState }, '*');
                } catch (e) {
                    // ignore
                }
            });
            showOperatorNotice('Все экраны обновлены');
            updateStatusBar();
            break;
        }
        case 'toggleOsc': {
            ensureAppStateShape();
            window.appState.oscSettings.enabled = !window.appState.oscSettings.enabled;
            notifyStateChange();
            break;
        }
        case 'openOscSettings':
            openOscModal();
            break;
        case 'testOsc':
            testOSCConnection();
            break;
        case 'toggleStickyBar':
            document.querySelector('.operator-sticky-bar')?.classList.toggle('hidden');
            requestAnimationFrame(updateOperatorStickyTop);
            break;
        case 'themeDark':
            applyTheme('dark');
            break;
        case 'themeLight':
            applyTheme('light');
            break;
        case 'themeHighContrast':
            applyTheme('highContrast');
            break;
        case 'openSpeakerCustomization':
            openSpeakerCustomizationModal();
            break;
        case 'openTechCustomization':
            openTechCustomizationModal();
            break;
        case 'openGuide': {
            const guideUrl = new URL('./OPERATOR_GUIDE.md', window.location.href).href;
            if (window.electronAPI?.isElectron) {
                void window.electronAPI.openExternal(guideUrl);
            } else {
                window.open(guideUrl, '_blank');
            }
            break;
        }
        case 'showHotkeys':
            showHotkeysModal();
            break;
        case 'about':
            showAboutModal();
            break;
        case 'openLogs':
            if (window.electronAPI?.isElectron) {
                void window.electronAPI.openDevTools();
            } else {
                console.log('Откройте DevTools (F12) для просмотра логов');
                alert('Нажмите F12 для открытия консоли разработчика');
            }
            break;
        default:
            break;
    }
}

function initMenuBar() {
    const menuItems = Array.from(document.querySelectorAll('.menu-item'));

    const closeMenus = () => {
        menuItems.forEach((item) => item.classList.remove('menu-open'));
    };

    document.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target || !target.closest('.menu-item')) {
            closeMenus();
        }
    });

    menuItems.forEach((item) => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = item.classList.contains('menu-open');
            closeMenus();
            if (!wasOpen) {
                item.classList.add('menu-open');
            }
        });
    });

    document.querySelectorAll('.menu-option').forEach((option) => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = option.dataset.action;
            console.log(`[MENU] ${action}`);
            handleMenuAction(action);
            closeMenus();
        });
    });
}

function updateStatusBar() {
    const showName = document.getElementById('eventTitleText')?.textContent || 'Без названия';
    const oscEnabled = !!window.appState?.oscSettings?.enabled;
    const version = APP_VERSION;
    const autoSaveEnabled = !!window.appState?.showMeta?.autoSaveEnabled;
    const openScreensCount = Array.isArray(window.openScreens)
        ? window.openScreens.filter((s) => s && !s.closed).length
        : 0;
    const currentTheme = localStorage.getItem(APP_THEME_STORAGE_KEY) || 'dark';
    const isElectron = !!window.electronAPI?.isElectron;
    const hasFilePath = !!window.appState?.currentFilePath;
    const themeNames = {
        dark: '🌙 Тёмная',
        light: '☀️ Светлая',
        highContrast: '⚡ Высокий контраст'
    };

    const showNameEl = document.getElementById('statusShowName');
    if (showNameEl) showNameEl.textContent = `Шоу: ${showName}`;

    const versionEl = document.getElementById('statusVersion');
    if (versionEl) versionEl.textContent = `Версия: ${version}`;

    const autosaveEl = document.getElementById('statusAutosave');
    if (autosaveEl) autosaveEl.textContent = `Автосохранение: ${autoSaveEnabled ? 'вкл' : 'выкл'}`;

    const screensEl = document.getElementById('statusScreens');
    if (screensEl) screensEl.textContent = `📺 Экраны: ${openScreensCount}`;

    const themeEl = document.getElementById('statusTheme');
    if (themeEl) themeEl.textContent = themeNames[currentTheme] || themeNames.dark;

    const modeEl = document.getElementById('statusMode');
    if (modeEl) modeEl.textContent = isElectron ? '⚡ Desktop' : '🌐 Web';

    const fileStatusEl = document.getElementById('statusFile');
    if (fileStatusEl) fileStatusEl.textContent = hasFilePath ? '📁 Файл' : '📝 Новое';

    const oscToggle = document.getElementById('oscMenuToggle');
    if (oscToggle) oscToggle.textContent = oscEnabled ? '✅ OSC включен' : '🔘 Включить OSC';

    const oscStatus = document.getElementById('statusOsc');
    if (oscStatus) {
        oscStatus.textContent = oscEnabled ? '● OSC активен' : '○ OSC отключен';
        oscStatus.className = `status-osc ${oscEnabled ? 'active' : 'inactive'}`;
    }
}

function getOscAddressInputValue(id, fallback = '') {
    const el = document.getElementById(id);
    if (!el) return fallback;
    return (el.value || '').trim() || fallback;
}

function openOscModal() {
    ensureAppStateShape();
    const modal = document.getElementById('oscModal');
    if (!modal) return;
    const s = window.appState.oscSettings || {};
    const g = mergeGlobalCommands(s.globalCommands || {});

    const enabledEl = document.getElementById('modalOscEnable');
    const ipEl = document.getElementById('modalOscRemoteIP');
    const portEl = document.getElementById('modalOscRemotePort');
    const pauseEl = document.getElementById('modalOscGlobalPause');
    const resumeEl = document.getElementById('modalOscGlobalResume');
    const nextEl = document.getElementById('modalOscGlobalNext');
    const endEl = document.getElementById('modalOscGlobalShowEnd');

    if (enabledEl) enabledEl.checked = !!s.enabled;
    if (ipEl) ipEl.value = s.remoteIP || '127.0.0.1';
    if (portEl) portEl.value = String(s.remotePort || 7000);
    if (pauseEl) pauseEl.value = g.onPause?.address || DEFAULT_GLOBAL_COMMANDS.onPause.address;
    if (resumeEl) resumeEl.value = g.onResume?.address || DEFAULT_GLOBAL_COMMANDS.onResume.address;
    if (nextEl) nextEl.value = g.onNext?.address || DEFAULT_GLOBAL_COMMANDS.onNext.address;
    if (endEl) endEl.value = g.onShowEnd?.address || DEFAULT_GLOBAL_COMMANDS.onShowEnd.address;

    modal.style.display = 'flex';
}

function closeOscModal() {
    const modal = document.getElementById('oscModal');
    if (modal) modal.style.display = 'none';
}

function saveOscSettingsFromModal() {
    ensureAppStateShape();

    const enabled = !!document.getElementById('modalOscEnable')?.checked;
    const remoteIP = getOscAddressInputValue('modalOscRemoteIP', '127.0.0.1');
    const remotePort = Math.max(1, Math.min(65535, parseInt(document.getElementById('modalOscRemotePort')?.value, 10) || 7000));
    const prevGlobal = mergeGlobalCommands(window.appState.oscSettings?.globalCommands || {});

    const pauseAddr = getOscAddressInputValue('modalOscGlobalPause', DEFAULT_GLOBAL_COMMANDS.onPause.address);
    const resumeAddr = getOscAddressInputValue('modalOscGlobalResume', DEFAULT_GLOBAL_COMMANDS.onResume.address);
    const nextAddr = getOscAddressInputValue('modalOscGlobalNext', DEFAULT_GLOBAL_COMMANDS.onNext.address);
    const showEndAddr = getOscAddressInputValue('modalOscGlobalShowEnd', DEFAULT_GLOBAL_COMMANDS.onShowEnd.address);

    window.appState.oscSettings = {
        enabled,
        remoteIP,
        remotePort,
        globalCommands: mergeGlobalCommands({
            onPause: { address: pauseAddr, args: prevGlobal.onPause?.args || [] },
            onResume: { address: resumeAddr, args: prevGlobal.onResume?.args || [] },
            onNext: { address: nextAddr, args: prevGlobal.onNext?.args || [] },
            onShowEnd: { address: showEndAddr, args: prevGlobal.onShowEnd?.args || [] }
        })
    };

    try {
        localStorage.setItem('oscSettings', JSON.stringify(window.appState.oscSettings));
    } catch (e) {
        console.warn('oscSettings localStorage:', e);
    }

    notifyStateChange();
    closeOscModal();
    showOperatorNotice('OSC настройки сохранены');
}

function initOscModalControls() {
    const modal = document.getElementById('oscModal');
    if (!modal) return;

    document.getElementById('closeOscModal')?.addEventListener('click', closeOscModal);
    document.getElementById('cancelOscModalBtn')?.addEventListener('click', closeOscModal);
    document.getElementById('saveOscModalBtn')?.addEventListener('click', saveOscSettingsFromModal);
    document.getElementById('testOscModalBtn')?.addEventListener('click', () => testOSCConnection());

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeOscModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeOscModal();
        }
    });
}

function readSpeakerCustomizationFromModal() {
    const base = { ...mergeSpeakerCustomization(window.appState.speakerCustomization) };
    document.querySelectorAll('[data-speaker-modal-field]').forEach((el) => {
        const key = el.getAttribute('data-speaker-modal-field');
        if (!key || !Object.prototype.hasOwnProperty.call(DEFAULT_SPEAKER_CUSTOMIZATION, key)) return;
        if (el.type === 'checkbox') base[key] = !!el.checked;
        else base[key] = el.value;
    });
    return mergeSpeakerCustomization(base);
}

const SPEAKER_LAYOUT_PRESETS = {
    focus: {
        showCurrent: true,
        showNext: false,
        showPrepare: false,
        showNotes: false,
        showScript: true,
        showTimer: false,
        showCountdown: true,
        showLiveIndicator: false,
        showClock: false,
        showLogo: false
    },
    balanced: {
        showCurrent: true,
        showNext: true,
        showPrepare: false,
        showNotes: true,
        showScript: false,
        showTimer: true,
        showCountdown: true,
        showLiveIndicator: false,
        showClock: false,
        showLogo: false
    },
    full: {
        showCurrent: true,
        showNext: true,
        showPrepare: true,
        showNotes: true,
        showScript: true,
        showTimer: true,
        showCountdown: true,
        showLiveIndicator: true,
        showClock: true,
        showLogo: true
    }
};

let isApplyingSpeakerPreset = false;

function updateSpeakerLogoPreview(root = document) {
    const urlInput = root.querySelector('[data-speaker-modal-field="logoUrl"]');
    const previewWrap = root.querySelector('#logoPreviewWrap');
    const previewImg = root.querySelector('#speakerLogoPreviewImg');
    if (!urlInput || !previewWrap || !previewImg) return;
    const logoUrl = String(urlInput.value || '').trim();
    if (!logoUrl) {
        previewWrap.style.display = 'none';
        previewImg.removeAttribute('src');
        return;
    }
    previewImg.src = logoUrl;
    previewWrap.style.display = 'flex';
}

function applySpeakerPresetToModal(presetName, root = document) {
    const preset = SPEAKER_LAYOUT_PRESETS[presetName];
    if (!preset) return;
    isApplyingSpeakerPreset = true;
    Object.entries(preset).forEach(([key, value]) => {
        const field = root.querySelector(`[data-speaker-modal-field="${key}"]`);
        if (!field || field.type !== 'checkbox') return;
        field.checked = !!value;
    });
    const presetSelect = root.querySelector('[data-speaker-modal-field="speakerLayoutPreset"]');
    if (presetSelect) presetSelect.value = presetName;
    updateStrictSyncControlsState(root);
    isApplyingSpeakerPreset = false;
}

function applySpeakerCustomizationSettings(newSettings, options = {}) {
    const { closeModal = false, notice = '' } = options;
    ensureAppStateShape();
    window.appState.speakerCustomization = newSettings;
    applyStrictScriptVars(newSettings);
    refreshAllScriptEditorsMode();
    try {
        localStorage.setItem(SPEAKER_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(newSettings));
    } catch (e) {
        console.warn('speakerCustomization localStorage:', e);
    }
    notifyStateChange();
    if (Array.isArray(window.openScreens)) {
        window.openScreens
            .filter((screen) => screen && !screen.closed && (screen.__operatorScreenType === 'speaker' || screen.__operatorScreenType === 'prompter'))
            .forEach((screen) => {
                try {
                    screen.postMessage({ type: SCREEN_MESSAGE_TYPES.APPLY_SPEAKER_CUSTOMIZATION, payload: newSettings }, '*');
                } catch (e) {
                    // ignore
                }
            });
    }
    if (closeModal) closeSpeakerCustomizationModal();
    if (notice) showOperatorNotice(notice);
}

function openSpeakerCustomizationModal() {
    ensureAppStateShape();
    const modal = document.getElementById('speakerCustomizationModal');
    if (!modal) return;
    const c = mergeSpeakerCustomization(window.appState.speakerCustomization);
    document.querySelectorAll('[data-speaker-modal-field]').forEach((el) => {
        const key = el.getAttribute('data-speaker-modal-field');
        if (!key || c[key] === undefined) return;
        if (el.type === 'checkbox') el.checked = !!c[key];
        else el.value = String(c[key] ?? '');
    });
    updateStrictSyncControlsState(modal);
    updateSpeakerLogoPreview(modal);
    modal.style.display = 'flex';
}

function closeSpeakerCustomizationModal() {
    const modal = document.getElementById('speakerCustomizationModal');
    if (modal) modal.style.display = 'none';
}

function saveSpeakerCustomization() {
    const newSettings = readSpeakerCustomizationFromModal();
    applySpeakerCustomizationSettings(newSettings, { closeModal: true, notice: 'Настройки экрана ведущего сохранены' });
}

function initSpeakerCustomizationModal() {
    const modal = document.getElementById('speakerCustomizationModal');
    if (!modal) return;

    document.getElementById('closeSpeakerCustomizationModal')?.addEventListener('click', closeSpeakerCustomizationModal);
    document.getElementById('cancelSpeakerCustomizationBtn')?.addEventListener('click', closeSpeakerCustomizationModal);
    document.getElementById('applySpeakerCustomizationBtn')?.addEventListener('click', () => {
        const applied = readSpeakerCustomizationFromModal();
        applySpeakerCustomizationSettings(applied, { closeModal: false, notice: 'Настройки применены' });
        updateSpeakerLogoPreview(modal);
    });
    document.getElementById('saveSpeakerCustomizationBtn')?.addEventListener('click', saveSpeakerCustomization);
    document.getElementById('previewLogoBtn')?.addEventListener('click', () => {
        updateSpeakerLogoPreview(modal);
    });
    const presetSelect = document.getElementById('speakerLayoutPreset');
    presetSelect?.addEventListener('change', () => {
        const presetName = presetSelect.value;
        if (presetName === 'custom') return;
        applySpeakerPresetToModal(presetName, modal);
    });
    modal.querySelectorAll('[data-speaker-modal-field]').forEach((el) => {
        el.addEventListener('change', (event) => {
            const target = event.target;
            const fieldName = target?.getAttribute ? target.getAttribute('data-speaker-modal-field') : '';
            if (!isApplyingSpeakerPreset && target?.type === 'checkbox' && fieldName !== 'speakerLayoutPreset') {
                const presetEl = modal.querySelector('[data-speaker-modal-field="speakerLayoutPreset"]');
                if (presetEl) presetEl.value = 'custom';
            }
            if (fieldName === 'logoUrl') updateSpeakerLogoPreview(modal);
            updateStrictSyncControlsState(modal);
        });
        if (el.tagName === 'INPUT' && el.type === 'text' && el.getAttribute('data-speaker-modal-field') === 'logoUrl') {
            el.addEventListener('input', () => updateSpeakerLogoPreview(modal));
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeSpeakerCustomizationModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeSpeakerCustomizationModal();
        }
    });
}

const TECH_LAYOUT_PRESETS = {
    compact: {
        showCurrent: true,
        showNext: false,
        showPrepare: false,
        showNotes: false,
        showTimer: true,
        showCountdown: false,
        showClock: false,
        showLiveIndicator: false
    },
    standard: {
        showCurrent: true,
        showNext: true,
        showPrepare: false,
        showNotes: false,
        showTimer: true,
        showCountdown: false,
        showClock: false,
        showLiveIndicator: true
    },
    full: {
        showCurrent: true,
        showNext: true,
        showPrepare: true,
        showNotes: true,
        showTimer: true,
        showCountdown: true,
        showClock: true,
        showLiveIndicator: true
    }
};

let isApplyingTechPreset = false;

function readTechCustomizationFromModal() {
    const base = { ...mergeTechCustomization(window.appState.techCustomization) };
    document.querySelectorAll('[data-tech-modal-field]').forEach((el) => {
        const key = el.getAttribute('data-tech-modal-field');
        if (!key || !Object.prototype.hasOwnProperty.call(DEFAULT_TECH_CUSTOMIZATION, key)) return;
        if (el.type === 'checkbox') base[key] = !!el.checked;
        else base[key] = el.value;
    });
    return mergeTechCustomization(base);
}

function updateTechLogoPreview(root = document) {
    const urlInput = root.querySelector('[data-tech-modal-field="logoUrl"]');
    const previewWrap = root.querySelector('#techLogoPreviewWrap');
    const previewImg = root.querySelector('#techLogoPreviewImg');
    if (!urlInput || !previewWrap || !previewImg) return;
    const logoUrl = String(urlInput.value || '').trim();
    if (!logoUrl) {
        previewWrap.style.display = 'none';
        previewImg.removeAttribute('src');
        return;
    }
    previewImg.src = logoUrl;
    previewWrap.style.display = 'flex';
}

function applyTechPresetToModal(presetName, root = document) {
    const preset = TECH_LAYOUT_PRESETS[presetName];
    if (!preset) return;
    isApplyingTechPreset = true;
    Object.entries(preset).forEach(([key, value]) => {
        const field = root.querySelector(`[data-tech-modal-field="${key}"]`);
        if (!field || field.type !== 'checkbox') return;
        field.checked = !!value;
    });
    const presetSelect = root.querySelector('[data-tech-modal-field="layoutPreset"]');
    if (presetSelect) presetSelect.value = presetName;
    isApplyingTechPreset = false;
}

function applyTechCustomizationSettings(newSettings, { closeModal = false, notice = '' } = {}) {
    ensureAppStateShape();
    window.appState.techCustomization = newSettings;
    try {
        localStorage.setItem(TECH_CUSTOMIZATION_STORAGE_KEY, JSON.stringify(newSettings));
    } catch (e) {
        console.warn('techCustomization localStorage:', e);
    }
    notifyStateChange();
    if (closeModal) closeTechCustomizationModal();
    if (notice) showOperatorNotice(notice);
}

function openTechCustomizationModal() {
    ensureAppStateShape();
    const modal = document.getElementById('techCustomizationModal');
    if (!modal) return;
    const c = mergeTechCustomization(window.appState.techCustomization);
    modal.querySelectorAll('[data-tech-modal-field]').forEach((el) => {
        const key = el.getAttribute('data-tech-modal-field');
        if (!key || c[key] === undefined) return;
        if (el.type === 'checkbox') el.checked = !!c[key];
        else el.value = String(c[key] ?? '');
    });
    updateTechLogoPreview(modal);
    modal.style.display = 'flex';
}

function closeTechCustomizationModal() {
    const modal = document.getElementById('techCustomizationModal');
    if (modal) modal.style.display = 'none';
}

function saveTechCustomization({ closeModal = true, notice = 'Настройки экрана Tech сохранены' } = {}) {
    const settings = readTechCustomizationFromModal();
    applyTechCustomizationSettings(settings, { closeModal, notice });
}

function initTechCustomizationModal() {
    const modal = document.getElementById('techCustomizationModal');
    if (!modal) return;

    document.getElementById('closeTechCustomizationModal')?.addEventListener('click', closeTechCustomizationModal);
    document.getElementById('cancelTechCustomizationBtn')?.addEventListener('click', closeTechCustomizationModal);
    document.getElementById('saveTechCustomizationBtn')?.addEventListener('click', () => saveTechCustomization());
    document.getElementById('applyTechCustomizationBtn')?.addEventListener('click', () => {
        saveTechCustomization({ closeModal: false, notice: 'Настройки Tech применены' });
        updateTechLogoPreview(modal);
    });
    document.getElementById('previewTechLogoBtn')?.addEventListener('click', () => updateTechLogoPreview(modal));

    const presetSelect = modal.querySelector('[data-tech-modal-field="layoutPreset"]');
    presetSelect?.addEventListener('change', () => {
        const presetName = presetSelect.value;
        if (presetName === 'custom') return;
        applyTechPresetToModal(presetName, modal);
    });

    modal.querySelectorAll('[data-tech-modal-field]').forEach((el) => {
        el.addEventListener('change', (event) => {
            const target = event.target;
            const fieldName = target?.getAttribute ? target.getAttribute('data-tech-modal-field') : '';
            if (!isApplyingTechPreset && target?.type === 'checkbox' && fieldName !== 'layoutPreset') {
                const presetEl = modal.querySelector('[data-tech-modal-field="layoutPreset"]');
                if (presetEl) presetEl.value = 'custom';
            }
            if (fieldName === 'logoUrl') updateTechLogoPreview(modal);
        });
        if (el.tagName === 'INPUT' && el.type === 'text' && el.getAttribute('data-tech-modal-field') === 'logoUrl') {
            el.addEventListener('input', () => updateTechLogoPreview(modal));
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeTechCustomizationModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeTechCustomizationModal();
        }
    });
}

function showHotkeysModal() {
    const modal = document.getElementById('hotkeysModal');
    if (modal) modal.style.display = 'flex';
}

function closeHotkeysModal() {
    const modal = document.getElementById('hotkeysModal');
    if (modal) modal.style.display = 'none';
}

function showAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) modal.style.display = 'flex';
}

function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (modal) modal.style.display = 'none';
}

function initHelpModals() {
    const hotkeysModal = document.getElementById('hotkeysModal');
    const aboutModal = document.getElementById('aboutModal');

    document.getElementById('closeHotkeysModal')?.addEventListener('click', closeHotkeysModal);
    document.getElementById('closeAboutModal')?.addEventListener('click', closeAboutModal);

    [hotkeysModal, aboutModal].forEach((modal) => {
        if (!modal) return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (hotkeysModal?.style.display === 'flex') closeHotkeysModal();
        if (aboutModal?.style.display === 'flex') closeAboutModal();
    });
}

const DEFAULT_SPEAKER_CUSTOMIZATION = {
    showCurrent: true,
    showNext: true,
    showPrepare: true,
    showNotes: true,
    showScript: true,
    showTimer: false,
    showCountdown: false,
    showLiveIndicator: true,
    showClock: false,
    showLogo: false,
    mirrorScript: false,
    speakerLayoutPreset: 'custom',
    fontSize: 'medium',
    theme: 'dark',
    logoUrl: '',
    strictScriptSync: false,
    strictScriptWidthPx: 800,
    strictScriptHeightPx: 400,
    strictScriptFontSizePx: 42,
    strictScriptLineHeight: 1.5,
    strictScriptPaddingPx: 16
};

const DEFAULT_TECH_CUSTOMIZATION = {
    layoutPreset: 'standard',
    showCurrent: true,
    showNext: true,
    showPrepare: false,
    showNotes: true,
    showTimer: true,
    showCountdown: false,
    showClock: false,
    showLiveIndicator: true,
    fontSize: 'medium',
    logoUrl: ''
};

function clampSpeakerNumber(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function mergeSpeakerCustomization(raw) {
    const o = { ...DEFAULT_SPEAKER_CUSTOMIZATION };
    if (!raw || typeof raw !== 'object') return o;
    const boolKeys = [
        'showCurrent',
        'showNext',
        'showPrepare',
        'showNotes',
        'showScript',
        'showTimer',
        'showCountdown',
        'showLiveIndicator',
        'showClock',
        'showLogo',
        'strictScriptSync',
        'mirrorScript'
    ];
    boolKeys.forEach((k) => {
        if (typeof raw[k] === 'boolean') o[k] = raw[k];
    });
    if (typeof raw.fontSize === 'string' && raw.fontSize) o.fontSize = raw.fontSize;
    if (typeof raw.theme === 'string' && raw.theme) o.theme = raw.theme;
    if (typeof raw.logoUrl === 'string') o.logoUrl = raw.logoUrl;
    if (typeof raw.speakerLayoutPreset === 'string' && ['focus', 'balanced', 'full', 'custom'].includes(raw.speakerLayoutPreset)) {
        o.speakerLayoutPreset = raw.speakerLayoutPreset;
    }
    o.strictScriptWidthPx = clampSpeakerNumber(raw.strictScriptWidthPx, o.strictScriptWidthPx, 320, 1920);
    o.strictScriptHeightPx = clampSpeakerNumber(raw.strictScriptHeightPx, o.strictScriptHeightPx, 180, 1200);
    o.strictScriptFontSizePx = clampSpeakerNumber(raw.strictScriptFontSizePx, o.strictScriptFontSizePx, 16, 144);
    o.strictScriptLineHeight = clampSpeakerNumber(raw.strictScriptLineHeight, o.strictScriptLineHeight, 1, 2.2);
    o.strictScriptPaddingPx = clampSpeakerNumber(raw.strictScriptPaddingPx, o.strictScriptPaddingPx, 4, 80);
    return o;
}

function mergeTechCustomization(raw) {
    const o = { ...DEFAULT_TECH_CUSTOMIZATION };
    if (!raw || typeof raw !== 'object') return o;
    const boolKeys = [
        'showCurrent',
        'showNext',
        'showPrepare',
        'showNotes',
        'showTimer',
        'showCountdown',
        'showClock',
        'showLiveIndicator'
    ];
    boolKeys.forEach((k) => {
        if (typeof raw[k] === 'boolean') o[k] = raw[k];
    });
    if (typeof raw.fontSize === 'string' && ['small', 'medium', 'large', 'xlarge'].includes(raw.fontSize)) {
        o.fontSize = raw.fontSize;
    }
    if (typeof raw.logoUrl === 'string') o.logoUrl = raw.logoUrl;
    if (typeof raw.layoutPreset === 'string' && ['compact', 'standard', 'full', 'custom'].includes(raw.layoutPreset)) {
        o.layoutPreset = raw.layoutPreset;
    }
    return o;
}

function updateStrictSyncControlsState(root = document) {
    const strictEnabled = !!root.querySelector('[data-speaker-modal-field="strictScriptSync"]')?.checked;
    const fontSizeSelect = root.querySelector('[data-speaker-modal-field="fontSize"]');
    const strictSection = root.querySelector('#strictSyncAdvancedSection');
    if (fontSizeSelect) {
        fontSizeSelect.disabled = strictEnabled;
        fontSizeSelect.title = strictEnabled ? 'Управляется строгим режимом' : '';
    }
    if (strictSection) {
        strictSection.style.display = strictEnabled ? 'grid' : 'none';
    }
}

function readSpeakerCustomizationFromUI() {
    ensureAppStateShape();
    const base = { ...mergeSpeakerCustomization(window.appState.speakerCustomization) };
    document.querySelectorAll('[data-speaker-field]').forEach((el) => {
        const key = el.getAttribute('data-speaker-field');
        if (!key || !Object.prototype.hasOwnProperty.call(DEFAULT_SPEAKER_CUSTOMIZATION, key)) return;
        if (el.type === 'checkbox') {
            base[key] = !!el.checked;
        } else {
            base[key] = el.value;
        }
    });
    window.appState.speakerCustomization = mergeSpeakerCustomization(base);
    applyStrictScriptVars(window.appState.speakerCustomization);
}

function syncSpeakerCustomizationToUI() {
    const c = mergeSpeakerCustomization(window.appState.speakerCustomization);
    document.querySelectorAll('[data-speaker-field]').forEach((el) => {
        const key = el.getAttribute('data-speaker-field');
        if (!key || c[key] === undefined) return;
        if (el.type === 'checkbox') el.checked = !!c[key];
        else el.value = String(c[key] ?? '');
    });
    const modal = document.getElementById('speakerCustomizationModal');
    if (modal) updateStrictSyncControlsState(modal);
}

function initSpeakerCustomizationControls() {
    let inputDebounce;
    const onChange = () => {
        readSpeakerCustomizationFromUI();
        refreshAllScriptEditorsMode();
        notifyStateChange();
    };
    document.querySelectorAll('[data-speaker-field]').forEach((el) => {
        el.addEventListener('change', onChange);
        if (el.tagName === 'INPUT' && el.type === 'text') {
            el.addEventListener('blur', onChange);
            el.addEventListener('input', () => {
                clearTimeout(inputDebounce);
                inputDebounce = setTimeout(onChange, 400);
            });
        }
    });
}

const stateManager = createStateManager({
    mergeGlobalCommands,
    mergeSpeakerCustomization,
    mergeTechCustomization,
    clampScriptAutoSpeed,
    SPEAKER_CUSTOMIZATION_STORAGE_KEY,
    TECH_CUSTOMIZATION_STORAGE_KEY,
    renderOperatorTimer: () => renderOperatorTimer(),
    renderOperatorCueBar: () => renderOperatorCueBar(),
    updateMonitorIndicators: () => updateMonitorIndicators(),
    updateActionItemsVisualState: () => updateActionItemsVisualState(),
    updateStatusBar: () => updateStatusBar(),
    debouncedAutoSave: () => debouncedAutoSave(),
    getActionIdFromElement,
    getScrollPercent,
    syncDurationFromPlanned,
    sendCueOscOnEnd,
    sendCueOscOnStart,
    stopScriptAutoLoop,
    disableScriptAutoForAction,
    refreshScriptControlsForActionId,
    clearOperatorListFocus,
    flashActiveCueHighlight,
    maybeStartScriptAutoLoopForCurrentCue
});
const { ensureAppStateShape, notifyStateChange, syncStateFromDomOrder, setActiveAction } = stateManager;
window.ensureAppStateShape = ensureAppStateShape;
window.notifyStateChange = notifyStateChange;
window.syncStateFromDomOrder = syncStateFromDomOrder;
window.setActiveAction = setActiveAction;

function parseArgsFromInput(str) {
    if (!str || !String(str).trim()) return [];
    return String(str).split(',').map((x) => x.trim()).filter(Boolean);
}

function formatArgsForInput(args) {
    if (!Array.isArray(args)) return '';
    return args.map((a) => String(a)).join(', ');
}

function interpolateArgs(args, action) {
    const a = action || {};
    const title = a.title ?? '';
    const id = a.id ?? '';
    const duration = a.durationSec != null ? String(a.durationSec) : '';
    const type = a.type ?? '';
    return (Array.isArray(args) ? args : []).map((arg) =>
        String(arg)
            .replace(/{title}/g, title)
            .replace(/{id}/g, id)
            .replace(/{duration}/g, duration)
            .replace(/{type}/g, type)
    );
}

/** Подробные логи в консоли браузера: `localStorage.setItem('OSC_DEBUG','1')` и F5, или `?oscdebug=1` */
function isOscDebug() {
    try {
        if (typeof window === 'undefined') return false;
        if (new URLSearchParams(window.location.search).get('oscdebug') === '1') return true;
        return localStorage.getItem('OSC_DEBUG') === '1';
    } catch {
        return false;
    }
}

function oscDbg(...args) {
    if (isOscDebug()) console.log(...args);
}

/**
 * Отправка OSC через POST /api/osc (сервер шлёт UDP).
 * @returns {Promise<boolean>}
 */
async function sendOSC(address, args, context = 'unknown') {
    oscDbg(`🎛️ [${context}] sendOSC:`, address, args);

    const settings = window.appState.oscSettings;
    if (!settings?.enabled) {
        oscDbg(`⚠️ [${context}] OSC отключен, команда не отправлена`);
        return false;
    }
    if (!address) {
        oscDbg(`⚠️ [${context}] Нет адреса`);
        return false;
    }

    const h = settings.remoteIP || '127.0.0.1';
    const p = Number(settings.remotePort) > 0 ? Number(settings.remotePort) : 7000;
    const list = Array.isArray(args) ? args : [];

    const payload = {
        address,
        args: list,
        host: h,
        port: p,
        remoteIP: h,
        remotePort: p
    };

    oscDbg(`📤 [${context}] POST /api/osc`, payload);

    try {
        const response = await fetch('/api/osc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        let result = {};
        try {
            result = text ? JSON.parse(text) : {};
        } catch {
            result = { raw: text };
        }

        if (response.ok) {
            oscDbg(`✅ [${context}] Ответ сервера:`, result);
            flashOscControlGroup();
            return true;
        }

        const reason = result?.error || result?.message || result?.raw || `HTTP ${response.status}`;
        showToast(`Ошибка отправки OSC: ${reason}`, 'error');
        console.warn(`❌ [${context}] Ошибка сервера OSC:`, response.status, result);
        return false;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showToast(`Ошибка отправки OSC: ${message}`, 'error');
        console.warn(`❌ [${context}] Ошибка fetch /api/osc:`, message);
        oscDbg('   Убедитесь, что сервер запущен: npm start');
        return false;
    }
}

async function testOSCConnection() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 ТЕСТ OSC СОЕДИНЕНИЯ');

    readOscSettingsFromUI();
    const settings = window.appState.oscSettings;
    console.log('   OSC включен:', settings.enabled);
    console.log('   IP:', settings.remoteIP);
    console.log('   Порт:', settings.remotePort);

    if (!settings.enabled) {
        console.log('⚠️ OSC отключен в настройках (включите «Включить отправку»)');
        return;
    }

    const h = settings.remoteIP || '127.0.0.1';
    const p = Number(settings.remotePort) > 0 ? Number(settings.remotePort) : 7000;
    const testCommand = {
        address: '/ping',
        args: ['test', Date.now()],
        host: h,
        port: p,
        remoteIP: h,
        remotePort: p
    };

    console.log('📤 Тестовая команда:', testCommand);

    try {
        const response = await fetch('/api/osc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testCommand)
        });
        const result = await response.json().catch(() => ({}));
        console.log('📥 Ответ сервера:', result);

        if (response.ok) {
            console.log('✅ Запрос дошёл до сервера; UDP отправлен (подробности: OSC_DEBUG=1 в терминале сервера).');
            flashOscControlGroup();
        } else {
            console.log('❌ Сервер вернул ошибку:', result);
        }
    } catch (err) {
        console.log('❌ Ошибка соединения с сервером:', err.message);
        console.log('   Проверьте, что запущен node server.js и открыт тот же origin.');
    }
}

function sendCueOscOnEnd(action) {
    const settings = window.appState.oscSettings;
    if (!settings?.enabled) return;
    const cmd = getEffectiveCueCommand('onEnd', action?.osc?.onEnd);
    void sendOSC(cmd.address, interpolateArgs(cmd.args || [], action), 'cue-onEnd');
}

function sendCueOscOnStart(action) {
    const settings = window.appState.oscSettings;
    if (!settings?.enabled) return;
    const cmd = getEffectiveCueCommand('onStart', action?.osc?.onStart);
    void sendOSC(cmd.address, interpolateArgs(cmd.args || [], action), 'cue-onStart');
}

function sendGlobalOsc(kind) {
    const settings = window.appState.oscSettings;
    if (!settings?.enabled) return;
    const merged = mergeGlobalCommands(settings.globalCommands || {});
    const cmd = merged[kind];
    if (!cmd?.address) return;
    const cur = window.appState.actions[window.appState.currentIndex];
    const ctx = cur || { title: '', id: '', durationSec: null, type: '' };
    void sendOSC(cmd.address, interpolateArgs(cmd.args || [], ctx), `global-${kind}`);
}

/**
 * OSC при нажатии «ГОТОВО» на текущем в эфире cue: onEnd; если это последнее событие — onShowEnd и сброс таймера.
 * Не вызывать вместе с setActiveAction на тот же cue (иначе двойной onEnd).
 */
function applyDoneOscAndMaybeFinishShow(actionItem, actionId) {
    const action = window.appState.actions.find((a) => a.id === actionId);
    if (!action) return false;
    const idx = window.appState.actions.findIndex((a) => a.id === actionId);
    if (idx < 0) return false;
    const isCurrentAir = idx === window.appState.currentIndex && actionItem.classList.contains('active');
    if (!isCurrentAir) return false;

    sendCueOscOnEnd(action);

    // Фиксируем момент остановки, чтобы elapsed перестал расти по формуле getElapsedTime().
    if (window.appState.startedAt && window.appState.pausedAt == null) {
        window.appState.pausedAt = Date.now();
    }
    window.appState.isRunning = false;

    const isLast = idx === window.appState.actions.length - 1;
    if (isLast) {
        sendGlobalOsc('onShowEnd');
        showOperatorNotice('Шоу завершено');
        window.appState.startedAt = null;
        window.appState.isRunning = false;
        window.appState.pausedAt = null;
        window.appState.accumulatedPause = 0;
        return false;
    }
    // DONE не переводит на следующий cue автоматически.
    return false;
}

function showOperatorNotice(message, durationMs = 3500) {
    const el = document.getElementById('error-message');
    if (!el) return;
    const errorText = el.querySelector('.error-text');
    if (errorText) errorText.textContent = message;
    el.classList.add('operator-notice--success');
    el.style.display = 'flex';
    setTimeout(() => {
        el.style.display = 'none';
        el.classList.remove('operator-notice--success');
    }, durationMs);
}

let autoSaveTimeout;
function debouncedAutoSave() {
    if (!window.appState.showMeta?.autoSaveEnabled) return;
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        try {
            saveCurrentShow({ downloadFile: false });
        } catch (e) {
            console.warn('autoSave:', e);
        }
    }, 3000);
}

function sanitizeShowStorageKey(name) {
    const base = (name || 'show').trim() || 'show';
    return base.replace(/[^\w\u0400-\u04FF\-_. ]/g, '_').slice(0, 120);
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function normalizeActionFromShowFile(a) {
    let notes = [];
    if (Array.isArray(a.notes)) {
        notes = a.notes.map((n) =>
            typeof n === 'object' && n && n.text != null
                ? { id: n.id || generateId('note'), text: String(n.text) }
                : { id: generateId('note'), text: String(n) }
        );
    } else if (typeof a.notes === 'string' && a.notes.trim()) {
        notes = [{ id: generateId('note'), text: a.notes.trim() }];
    }
    const osc = a.osc && typeof a.osc === 'object'
        ? {
            onStart: a.osc.onStart?.address ? { address: String(a.osc.onStart.address), args: Array.isArray(a.osc.onStart.args) ? a.osc.onStart.args.map(String) : [] } : null,
            onEnd: a.osc.onEnd?.address ? { address: String(a.osc.onEnd.address), args: Array.isArray(a.osc.onEnd.args) ? a.osc.onEnd.args.map(String) : [] } : null
        }
        : { onStart: null, onEnd: null };
    return {
        id: a.id || generateId('action'),
        title: a.title != null ? String(a.title) : '',
        notes,
        plannedStart: a.plannedStart != null ? String(a.plannedStart) : null,
        durationSec: a.durationSec != null ? Number(a.durationSec) : null,
        type: a.type || ACTION_TYPES.PERFORMANCE,
        completed: !!a.completed,
        scriptText: typeof a.scriptText === 'string' ? a.scriptText : '',
        scriptScrollPos: clampScriptScrollPos(typeof a.scriptScrollPos === 'number' ? a.scriptScrollPos : 0),
        scriptScrollTopPx: Number.isFinite(a.scriptScrollTopPx) ? Math.max(0, Number(a.scriptScrollTopPx)) : 0,
        scriptAutoSpeed: clampScriptAutoSpeed(typeof a.scriptAutoSpeed === 'number' ? a.scriptAutoSpeed : 0.05),
        scriptAutoEnabled: !!a.scriptAutoEnabled,
        scriptAutoStart: !!a.scriptAutoStart,
        osc
    };
}

function hydrateScriptFromState(actionItem, action) {
    const ta = actionItem.querySelector('textarea.script-textarea');
    const strictEditor = actionItem.querySelector('.script-editor-strict');
    if (!ta && !strictEditor) return;
    const text = typeof action.scriptText === 'string' ? action.scriptText : '';
    setEditorText(ta, text);
    setEditorText(strictEditor, text);
    const p = clampScriptScrollPos(typeof action.scriptScrollPos === 'number' ? action.scriptScrollPos : 0);
    const strictPx = Number.isFinite(action.scriptScrollTopPx) ? Math.max(0, action.scriptScrollTopPx) : 0;
    if (ta) ta.dataset._scriptScrollIgnore = '1';
    if (strictEditor) strictEditor.dataset._scriptScrollIgnore = '1';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (ta) setScrollPercent(ta, p);
            if (strictEditor) strictEditor.scrollTop = strictPx || clampScriptScrollPos(p) * Math.max(0, strictEditor.scrollHeight - strictEditor.clientHeight);
            requestAnimationFrame(() => {
                if (ta) ta.dataset._scriptScrollIgnore = '0';
                if (strictEditor) strictEditor.dataset._scriptScrollIgnore = '0';
            });
        });
    });
    syncScriptEditorMode(actionItem);
    if (action.id) refreshScriptControlsForActionId(action.id);
}

function syncScriptEditorMode(actionItem) {
    const strict = isStrictScriptSyncEnabled();
    const ta = actionItem.querySelector('textarea.script-textarea');
    const strictEditor = actionItem.querySelector('.script-editor-strict');
    const lock = actionItem.querySelector('.script-sync-lock');
    if (!ta || !strictEditor) return;
    if (strict) {
        setEditorText(strictEditor, getEditorText(ta));
    } else {
        setEditorText(ta, getEditorText(strictEditor));
    }
    ta.style.display = strict ? 'none' : '';
    strictEditor.style.display = strict ? 'block' : 'none';
    if (lock) lock.style.display = strict ? 'inline-flex' : 'none';
}

function hydrateNotesFromState(actionItem, action) {
    const container = actionItem.querySelector('.action-notes');
    if (!container || !action.notes?.length) return;
    action.notes.forEach((noteObj) => {
        const noteElement = document.createElement('div');
        noteElement.className = 'note';
        noteElement.contentEditable = true;
        noteElement.textContent = noteObj.text || '';
        const nid = noteObj.id || generateId('note');
        noteElement.dataset.noteId = nid;
        if (!noteObj.id) noteObj.id = nid;
        container.appendChild(noteElement);
        noteElement.addEventListener('blur', () => {
            const st = window.appState.actions.find((x) => x.id === action.id);
            const n = st?.notes?.find((x) => x.id === nid);
            const updated = noteElement.textContent?.trim() || '';
            if (n) n.text = updated;
            if (!updated) {
                noteElement.remove();
                if (st && Array.isArray(st.notes)) {
                    st.notes = st.notes.filter((x) => x.id !== nid);
                }
            }
            updateActionNoteSummary(actionItem, st || action);
            renderActionNotesDropdown(actionItem, st || action);
            notifyStateChange();
        });
    });
}

function updateActionNoteSummary(actionItem, actionState) {
    if (!actionItem) return;
    const summaryEl = actionItem.querySelector('.action-note-summary');
    if (!summaryEl) return;
    const notes = Array.isArray(actionState?.notes)
        ? actionState.notes
            .map((n) => (typeof n === 'string' ? n : String(n?.text || '')))
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (!notes.length) {
        summaryEl.textContent = '';
        summaryEl.style.display = 'none';
        return;
    }
    summaryEl.textContent = notes.length > 1 ? `💬 ${notes.length}` : `💬 ${notes[0]}`;
    summaryEl.style.display = 'block';
}

function renderActionNotesDropdown(actionItem, actionState) {
    if (!actionItem) return;
    const dropdownEl = actionItem.querySelector('.action-notes-dropdown');
    if (!dropdownEl) return;
    const notes = Array.isArray(actionState?.notes) ? actionState.notes.filter((n) => String(n?.text || '').trim()) : [];
    dropdownEl.innerHTML = '';
    if (!notes.length) {
        dropdownEl.style.display = 'none';
        return;
    }
    notes.forEach((note) => {
        const row = document.createElement('div');
        row.className = 'action-note-dropdown-row';
        const text = document.createElement('span');
        text.className = 'action-note-dropdown-text';
        text.textContent = String(note.text || '').trim();
        row.appendChild(text);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'action-note-dropdown-delete';
        del.textContent = '✕';
        del.title = 'Удалить заметку';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            const actionId = getActionIdFromElement(actionItem);
            if (!actionId) return;
            deleteNoteFromAction(actionId, note.id);
        });
        row.appendChild(del);
        dropdownEl.appendChild(row);
    });
}

function hideAllActionNoteDropdowns(exceptActionItem = null) {
    document.querySelectorAll('#scenario-items .action-item.action-item--notes-open').forEach((item) => {
        if (exceptActionItem && item === exceptActionItem) return;
        item.classList.remove('action-item--notes-open');
    });
    document.querySelectorAll('#scenario-items .action-item .action-notes-dropdown').forEach((el) => {
        const owner = el.closest('.action-item');
        if (exceptActionItem && owner === exceptActionItem) return;
        el.style.display = 'none';
    });
}

function toggleActionNoteDropdown(actionItem) {
    if (!actionItem) return;
    const dropdownEl = actionItem.querySelector('.action-notes-dropdown');
    if (!dropdownEl) return;
    const actionId = getActionIdFromElement(actionItem);
    const action = window.appState.actions.find((a) => a.id === actionId);
    renderActionNotesDropdown(actionItem, action);
    if (!dropdownEl.childElementCount) return;
    const willShow = dropdownEl.style.display !== 'block';
    hideAllActionNoteDropdowns(actionItem);
    dropdownEl.style.display = willShow ? 'block' : 'none';
    actionItem.classList.toggle('action-item--notes-open', willShow);
}

function updateActionNotesUI(actionId) {
    const actionItem = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    if (!actionItem) return;
    const actionState = window.appState.actions.find((a) => a.id === actionId);
    updateActionNoteSummary(actionItem, actionState);
    renderActionNotesDropdown(actionItem, actionState);
}

function deleteNoteFromAction(actionId, noteId) {
    const actionState = window.appState.actions.find((a) => a.id === actionId);
    if (!actionState || !Array.isArray(actionState.notes)) return;
    actionState.notes = actionState.notes.filter((n) => n.id !== noteId);
    const noteEl = document.querySelector(
        `#scenario-items .action-item[data-action-id="${actionId}"] .action-notes .note[data-note-id="${noteId}"]`
    );
    if (noteEl) noteEl.remove();
    updateActionNotesUI(actionId);
    notifyStateChange();
    if (cueNoteEditingActionId === actionId) {
        renderCueNoteModalList(actionState);
    }
}

function updateNoteInAction(actionId, noteId, newText) {
    const actionState = window.appState.actions.find((a) => a.id === actionId);
    if (!actionState || !Array.isArray(actionState.notes)) return;
    const note = actionState.notes.find((n) => n.id === noteId);
    if (!note) return;
    note.text = String(newText || '').trim();
    const noteEl = document.querySelector(
        `#scenario-items .action-item[data-action-id="${actionId}"] .action-notes .note[data-note-id="${noteId}"]`
    );
    if (noteEl) noteEl.textContent = note.text;
    updateActionNotesUI(actionId);
    notifyStateChange();
}

function renderCueNoteModalList(actionState) {
    const listWrap = document.getElementById('cueNoteListWrap');
    const list = document.getElementById('cueNoteList');
    if (!listWrap || !list) return;
    const notes = Array.isArray(actionState?.notes) ? actionState.notes.filter((n) => String(n?.text || '').trim()) : [];
    list.innerHTML = '';
    if (!notes.length) {
        listWrap.style.display = 'none';
        return;
    }
    notes.forEach((note) => {
        const row = document.createElement('div');
        row.className = 'cue-note-item-row';
        const text = document.createElement('span');
        text.className = 'cue-note-item-text';
        text.textContent = String(note.text || '').trim();
        row.appendChild(text);
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-secondary cue-note-item-btn';
        editBtn.textContent = 'Ред.';
        editBtn.addEventListener('click', () => {
            const input = document.getElementById('cueNoteText');
            if (!input) return;
            cueNoteEditingNoteId = note.id;
            input.value = String(note.text || '');
            input.focus();
        });
        row.appendChild(editBtn);
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-secondary cue-note-item-btn cue-note-item-btn--danger';
        delBtn.textContent = 'Удалить';
        delBtn.addEventListener('click', () => {
            if (!cueNoteEditingActionId) return;
            deleteNoteFromAction(cueNoteEditingActionId, note.id);
        });
        row.appendChild(delBtn);
        list.appendChild(row);
    });
    listWrap.style.display = 'block';
}

function createActionItemFromState(action, number) {
    const planned = action.plannedStart != null ? String(action.plannedStart) : '';
    const item = createActionItem(action.title || '', planned, number, action.id);
    if (!item) return null;
    if (action.completed) item.classList.add('completed');
    hydrateScriptFromState(item, action);
    hydrateNotesFromState(item, action);
    updateActionNoteSummary(item, action);
    return item;
}

function hasCueOscCommands(action) {
    if (!action || !action.osc) return false;
    const onStart = action.osc.onStart?.address?.trim();
    const onEnd = action.osc.onEnd?.address?.trim();
    return !!(onStart || onEnd);
}

function refreshCueOscIndicator(actionItem, actionId) {
    if (!actionItem || !actionId) return;
    const content = actionItem.querySelector('.action-content');
    if (!content) return;
    const action = window.appState.actions.find((a) => a.id === actionId);
    let indicator = content.querySelector('.action-osc-indicator');
    const visible = hasCueOscCommands(action);

    if (!visible) {
        if (indicator) indicator.remove();
        return;
    }

    if (!indicator) {
        indicator = document.createElement('span');
        indicator.className = 'action-osc-indicator';
        indicator.textContent = '🎛️';
        indicator.setAttribute('aria-hidden', 'true');
        const textEl = content.querySelector('.action-text');
        if (textEl) textEl.insertAdjacentElement('afterend', indicator);
        else content.appendChild(indicator);
    }
    indicator.title = 'Для cue настроены OSC-команды';
}

function fullRerender() {
    const container = document.getElementById('scenario-items');
    if (!container) return;
    if (window.sortableInstance) {
        window.sortableInstance.destroy();
        window.sortableInstance = null;
    }
    container.innerHTML = '';
    window.appState.actions.forEach((action, idx) => {
        const el = createActionItemFromState(action, idx + 1);
        if (el) container.appendChild(el);
    });
    updateActionNumbers();
    updateCounters();
    initializeSortable();
    syncStateFromDomOrder({ notify: false });
    updateActionItemsVisualState();
    renderOperatorCueBar();
    applyOscSettingsToUI();
    refreshAllOscDetailsUI();
}

function attachOscDetailsToActionItem(actionItem, actionId) {
    if (!actionItem || !actionId) return;
    if (actionItem.dataset.oscDetailsBound === '1') return;
    actionItem.dataset.oscDetailsBound = '1';

    actionItem.querySelectorAll('.action-osc-details').forEach((el) => el.remove());

    const refreshFromState = () => refreshCueOscIndicator(actionItem, actionId);
    actionItem._refreshOscDetailsFromState = refreshFromState;
    refreshFromState();
}

function refreshAllOscDetailsUI() {
    document.querySelectorAll('#scenario-items .action-item').forEach((el) => {
        if (typeof el._refreshOscDetailsFromState === 'function') {
            el._refreshOscDetailsFromState();
        }
    });
}

function showCueContextMenu(actionItem, clientX, clientY) {
    const menu = document.getElementById('cueContextMenu');
    if (!menu || !actionItem) return;
    cueContextActionId = getActionIdFromElement(actionItem);
    if (!cueContextActionId) return;
    const moveAfterActiveBtn = menu.querySelector('[data-action="moveAfterActive"]');
    const activeEl = document.querySelector('#scenario-items .action-item.active');
    const activeId = activeEl ? getActionIdFromElement(activeEl) : null;
    if (moveAfterActiveBtn) {
        const disableMoveAfterActive = !activeId || cueContextActionId === activeId;
        moveAfterActiveBtn.disabled = disableMoveAfterActive;
        moveAfterActiveBtn.title = disableMoveAfterActive
            ? 'Нет активного cue или выбран активный cue'
            : 'Переместить cue сразу после текущего в эфире';
    }

    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    const menuRect = menu.getBoundingClientRect();
    const maxLeft = window.innerWidth - menuRect.width - 8;
    const maxTop = window.innerHeight - menuRect.height - 8;
    const left = Math.max(8, Math.min(clientX, maxLeft));
    const top = Math.max(8, Math.min(clientY, maxTop));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = 'visible';
}

function hideCueContextMenu() {
    const menu = document.getElementById('cueContextMenu');
    if (!menu) return;
    menu.style.display = 'none';
    cueContextActionId = null;
}

function openCueOscModal(actionId) {
    ensureAppStateShape();
    const action = window.appState.actions.find((a) => a.id === actionId);
    const modal = document.getElementById('cueOscModal');
    if (!action || !modal) return;

    cueOscEditingActionId = actionId;
    const osc = action.osc || {};
    const startEff = getEffectiveCueCommand('onStart', osc.onStart);
    const endEff = getEffectiveCueCommand('onEnd', osc.onEnd);

    const sAddr = document.getElementById('cueOscStartAddress');
    const sArgs = document.getElementById('cueOscStartArgs');
    const eAddr = document.getElementById('cueOscEndAddress');
    const eArgs = document.getElementById('cueOscEndArgs');

    if (sAddr) sAddr.value = startEff.address;
    if (sArgs) sArgs.value = formatArgsForInput(startEff.args);
    if (eAddr) eAddr.value = endEff.address;
    if (eArgs) eArgs.value = formatArgsForInput(endEff.args);

    modal.style.display = 'flex';
}

function closeCueOscModal() {
    const modal = document.getElementById('cueOscModal');
    if (modal) modal.style.display = 'none';
    cueOscEditingActionId = null;
}

function openCueNoteModal(actionId) {
    const modal = document.getElementById('cueNoteModal');
    const input = document.getElementById('cueNoteText');
    const actionState = window.appState.actions.find((a) => a.id === actionId);
    if (!modal || !input || !actionId || !actionState) return;
    cueNoteEditingActionId = actionId;
    cueNoteEditingNoteId = null;
    input.value = '';
    renderCueNoteModalList(actionState);
    modal.style.display = 'flex';
    requestAnimationFrame(() => input.focus());
}

function closeCueNoteModal() {
    const modal = document.getElementById('cueNoteModal');
    const input = document.getElementById('cueNoteText');
    if (modal) modal.style.display = 'none';
    if (input) input.value = '';
    cueNoteEditingActionId = null;
    cueNoteEditingNoteId = null;
}

function saveCueNoteFromModal() {
    const input = document.getElementById('cueNoteText');
    const actionId = cueNoteEditingActionId;
    if (!input || !actionId) return;
    const noteText = String(input.value || '').trim();
    if (!noteText) {
        showOperatorNotice('Введите текст заметки');
        input.focus();
        return;
    }
    const actionState = window.appState.actions.find((a) => a.id === actionId);
    if (!actionState) {
        closeCueNoteModal();
        return;
    }
    if (cueNoteEditingNoteId) {
        updateNoteInAction(actionId, cueNoteEditingNoteId, noteText);
        cueNoteEditingNoteId = null;
        input.value = '';
        renderCueNoteModalList(actionState);
        showOperatorNotice('Заметка обновлена');
        return;
    }
    const actionItem = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    if (!actionItem) {
        closeCueNoteModal();
        return;
    }
    addNoteToAction(actionItem, noteText);
    input.value = '';
    renderCueNoteModalList(actionState);
    showOperatorNotice('Заметка добавлена');
}

function initCueNoteModalControls() {
    const modal = document.getElementById('cueNoteModal');
    if (!modal) return;
    document.getElementById('closeCueNoteModal')?.addEventListener('click', closeCueNoteModal);
    document.getElementById('cancelCueNoteModalBtn')?.addEventListener('click', closeCueNoteModal);
    document.getElementById('saveCueNoteModalBtn')?.addEventListener('click', saveCueNoteFromModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCueNoteModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeCueNoteModal();
        }
        if (e.key === 'Enter' && modal.style.display === 'flex' && (e.metaKey || e.ctrlKey)) {
            saveCueNoteFromModal();
        }
    });
}

function saveCueOscSettingsFromModal() {
    if (!cueOscEditingActionId) return;
    ensureAppStateShape();
    const action = window.appState.actions.find((a) => a.id === cueOscEditingActionId);
    if (!action) return;
    if (!action.osc) action.osc = { onStart: null, onEnd: null };

    const sAddr = (document.getElementById('cueOscStartAddress')?.value || '').trim();
    const sArgs = document.getElementById('cueOscStartArgs')?.value || '';
    const eAddr = (document.getElementById('cueOscEndAddress')?.value || '').trim();
    const eArgs = document.getElementById('cueOscEndArgs')?.value || '';

    action.osc.onStart = sAddr ? { address: sAddr, args: parseArgsFromInput(sArgs) } : null;
    action.osc.onEnd = eAddr ? { address: eAddr, args: parseArgsFromInput(eArgs) } : null;

    saveCurrentShow({ downloadFile: false });
    notifyStateChange();
    refreshAllOscDetailsUI();
    closeCueOscModal();
    showOperatorNotice('OSC команды для cue сохранены');
}

function duplicateCueById(actionId) {
    const source = window.appState.actions.find((a) => a.id === actionId);
    const sourceEl = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    if (!source || !sourceEl) return;

    const cloned = {
        ...source,
        id: generateId('a'),
        notes: Array.isArray(source.notes) ? source.notes.map((n) => ({ id: generateId('note'), text: String(n.text || '') })) : [],
        osc: source.osc ? {
            onStart: source.osc.onStart ? { address: String(source.osc.onStart.address || ''), args: Array.isArray(source.osc.onStart.args) ? source.osc.onStart.args.map(String) : [] } : null,
            onEnd: source.osc.onEnd ? { address: String(source.osc.onEnd.address || ''), args: Array.isArray(source.osc.onEnd.args) ? source.osc.onEnd.args.map(String) : [] } : null
        } : { onStart: null, onEnd: null },
        completed: false
    };

    const dupEl = createActionItemFromState(cloned, 0);
    if (!dupEl) return;
    sourceEl.insertAdjacentElement('afterend', dupEl);
    syncStateFromDomOrder({ notify: true });
    updateActionNumbers();
    updateCounters();
}

function moveCueById(actionId, direction) {
    const el = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    if (!el) return;
    const before = el.parentElement ? Array.from(el.parentElement.querySelectorAll('.action-item[data-action-id]')).map((x) => x.dataset.actionId) : [];
    if (direction === 'up' && el.previousElementSibling) {
        el.parentElement.insertBefore(el, el.previousElementSibling);
    } else if (direction === 'down' && el.nextElementSibling) {
        el.parentElement.insertBefore(el.nextElementSibling, el);
    }
    const after = el.parentElement ? Array.from(el.parentElement.querySelectorAll('.action-item[data-action-id]')).map((x) => x.dataset.actionId) : [];
    const changed = before.length === after.length && before.some((id, idx) => id !== after[idx]);
    if (!changed) return;
    syncStateFromDomOrder({ notify: true });
    updateActionNumbers();
    updateCounters();
}

function moveCueAfterActive(actionId) {
    const movingEl = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    const activeEl = document.querySelector('#scenario-items .action-item.active');
    if (!movingEl || !activeEl) return;
    const activeId = getActionIdFromElement(activeEl);
    if (!activeId || actionId === activeId) return;

    const before = movingEl.parentElement
        ? Array.from(movingEl.parentElement.querySelectorAll('.action-item[data-action-id]')).map((x) => x.dataset.actionId)
        : [];

    const targetAfterActive = activeEl.nextElementSibling;
    if (targetAfterActive && getActionIdFromElement(targetAfterActive) === actionId) return;

    const parent = movingEl.parentElement;
    if (!parent) return;
    if (targetAfterActive === movingEl) return;
    if (targetAfterActive) parent.insertBefore(movingEl, targetAfterActive);
    else parent.appendChild(movingEl);

    const after = Array.from(parent.querySelectorAll('.action-item[data-action-id]')).map((x) => x.dataset.actionId);
    const changed = before.length === after.length && before.some((id, idx) => id !== after[idx]);
    if (!changed) return;

    syncStateFromDomOrder({ notify: true });
    updateActionNumbers();
    updateCounters();
}

function deleteCueById(actionId) {
    const el = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    if (!el) return;
    if (!confirm('Удалить выбранный cue?')) return;
    const btnDelete = el.querySelector('.btn-delete');
    if (btnDelete) btnDelete.click();
}

function handleCueContextMenuAction(actionName) {
    const actionId = cueContextActionId;
    hideCueContextMenu();
    if (!actionId) return;
    switch (actionName) {
        case 'openCueOscSettings':
            openCueOscModal(actionId);
            break;
        case 'addCueNote':
            openCueNoteModal(actionId);
            break;
        case 'duplicateCue':
            duplicateCueById(actionId);
            break;
        case 'moveAfterActive':
            moveCueAfterActive(actionId);
            break;
        case 'moveCueUp':
            moveCueById(actionId, 'up');
            break;
        case 'moveCueDown':
            moveCueById(actionId, 'down');
            break;
        case 'deleteCue':
            deleteCueById(actionId);
            break;
        default:
            break;
    }
}

function initCueContextMenu() {
    const menu = document.getElementById('cueContextMenu');
    const container = document.getElementById('scenario-items');
    if (!menu || !container) return;

    container.addEventListener('contextmenu', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const actionItem = target?.closest('.action-item');
        if (!actionItem) return;
        e.preventDefault();
        showCueContextMenu(actionItem, e.clientX, e.clientY);
    });

    document.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target || !target.closest('#cueContextMenu')) {
            hideCueContextMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideCueContextMenu();
    });

    menu.querySelectorAll('.context-menu-item').forEach((item) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleCueContextMenuAction(item.getAttribute('data-action') || '');
        });
    });
}

function initCueOscModalControls() {
    const modal = document.getElementById('cueOscModal');
    if (!modal) return;

    document.getElementById('closeCueOscModal')?.addEventListener('click', closeCueOscModal);
    document.getElementById('cancelCueOscModalBtn')?.addEventListener('click', closeCueOscModal);
    document.getElementById('saveCueOscModalBtn')?.addEventListener('click', saveCueOscSettingsFromModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCueOscModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'flex') {
            closeCueOscModal();
        }
    });
}

function readOscSettingsFromUI() {
    ensureAppStateShape();
    const s = window.appState.oscSettings;

    // Обратная совместимость: если старые поля существуют в DOM, читаем их.
    const enabled = document.getElementById('oscEnabled');
    const ip = document.getElementById('oscRemoteIP');
    const port = document.getElementById('oscRemotePort');
    if (enabled) s.enabled = !!enabled.checked;
    if (ip) s.remoteIP = (ip.value || '127.0.0.1').trim() || '127.0.0.1';
    if (port) s.remotePort = Math.max(1, Math.min(65535, parseInt(port.value, 10) || 7000));

    const hasLegacyOscInputs = !!(
        document.getElementById('oscGlobalPauseAddr') ||
        document.getElementById('oscGlobalResumeAddr') ||
        document.getElementById('oscGlobalNextAddr') ||
        document.getElementById('oscGlobalShowEndAddr')
    );
    if (!hasLegacyOscInputs) {
        s.globalCommands = mergeGlobalCommands(s.globalCommands || {});
        return;
    }

    const g = s.globalCommands || (s.globalCommands = {});
    const pairs = [
        ['oscGlobalPauseAddr', 'oscGlobalPauseArgs', 'onPause'],
        ['oscGlobalResumeAddr', 'oscGlobalResumeArgs', 'onResume'],
        ['oscGlobalNextAddr', 'oscGlobalNextArgs', 'onNext'],
        ['oscGlobalShowEndAddr', 'oscGlobalShowEndArgs', 'onShowEnd']
    ];
    pairs.forEach(([addrId, argsId, key]) => {
        const aEl = document.getElementById(addrId);
        const argsEl = document.getElementById(argsId);
        const addr = aEl?.value?.trim() || '';
        const argsRaw = argsEl?.value || '';
        if (addr) {
            g[key] = { address: addr, args: parseArgsFromInput(argsRaw) };
        } else {
            g[key] = cloneCmd(DEFAULT_GLOBAL_COMMANDS[key]);
        }
    });
}

function applyOscSettingsToUI() {
    ensureAppStateShape();
    const s = window.appState.oscSettings;
    s.globalCommands = mergeGlobalCommands(s.globalCommands || {});
    const enabled = document.getElementById('oscEnabled');
    const ip = document.getElementById('oscRemoteIP');
    const port = document.getElementById('oscRemotePort');
    if (enabled) enabled.checked = !!s.enabled;
    if (ip) ip.value = s.remoteIP || '127.0.0.1';
    if (port) port.value = String(s.remotePort != null ? s.remotePort : 7000);

    const g = mergeGlobalCommands(s.globalCommands || {});
    const pairs = [
        ['oscGlobalPauseAddr', 'oscGlobalPauseArgs', 'onPause'],
        ['oscGlobalResumeAddr', 'oscGlobalResumeArgs', 'onResume'],
        ['oscGlobalNextAddr', 'oscGlobalNextArgs', 'onNext'],
        ['oscGlobalShowEndAddr', 'oscGlobalShowEndArgs', 'onShowEnd']
    ];
    pairs.forEach(([addrId, argsId, key]) => {
        const cmd = g[key];
        const aEl = document.getElementById(addrId);
        const argsEl = document.getElementById(argsId);
        if (aEl) aEl.value = cmd?.address || '';
        if (argsEl) argsEl.value = formatArgsForInput(cmd?.args);
    });
}

function buildShowDataPayload() {
    ensureAppStateShape();
    readOscSettingsFromUI();
    const titleSpan = document.getElementById('eventTitleText');
    const fromEvent = titleSpan ? titleSpan.textContent.trim() : '';
    const fromShowInput = (document.getElementById('showName')?.value || '').trim();
    const showName = fromEvent || fromShowInput || window.appState.showMeta.name || 'Без названия';
    window.appState.showMeta.name = showName;
    const showNameField = document.getElementById('showName');
    if (showNameField) showNameField.value = showName;
    const now = new Date().toISOString();
    if (!window.appState.showMeta.createdAt) window.appState.showMeta.createdAt = now;
    window.appState.showMeta.updatedAt = now;
    window.appState.showMeta.version = '1.0';

    const auto = document.getElementById('showAutoSave');
    if (auto) window.appState.showMeta.autoSaveEnabled = !!auto.checked;

    readSpeakerCustomizationFromUI();

    return {
        meta: {
            name: window.appState.showMeta.name,
            createdAt: window.appState.showMeta.createdAt,
            updatedAt: window.appState.showMeta.updatedAt,
            version: window.appState.showMeta.version,
            autoSaveEnabled: !!window.appState.showMeta.autoSaveEnabled
        },
        settings: {
            osc: {
                enabled: !!window.appState.oscSettings.enabled,
                remoteIP: window.appState.oscSettings.remoteIP,
                remotePort: window.appState.oscSettings.remotePort,
                globalCommands: JSON.parse(JSON.stringify(window.appState.oscSettings.globalCommands || {}))
            },
            speakerCustomization: mergeSpeakerCustomization(window.appState.speakerCustomization),
            techCustomization: mergeTechCustomization(window.appState.techCustomization)
        },
        actions: window.appState.actions.map((action) => ({
            id: action.id,
            title: action.title,
            durationSec: action.durationSec,
            plannedStart: action.plannedStart,
            type: action.type,
            notes: action.notes,
            completed: action.completed,
            scriptText: typeof action.scriptText === 'string' ? action.scriptText : '',
            scriptScrollPos: clampScriptScrollPos(typeof action.scriptScrollPos === 'number' ? action.scriptScrollPos : 0),
            scriptScrollTopPx: Number.isFinite(action.scriptScrollTopPx) ? Math.max(0, Number(action.scriptScrollTopPx)) : 0,
            scriptAutoSpeed: clampScriptAutoSpeed(typeof action.scriptAutoSpeed === 'number' ? action.scriptAutoSpeed : 0.05),
            scriptAutoEnabled: !!action.scriptAutoEnabled,
            scriptAutoStart: !!action.scriptAutoStart,
            osc: action.osc || { onStart: null, onEnd: null }
        })),
        state: {
            currentIndex: window.appState.currentIndex,
            startedAt: window.appState.startedAt,
            isRunning: window.appState.isRunning,
            pausedAt: window.appState.pausedAt,
            accumulatedPause: window.appState.accumulatedPause
        }
    };
}

function saveCurrentShow({ downloadFile = true } = {}) {
    const showData = buildShowDataPayload();
    const key = `show_${sanitizeShowStorageKey(showData.meta.name)}`;
    try {
        localStorage.setItem(key, JSON.stringify(showData));
    } catch (e) {
        console.error('localStorage save:', e);
        showError('Не удалось сохранить в localStorage: ' + (e.message || String(e)));
    }
    populateShowListSelect();
    if (downloadFile) {
        downloadJSON(showData, `${sanitizeShowStorageKey(showData.meta.name)}.show.json`);
    }
}

function sanitizeFileName(name) {
    return sanitizeShowStorageKey(name || 'show');
}

/**
 * Универсальное "Сохранить как...":
 * Electron -> native save dialog, Browser -> download.
 */
async function saveShowAs() {
    const showData = buildShowDataPayload();
    const defaultName = `${sanitizeFileName(showData.meta.name)}.show.json`;
    const content = JSON.stringify(showData, null, 2);
    saveCurrentShow({ downloadFile: false });

    if (window.electronAPI?.isElectron) {
        const filePath = await window.electronAPI.saveFile(content, defaultName);
        if (filePath) {
            window.appState.currentFilePath = filePath;
            showOperatorNotice(`Шоу сохранено: ${filePath}`);
            updateStatusBar();
            return true;
        }
        return false;
    }

    downloadJSON(showData, defaultName);
    showOperatorNotice(`Шоу "${showData.meta.name}" скачано`);
    updateStatusBar();
    return true;
}

/**
 * Универсальное "Сохранить":
 * Electron + known path -> save to same file, else fallback to Save As.
 */
async function saveShow() {
    if (window.electronAPI?.isElectron && window.appState.currentFilePath) {
        const showData = buildShowDataPayload();
        const content = JSON.stringify(showData, null, 2);
        const saved = await window.electronAPI.saveToPath(window.appState.currentFilePath, content);
        if (saved) {
            saveCurrentShow({ downloadFile: false });
            showOperatorNotice('Шоу сохранено');
            updateStatusBar();
            return true;
        }
    }
    return saveShowAs();
}

/**
 * Универсальное "Открыть":
 * Electron -> native open dialog, Browser -> existing file input.
 */
async function openShowFromFile() {
    if (window.electronAPI?.isElectron) {
        const result = await window.electronAPI.openFile();
        if (!result || !result.content) return false;
        try {
            const showData = JSON.parse(result.content);
            applyShowData(showData);
            window.appState.currentFilePath = result.filePath || null;
            showOperatorNotice(`Шоу "${showData.meta?.name || 'Без названия'}" открыто`);
            updateStatusBar();
            return true;
        } catch (err) {
            showError('Ошибка разбора файла: ' + (err.message || String(err)));
            return false;
        }
    }

    document.getElementById('loadShowFileInput')?.click();
    return true;
}

function exportCurrentShowAsJSON() {
    const showData = buildShowDataPayload();
    downloadJSON(showData, `${sanitizeShowStorageKey(showData.meta.name)}.show.json`);
}

function collectShowEntriesFromStorage() {
    const list = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('show_')) {
            try {
                const raw = localStorage.getItem(key);
                const data = raw ? JSON.parse(raw) : null;
                const label = data?.meta?.name || key.replace(/^show_/, '');
                list.push({ key, label });
            } catch {
                list.push({ key, label: key.replace(/^show_/, '') });
            }
        }
    }
    return list.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

function populateShowListSelect() {
    const sel = document.getElementById('showList');
    if (!sel) return;
    const entries = collectShowEntriesFromStorage();
    const current = sel.value;
    sel.innerHTML = '<option value="">Сохранённые шоу...</option>';
    entries.forEach(({ key, label }) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = label;
        sel.appendChild(opt);
    });
    if (current && Array.from(sel.options).some((o) => o.value === current)) {
        sel.value = current;
    }
}

function applyShowData(showData) {
    if (!showData || typeof showData !== 'object') return;
    ensureAppStateShape();

    const meta = showData.meta || {};
    window.appState.showMeta = {
        name: meta.name || 'Без названия',
        createdAt: meta.createdAt || null,
        updatedAt: meta.updatedAt || null,
        version: meta.version || APP_VERSION,
        autoSaveEnabled: !!meta.autoSaveEnabled
    };

    const osc = showData.settings?.osc || {};
    const rawGlobal = {
        onPause: osc.globalCommands?.onPause?.address
            ? {
                address: osc.globalCommands.onPause.address,
                args: Array.isArray(osc.globalCommands.onPause.args) ? osc.globalCommands.onPause.args.map(String) : []
            }
            : null,
        onResume: osc.globalCommands?.onResume?.address
            ? {
                address: osc.globalCommands.onResume.address,
                args: Array.isArray(osc.globalCommands.onResume.args) ? osc.globalCommands.onResume.args.map(String) : []
            }
            : null,
        onNext: osc.globalCommands?.onNext?.address
            ? {
                address: osc.globalCommands.onNext.address,
                args: Array.isArray(osc.globalCommands.onNext.args) ? osc.globalCommands.onNext.args.map(String) : []
            }
            : null,
        onShowEnd: osc.globalCommands?.onShowEnd?.address
            ? {
                address: osc.globalCommands.onShowEnd.address,
                args: Array.isArray(osc.globalCommands.onShowEnd.args) ? osc.globalCommands.onShowEnd.args.map(String) : []
            }
            : null
    };
    window.appState.oscSettings = {
        enabled: !!osc.enabled,
        remoteIP: osc.remoteIP || '127.0.0.1',
        remotePort: Number(osc.remotePort) > 0 ? Number(osc.remotePort) : 7000,
        globalCommands: mergeGlobalCommands(rawGlobal)
    };

    window.appState.speakerCustomization = mergeSpeakerCustomization(showData.settings?.speakerCustomization);
    window.appState.techCustomization = mergeTechCustomization(showData.settings?.techCustomization);
    syncSpeakerCustomizationToUI();
    applyStrictScriptVars(window.appState.speakerCustomization);
    refreshAllScriptEditorsMode();

    const rawActions = Array.isArray(showData.actions) ? showData.actions : [];
    window.appState.actions = rawActions.map(normalizeActionFromShowFile);
    rawActions.forEach((a, i) => {
        const st = window.appState.actions[i];
        if (st) syncDurationFromPlanned(st);
    });

    const st = showData.state || {};
    window.appState.currentIndex = Math.max(0, Math.min(Number(st.currentIndex) || 0, Math.max(0, window.appState.actions.length - 1)));
    window.appState.startedAt = st.startedAt != null ? st.startedAt : null;
    window.appState.isRunning = !!st.isRunning;
    window.appState.pausedAt = st.pausedAt != null ? st.pausedAt : null;
    window.appState.accumulatedPause = Number(st.accumulatedPause) || 0;

    setEventTitleUI(window.appState.showMeta.name, { persistStorage: true, syncLayout: true });
    const auto = document.getElementById('showAutoSave');
    if (auto) auto.checked = !!window.appState.showMeta.autoSaveEnabled;

    fullRerender();
    notifyStateChange();
    populateShowListSelect();
}

function loadShowFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const showData = JSON.parse(e.target.result);
            if (!confirm('Загрузить шоу из файла? Текущие несохранённые изменения будут потеряны.')) return;
            applyShowData(showData);
            window.appState.currentFilePath = null;
            updateStatusBar();
        } catch (err) {
            showError('Ошибка разбора JSON: ' + (err.message || String(err)));
        }
    };
    reader.readAsText(file);
}

function createNewShow() {
    if (!confirm('Создать новое шоу? Текущий сценарий будет очищен.')) return;
    window.appState.actions = [];
    window.appState.currentIndex = 0;
    window.appState.startedAt = null;
    window.appState.isRunning = false;
    window.appState.pausedAt = null;
    window.appState.accumulatedPause = 0;
    window.appState.showMeta = {
        name: 'Без названия',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: APP_VERSION,
        autoSaveEnabled: false
    };
    window.appState.currentFilePath = null;
    ensureAppStateShape();
    window.appState.speakerCustomization = mergeSpeakerCustomization(null);
    window.appState.techCustomization = mergeTechCustomization(null);
    syncSpeakerCustomizationToUI();
    applyStrictScriptVars(window.appState.speakerCustomization);
    refreshAllScriptEditorsMode();
    setEventTitleUI('Без названия', { persistStorage: true, syncLayout: true });
    fullRerender();
    notifyStateChange();
    populateShowListSelect();
}

function initializeShowFileControls() {
    const loadInput = document.getElementById('loadShowFileInput');
    if (loadInput) {
        loadInput.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) loadShowFromFile(f);
            loadInput.value = '';
        });
    }

    populateShowListSelect();
    applyOscSettingsToUI();
}

function getElapsedTime() {
    const st = window.appState;
    if (!st.startedAt) return 0;
    const acc = st.accumulatedPause || 0;
    if (st.pausedAt != null) {
        return st.pausedAt - st.startedAt - acc;
    }
    return Date.now() - st.startedAt - acc;
}

function pauseTimer() {
    const appState = window.appState;
    if (!appState.isRunning || appState.pausedAt != null) return;

    appState.pausedAt = Date.now();
    appState.isRunning = false;

    notifyStateChange();
    sendGlobalOsc('onPause');
}

function resumeTimer() {
    const appState = window.appState;
    if (appState.isRunning || appState.pausedAt == null) return;

    const pauseDuration = Date.now() - appState.pausedAt;

    appState.accumulatedPause += pauseDuration;
    appState.pausedAt = null;
    appState.isRunning = true;

    notifyStateChange();
    sendGlobalOsc('onResume');
}

function toggleTimerPause() {
    const st = window.appState;
    if (!st.startedAt) return;
    if (st.pausedAt != null) {
        resumeTimer();
    } else if (st.isRunning) {
        pauseTimer();
    }
}

function isTypingInFieldTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return true;
    if (target.isContentEditable) return true;
    if (target.closest('[contenteditable="true"]')) return true;
    return false;
}

function shouldIgnoreSpaceForCueNav(target) {
    if (isTypingInFieldTarget(target)) return true;
    if (target.closest('button, a[href], [role="button"], label.btn-action, input[type="file"]')) return true;
    return false;
}

function clearOperatorListFocus() {
    operatorListFocusIndex = -1;
    document.querySelectorAll('#scenario-items .action-item--focused').forEach(el => {
        el.classList.remove('action-item--focused');
    });
}

function applyOperatorListFocus(items) {
    items.forEach((el, i) => {
        el.classList.toggle('action-item--focused', i === operatorListFocusIndex && operatorListFocusIndex >= 0);
    });
}

function updateMonitorIndicators() {
    const types = ['stage', 'tech', 'speaker', 'prompter'];
    const open = window.openScreens ? window.openScreens.filter(s => s && !s.closed) : [];

    types.forEach(t => {
        const el = document.getElementById(`monitor-indicator-${t}`);
        if (!el) return;
        const isOpen = open.some(w => w && w.__operatorScreenType === t);
        el.textContent = isOpen ? '●' : '○';
        el.classList.toggle('monitor-indicator--open', isOpen);
        el.classList.toggle('monitor-indicator--closed', !isOpen);
        el.title = isOpen ? 'Экран открыт' : 'Экран закрыт';
    });

    updateStatusBar();
}

function updateOperatorStickyTop() {
    const menuBar = document.querySelector('.menu-bar');
    const eventTitle = document.querySelector('.event-title');
    const titleH = eventTitle ? eventTitle.offsetHeight : 140;
    const menuH = menuBar ? menuBar.offsetHeight : 0;
    const totalHeight = titleH + menuH;
    document.documentElement.style.setProperty('--event-title-height', `${titleH}px`);
    document.documentElement.style.setProperty('--operator-sticky-top', `${totalHeight}px`);
    const gapBelowTitle = 10;
    document.documentElement.style.setProperty(
        '--scenario-column-padding-top',
        `${titleH + gapBelowTitle}px`
    );
}

function handleOperatorHotkeys(e) {
    const key = String(e.key || '').toLowerCase();
    const isSave = (e.metaKey || e.ctrlKey) && !e.shiftKey && key === 's';
    const isSaveAs = (e.metaKey || e.ctrlKey) && e.shiftKey && key === 's';
    const isOpen = (e.metaKey || e.ctrlKey) && !e.shiftKey && key === 'o';
    const isOpenStage = (e.metaKey || e.ctrlKey) && !e.shiftKey && key === '1';
    const isOpenTech = (e.metaKey || e.ctrlKey) && !e.shiftKey && key === '2';
    const isOpenSpeaker = (e.metaKey || e.ctrlKey) && !e.shiftKey && key === '3';

    if (isSave) {
        e.preventDefault();
        void saveShow();
        return;
    }
    if (isSaveAs) {
        e.preventDefault();
        void saveShowAs();
        return;
    }
    if (isOpen) {
        e.preventDefault();
        void openShowFromFile();
        return;
    }
    if (isOpenStage) {
        e.preventDefault();
        openScreen('stage');
        return;
    }
    if (isOpenTech) {
        e.preventDefault();
        openScreen('tech');
        return;
    }
    if (isOpenSpeaker) {
        e.preventDefault();
        openScreen('speaker');
        return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const target = e.target;

    if (e.code === 'KeyP') {
        if (isTypingInFieldTarget(target)) return;
        e.preventDefault();
        toggleTimerPause();
        return;
    }

    if (e.code === 'Space') {
        if (shouldIgnoreSpaceForCueNav(target)) return;
        const items = Array.from(document.querySelectorAll('#scenario-items .action-item'));
        const ci = window.appState.currentIndex;
        const nextItem = items[ci + 1];
        if (!nextItem) return;
        e.preventDefault();
        sendGlobalOsc('onNext');
        setActiveAction(nextItem, { resetTimer: true });
        return;
    }

    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        if (isTypingInFieldTarget(target)) return;
        const items = Array.from(document.querySelectorAll('#scenario-items .action-item'));
        if (!items.length) return;
        e.preventDefault();

        const activeIdx = items.findIndex(el => el.classList.contains('active'));

        if (e.code === 'ArrowDown') {
            if (operatorListFocusIndex < 0) {
                operatorListFocusIndex = activeIdx < 0 ? 0 : Math.min(activeIdx + 1, items.length - 1);
            } else {
                operatorListFocusIndex = Math.min(operatorListFocusIndex + 1, items.length - 1);
            }
        } else {
            if (operatorListFocusIndex < 0) {
                operatorListFocusIndex = activeIdx < 0 ? 0 : Math.max(activeIdx - 1, 0);
            } else {
                operatorListFocusIndex = Math.max(operatorListFocusIndex - 1, 0);
            }
        }

        applyOperatorListFocus(items);
        const focusedEl = items[operatorListFocusIndex];
        if (focusedEl && typeof focusedEl.scrollIntoView === 'function') {
            focusedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
}

function initOperatorHotkeysAndLayout() {
    document.addEventListener('keydown', handleOperatorHotkeys);

    const scenarioItems = document.getElementById('scenario-items');
    if (scenarioItems) {
        scenarioItems.addEventListener('mousedown', () => {
            clearOperatorListFocus();
        });
    }

    updateOperatorStickyTop();
    window.addEventListener('resize', updateOperatorStickyTop);
    window.addEventListener('orientationchange', updateOperatorStickyTop);

    updateMonitorIndicators();
    setInterval(updateMonitorIndicators, 1000);
}

function formatTime(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
}

function getActionIdFromElement(el) {
    return el && el.dataset ? el.dataset.actionId : null;
}

function getTypeIcon(type) {
    switch (type) {
        case 'host': return '🎤';
        case 'tech': return '⚙️';
        default: return '🎵';
    }
}

/** Иконка типа в шапке действия; клик циклически меняет action.type в appState. */
function attachActionTypeControl(actionItem, actionId) {
    if (!actionItem || !actionId) return;

    const actionHeader = actionItem.querySelector('.action-header');
    const actionNumber = actionItem.querySelector('.action-number');
    if (!actionHeader || !actionNumber) return;
    if (actionHeader.querySelector('.action-type')) return;

    const typeIcon = document.createElement('span');
    typeIcon.className = 'action-type';
    typeIcon.setAttribute('title', 'Тип события (клик — сменить)');
    typeIcon.setAttribute('role', 'button');
    typeIcon.tabIndex = 0;
    actionHeader.insertBefore(typeIcon, actionNumber);

    const refreshIcon = () => {
        const action = window.appState.actions.find(a => a.id === actionId);
        const t = action?.type || ACTION_TYPES.PERFORMANCE;
        typeIcon.textContent = getTypeIcon(t);
    };

    typeIcon.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    typeIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = window.appState.actions.find(a => a.id === actionId);
        if (!action) return;

        const types = [ACTION_TYPES.PERFORMANCE, ACTION_TYPES.HOST, ACTION_TYPES.TECH];
        const currentIndex = types.indexOf(action.type);
        const nextType = types[(currentIndex + 1) % types.length];

        action.type = nextType;
        typeIcon.textContent = getTypeIcon(nextType);

        notifyStateChange();
    });

    typeIcon.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            typeIcon.click();
        }
    });

    refreshIcon();
    requestAnimationFrame(refreshIcon);
}

function wireGoDoneForActionItem(actionItem, actionId) {
    const controls = actionItem.querySelector('.action-controls');
    if (!controls) return;

    const oldPlay = actionItem.querySelector('.btn-play');
    if (oldPlay) oldPlay.remove();
    const btnMoveUp = actionItem.querySelector('.btn-move-up');
    const btnMoveDown = actionItem.querySelector('.btn-move-down');

    const btnGo = document.createElement('button');
    btnGo.type = 'button';
    btnGo.className = 'btn-go';
    btnGo.textContent = '▶';
    btnGo.setAttribute('aria-label', 'Старт');
    btnGo.title = 'Активировать этот cue в эфир. Горячая клавиша: Space — следующее событие в списке';

    const btnDone = document.createElement('button');
    btnDone.type = 'button';
    btnDone.className = 'btn-done';
    btnDone.textContent = '✓';
    btnDone.setAttribute('aria-label', 'Готово');
    btnDone.title = 'Отметить выполненным; на текущем в эфире cue отправляет OSC onEnd (и на последнем — конец шоу)';

    controls.appendChild(btnGo);
    controls.appendChild(btnDone);

    btnGo.addEventListener('mousedown', (e) => e.stopPropagation());
    btnDone.addEventListener('mousedown', (e) => e.stopPropagation());
    btnMoveUp?.addEventListener('mousedown', (e) => e.stopPropagation());
    btnMoveDown?.addEventListener('mousedown', (e) => e.stopPropagation());
    btnMoveUp?.addEventListener('click', (e) => {
        e.stopPropagation();
        moveCueById(actionId, 'up');
    });
    btnMoveDown?.addEventListener('click', (e) => {
        e.stopPropagation();
        moveCueById(actionId, 'down');
    });

    btnGo.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveAction(actionItem, { resetTimer: true });
    });

    btnDone.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = window.appState.actions.find(a => a.id === actionId);
        if (!action) return;
        const wasCompleted = !!action.completed;
        action.completed = !action.completed;
        if (action.completed && !wasCompleted) {
            applyDoneOscAndMaybeFinishShow(actionItem, actionId);
        }
        actionItem.classList.toggle('completed', !!action.completed);
        notifyStateChange();
        updateCounters();
    });

    const btnScript = document.createElement('button');
    btnScript.type = 'button';
    btnScript.className = 'btn-script';
    btnScript.innerHTML = '<i class="fas fa-scroll" aria-hidden="true"></i>';
    btnScript.title = 'Текст сценария (суфлер)';
    btnScript.setAttribute('aria-label', 'Суфлер');
    controls.appendChild(btnScript);

    btnScript.addEventListener('mousedown', (e) => e.stopPropagation());
    btnScript.addEventListener('click', (e) => {
        e.stopPropagation();
        const scriptWrap = actionItem.querySelector('.action-script');
        const textarea = actionItem.querySelector('.script-textarea');
        if (!scriptWrap || !textarea) return;
        const showing = scriptWrap.style.display !== 'none' && scriptWrap.style.display !== '';
        scriptWrap.style.display = showing ? 'none' : 'block';
        actionItem.classList.toggle('action-item--script-open', !showing);
        if (!showing) textarea.focus();
    });

    wireScriptControls(actionItem, actionId);

    requestAnimationFrame(() => {
        const action = window.appState.actions.find(a => a.id === actionId);
        if (action && action.completed) {
            actionItem.classList.add('completed');
        }
    });
}

/**
 * Длительность слота из строки времени действия (колонка времени / .time-display).
 * Поддержка: "10" → 10 мин; "10:00" → 10 мин 0 сек; "1:30:00" → 1 ч.
 * Пусто / неразборчиво → null (на экранах fallback 600 сек).
 */
function parseDurationSecondsFromPlanned(str) {
    if (str == null) return null;
    const s = String(str).trim();
    if (!s) return null;
    const parts = s.split(':').map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length === 0) return null;
    const nums = parts.map(p => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) && n >= 0 ? n : NaN;
    });
    if (nums.some(n => Number.isNaN(n))) return null;
    if (nums.length === 1) return nums[0] * 60;
    if (nums.length === 2) return nums[0] * 60 + nums[1];
    if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
    return null;
}

/**
 * Нормализация быстрого ввода времени:
 * - HH:MM / HH:MM:SS -> HH:MM:SS
 * - Xm (например, 5m, 90m) -> минуты -> HH:MM:SS
 * - только цифры (например, 30, 3665) -> секунды -> HH:MM:SS
 * - пусто / невалидно -> null
 */
function normalizePlannedStartInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;

    const formatSecondsToHms = (totalSec) => {
        if (!Number.isFinite(totalSec) || totalSec < 0) return null;
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const sec = totalSec % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };

    const hms = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hms) {
        const hh = Number(hms[1]);
        const mm = Number(hms[2]);
        const ss = Number(hms[3] || '0');
        if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return null;
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }

    const minutes = s.match(/^(\d+)m$/i);
    if (minutes) {
        const mins = Number(minutes[1]);
        if (!Number.isFinite(mins)) return null;
        return formatSecondsToHms(mins * 60);
    }

    const seconds = s.match(/^(\d+)$/);
    if (seconds) {
        const sec = Number(seconds[1]);
        if (!Number.isFinite(sec)) return null;
        return formatSecondsToHms(sec);
    }

    return null;
}

function setInlineTimeDisplay(timeDisplay, plannedStart) {
    if (!timeDisplay) return;
    const normalized = normalizePlannedStartInput(plannedStart);
    timeDisplay.dataset.plannedStart = normalized || '';
    timeDisplay.textContent = normalized || '--:--';
}

function syncDurationFromPlanned(st) {
    if (!st) return;
    const parsed = parseDurationSecondsFromPlanned(st.plannedStart);
    st.durationSec = parsed != null && parsed > 0 ? parsed : null;
}

function getDurationSecFromAction(action) {
    if (!action) return 600;
    const parsed = parseDurationSecondsFromPlanned(action.plannedStart);
    if (parsed != null && parsed > 0) return parsed;
    if (typeof action.durationSec === 'number' && action.durationSec > 0) return action.durationSec;
    return 600;
}

function getTypeLabelRu(type) {
    switch (type) {
        case 'host': return 'Ведущий';
        case 'tech': return 'Техника';
        default: return 'Номер';
    }
}

function formatDurationClock(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

function renderOperatorCueBar() {
    const nowBody = document.getElementById('operator-card-now-body');
    const nextBody = document.getElementById('operator-card-next-body');
    if (!nowBody || !nextBody) return;

    const state = window.appState;
    const actions = state.actions;
    const cur = actions[state.currentIndex];
    const next = actions[state.currentIndex + 1];

    nowBody.textContent = '';
    nextBody.textContent = '';

    if (!cur) {
        const p = document.createElement('p');
        p.className = 'operator-cue-empty';
        p.textContent = '—';
        nowBody.appendChild(p);
    } else {
        const title = document.createElement('div');
        title.className = 'operator-cue-title';
        title.textContent = `${getTypeIcon(cur.type)} ${cur.title || 'Без названия'}`.trim();

        const meta = document.createElement('div');
        meta.className = 'operator-cue-meta';
        const durSec = getDurationSecFromAction(cur);
        meta.textContent = `${getTypeLabelRu(cur.type)} · ${formatDurationClock(durSec)}`;

        nowBody.appendChild(title);
        nowBody.appendChild(meta);
    }

    if (!next) {
        const p = document.createElement('p');
        p.className = 'operator-cue-empty';
        p.textContent = 'Нет';
        nextBody.appendChild(p);
    } else {
        const title = document.createElement('div');
        title.className = 'operator-cue-title';
        title.textContent = `${getTypeIcon(next.type)} ${next.title || 'Без названия'}`.trim();

        const meta = document.createElement('div');
        meta.className = 'operator-cue-meta';
        const durSec = getDurationSecFromAction(next);
        meta.textContent = `${getTypeLabelRu(next.type)} · ${formatDurationClock(durSec)}`;

        nextBody.appendChild(title);
        nextBody.appendChild(meta);
    }
}

function renderOperatorTimer() {
    const timesEl = document.getElementById('operatorTimerDisplay');
    const statusEl = document.getElementById('operatorTimerStatus');
    if (!timesEl || !statusEl) return;

    const state = window.appState;
    const current = state.actions[state.currentIndex];

    if (!current || !state.startedAt) {
        timesEl.textContent = '00:00 / 00:00';
        statusEl.textContent = '● ГОТОВ';
        statusEl.className = 'timer-status-compact --ready timer-status-compact--ready';
        updateTimerPlayPauseButton();
        return;
    }

    const durationSec = getDurationSecFromAction(current);
    const elapsedMs = getElapsedTime();
    const elapsedSec = Math.floor(elapsedMs / 1000);

    timesEl.textContent = `${formatDurationClock(elapsedSec)} / ${formatDurationClock(durationSec)}`;
    if (state.isRunning) {
        statusEl.textContent = '● РАБОТА';
        statusEl.className = 'timer-status-compact --run timer-status-compact--run';
    } else if (state.pausedAt) {
        statusEl.textContent = '❚❚ ПАУЗА';
        statusEl.className = 'timer-status-compact --paused timer-status-compact--paused';
    } else {
        statusEl.textContent = '● ГОТОВ';
        statusEl.className = 'timer-status-compact --ready';
    }
    updateTimerPlayPauseButton();
}

function updateTimerPlayPauseButton() {
    const btn = document.getElementById('timerPlayPauseBtn');
    if (!btn) return;
    const iconSpan = btn.querySelector('.timer-icon');
    if (!iconSpan) return;

    const state = window.appState;
    const current = state.actions[state.currentIndex] || null;
    const hasActiveCue = !!current && !!state.startedAt;

    if (!hasActiveCue) {
        btn.classList.add('disabled');
        iconSpan.textContent = '⏹️';
        btn.title = 'Нет активного cue';
        return;
    }

    btn.classList.remove('disabled');
    if (state.isRunning) {
        iconSpan.textContent = '⏸️';
        btn.title = 'Пауза';
    } else {
        iconSpan.textContent = '▶️';
        btn.title = 'Продолжить';
    }
}

function initTimerPlayPauseButton() {
    const oldBtn = document.getElementById('timerPlayPauseBtn');
    if (!oldBtn || !oldBtn.parentNode) return;
    const btn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(btn, oldBtn);
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const state = window.appState;
        const hasActiveCue = !!state.actions[state.currentIndex] && !!state.startedAt;
        if (!hasActiveCue) return;
        if (state.isRunning) pauseTimer();
        else resumeTimer();
    });
    updateTimerPlayPauseButton();
}

/**
 * Синхронизирует классы .active / .next в списке с appState.currentIndex (по id действий).
 */
function updateActionItemsVisualState() {
    const appState = window.appState;
    const actions = appState.actions;
    const n = actions.length;
    const currentIdx = appState.currentIndex;

    const currentId = n > 0 && currentIdx >= 0 && currentIdx < n ? actions[currentIdx].id : null;
    const nextId = currentIdx + 1 < n ? actions[currentIdx + 1].id : null;

    document.querySelectorAll('#scenario-items .action-item').forEach(item => {
        item.classList.remove('active', 'next');
        const id = getActionIdFromElement(item);
        if (currentId && id === currentId) {
            item.classList.add('active');
        }
        if (nextId && id === nextId) {
            item.classList.add('next');
        }
    });
}

/** Короткая анимация красной полосы при активации нового cue (setActiveAction с resetTimer). */
function flashActiveCueHighlight() {
    const el = document.querySelector('#scenario-items .action-item.active');
    if (!el) return;
    el.classList.remove('action-item--cue-flash');
    // Перезапуск анимации при повторной активации
    void el.offsetWidth;
    el.classList.add('action-item--cue-flash');
    setTimeout(() => {
        el.classList.remove('action-item--cue-flash');
    }, 220);
}


function normalizeExcelPlannedStart(raw) {
    if (raw == null) return '';
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const parsed = XLSX.SSF?.parse_date_code?.(raw);
        if (parsed && Number.isFinite(parsed.H) && Number.isFinite(parsed.M)) {
            const hh = String(parsed.H).padStart(2, '0');
            const mm = String(parsed.M).padStart(2, '0');
            return `${hh}:${mm}`;
        }
        return '';
    }
    const text = String(raw).trim();
    if (!text) return '';
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return text;
    const parsedDate = new Date(text);
    if (!Number.isNaN(parsedDate.getTime())) {
        const hh = String(parsedDate.getHours()).padStart(2, '0');
        const mm = String(parsedDate.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }
    return '';
}

// Обработчик загрузки файла
document.getElementById('file-input').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (file) {
        console.log('Файл выбран:', file.name); // Отладочная информация
        const loadingIndicator = document.getElementById('loading-indicator');
        loadingIndicator.style.display = 'flex';

        try {
            const arrayBuffer = await file.arrayBuffer();
            console.log('Файл прочитан, размер:', arrayBuffer.byteLength); // Отладочная информация
            
            const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            console.log('Данные из Excel:', jsonData); // Отладочная информация

            // Очищаем существующие действия
            const scenarioItems = document.getElementById('scenario-items');
            scenarioItems.innerHTML = '';

            // Сбрасываем multi-screen state
            window.appState.actions = [];
            window.appState.currentIndex = 0;
            window.appState.startedAt = null;
            window.appState.isRunning = false;
            window.appState.pausedAt = null;
            window.appState.accumulatedPause = 0;

            ensureAppStateShape();
            window.appState.showMeta.name = file.name.replace(/\.[^.]+$/, '') || 'Импорт Excel';
            window.appState.showMeta.updatedAt = new Date().toISOString();
            setEventTitleUI(window.appState.showMeta.name, { persistStorage: true, syncLayout: true });

            // Пропускаем первую строку (заголовки) и обрабатываем данные
            let importedCount = 0;
            jsonData.slice(1).forEach((row) => {
                if (Array.isArray(row) && row.length > 0) {
                    const actionId = generateId('action');
                    const title = String(row[0] ?? '').trim();
                    if (!title) return;
                    const plannedStartRaw = normalizeExcelPlannedStart(row[1]);
                    const actionItem = createActionItem(title, plannedStartRaw, importedCount + 1, actionId);
                    if (!actionItem) return;
                    scenarioItems.appendChild(actionItem);
                    importedCount += 1;
                }
            });

            // Добавляем финальное действие
            const finalAction = new FinalAction();
            const finalId = generateId('action');
            const finalElement = finalAction.create(finalId);
            if (finalElement) {
                scenarioItems.appendChild(finalElement);
            }

            // Обновляем счетчики
            updateCounters();

            // Переинициализируем Sortable
            initializeSortable();

            // Синхронизируем состояние по фактическому DOM-порядку (на случай финального action)
            syncStateFromDomOrder({ notify: true });

            console.log('Загрузка завершена успешно:', importedCount); // Отладочная информация
        } catch (error) {
            console.error('Ошибка при обработке файла:', error); // Отладочная информация
            showError('Ошибка при чтении файла: ' + error.message);
        } finally {
            loadingIndicator.style.display = 'none';
            e.target.value = '';
        }
    }
});

// Функция создания элемента действия
function createActionItem(text, time, number, actionId) {
    const template = document.querySelector('.action-item-template');
    if (!template) {
        console.error('Не найден шаблон action-item-template');
        return null;
    }
    
    const actionItem = template.cloneNode(true);
    actionItem.classList.remove('action-item-template');
    actionItem.classList.add('action-item');
    actionItem.style.display = 'flex';
    
    const actionNumber = actionItem.querySelector('.action-number');
    const actionHeader = actionItem.querySelector('.action-header');
    const actionText = actionItem.querySelector('.action-text');
    const timeDisplay = actionItem.querySelector('.time-display');
    const noteSummary = actionItem.querySelector('.action-note-summary');
    const noteDropdown = actionItem.querySelector('.action-notes-dropdown');
    
    actionNumber.textContent = `#${number}`;
    if (actionHeader) actionHeader.classList.add('drag-handle');
    actionText.textContent = text || '';
    setInlineTimeDisplay(timeDisplay, time || '');
    timeDisplay.contentEditable = 'false';
    if (noteSummary) {
        noteSummary.textContent = '';
        noteSummary.style.display = 'none';
        noteSummary.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleActionNoteDropdown(actionItem);
        });
    }
    if (noteDropdown) {
        noteDropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    if (actionId) {
        actionItem.dataset.actionId = actionId;
    }

    // Синхронизация редактируемых полей с state (для корректного рендера экранов).
    if (actionId) {
        actionText.addEventListener('blur', () => {
            const st = window.appState.actions.find(a => a.id === actionId);
            if (st) {
                st.title = actionText.textContent?.trim() || '';
                notifyStateChange();
            }
        });

        const finishTimeEdit = () => {
            if (timeDisplay.dataset.editing !== '1') return;
            const st = window.appState.actions.find(a => a.id === actionId);
            if (!st) return;
            const raw = timeDisplay.textContent?.trim() || '';
            const prev = normalizePlannedStartInput(st.plannedStart);
            const next = raw ? normalizePlannedStartInput(raw) : null;
            timeDisplay.dataset.editing = '0';
            timeDisplay.classList.remove('is-editing');
            timeDisplay.contentEditable = 'false';
            if (raw && !next) {
                setInlineTimeDisplay(timeDisplay, prev);
                return;
            }
            st.plannedStart = next;
            syncDurationFromPlanned(st);
            setInlineTimeDisplay(timeDisplay, st.plannedStart);
            syncStateFromDomOrder({ notify: true });
        };

        timeDisplay.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (timeDisplay.dataset.editing === '1') return;
            const st = window.appState.actions.find(a => a.id === actionId);
            const current = normalizePlannedStartInput(st?.plannedStart);
            timeDisplay.dataset.editing = '1';
            timeDisplay.classList.add('is-editing');
            timeDisplay.contentEditable = 'true';
            timeDisplay.textContent = current || '';
            timeDisplay.focus();
            const sel = window.getSelection && window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(timeDisplay);
            range.collapse(false);
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });
        timeDisplay.addEventListener('keydown', (e) => {
            if (timeDisplay.dataset.editing !== '1') return;
            if (e.key === 'Enter') {
                e.preventDefault();
                finishTimeEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const st = window.appState.actions.find(a => a.id === actionId);
                setInlineTimeDisplay(timeDisplay, st?.plannedStart || '');
                timeDisplay.dataset.editing = '0';
                timeDisplay.classList.remove('is-editing');
                timeDisplay.contentEditable = 'false';
            }
        });
        timeDisplay.addEventListener('blur', finishTimeEdit);
    }
    
    const btnDelete = actionItem.querySelector('.btn-delete');

    btnDelete.addEventListener('click', function(e) {
        e.stopPropagation();
        const wasActive = actionItem.classList.contains('active');
        const nextCandidate = actionItem.nextElementSibling?.classList?.contains('action-item')
            ? actionItem.nextElementSibling
            : null;
        const prevCandidate = actionItem.previousElementSibling?.classList?.contains('action-item')
            ? actionItem.previousElementSibling
            : null;
        actionItem.remove();

        if (wasActive) {
            const newActive = nextCandidate || prevCandidate;
            if (newActive && newActive.isConnected) {
                newActive.classList.add('active');
            }
        }

        updateActionNumbers(); // Обновляем номера после удаления
        updateCounters();

        syncStateFromDomOrder({ notify: true });
    });

    if (actionId) {
        attachActionTypeControl(actionItem, actionId);
        wireGoDoneForActionItem(actionItem, actionId);
        queueMicrotask(() => attachOscDetailsToActionItem(actionItem, actionId));
    }

    return actionItem;
}

// Функция установки активного действия
/** Сохранено для совместимости вызовов; логика — в updateActionItemsVisualState. */
function updateNextAction() {
    updateActionItemsVisualState();
}

// Функция обновления счетчиков
function updateCounters() {
    const totalActions = document.querySelectorAll('.action-item').length;
    const completedActions = document.querySelectorAll('.action-item.completed').length;
    
    document.getElementById('actions-count').textContent = totalActions;
    document.getElementById('completed-count').textContent = completedActions;
    
    console.log('Счетчики обновлены:', { total: totalActions, completed: completedActions }); // Отладочная информация
}

// Функция отображения ошибки
function showError(message) {
    console.error('Ошибка:', message); // Отладочная информация
    const errorMessage = document.getElementById('error-message');
    const errorText = errorMessage.querySelector('.error-text');
    errorText.textContent = message;
    errorMessage.style.display = 'flex';
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 3000);
}

function showToast(message, type = 'info', durationMs = 4000) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.position = 'fixed';
        container.style.right = '16px';
        container.style.bottom = '16px';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '8px';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.minWidth = '260px';
    toast.style.maxWidth = '420px';
    toast.style.padding = '10px 12px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '14px';
    toast.style.color = '#fff';
    toast.style.background = type === 'error' ? 'rgba(185, 28, 28, 0.95)' : 'rgba(31, 41, 55, 0.95)';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.28)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        setTimeout(() => {
            toast.remove();
            if (!container.childElementCount) container.remove();
        }, 220);
    }, durationMs);
}

function openScreen(type) {
    const screen = window.open(`/screen.html?type=${encodeURIComponent(type)}`, `Screen_${type}`);

    if (screen) {
        const cleanupClosedScreens = () => {
            window.openScreens = (window.openScreens || []).filter((s) => s && !s.closed);
            updateMonitorIndicators();
            updateStatusBar();
        };

        screen.__operatorScreenType = type;

        if (!window.openScreens.includes(screen)) {
            window.openScreens.push(screen);
        }

        try {
            screen.addEventListener('pagehide', () => {
                setTimeout(updateMonitorIndicators, 0);
            });
            screen.addEventListener('beforeunload', cleanupClosedScreens);
        } catch (err) {
            // ignore
        }

        const closedWatcher = window.setInterval(() => {
            if (screen.closed) {
                window.clearInterval(closedWatcher);
                cleanupClosedScreens();
            }
        }, 1000);

        setTimeout(() => {
            try {
                screen.postMessage({
                    type: SCREEN_MESSAGE_TYPES.INIT_STATE,
                    payload: window.appState
                }, '*');
                screen.postMessage({
                    type: SCREEN_MESSAGE_TYPES.APPLY_THEME,
                    theme: window.appState?.uiTheme || localStorage.getItem(APP_THEME_STORAGE_KEY) || 'dark'
                }, '*');
            } catch (e) {
                // ignore
            }
        }, 500);

        updateMonitorIndicators();
        updateStatusBar();
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('Страница загружена, проверка Sortable...');
    
    // Проверяем доступность Sortable
    if (typeof Sortable === 'undefined') {
        console.error('Библиотека Sortable не загружена!');
        return;
    }
    
    console.log('Библиотека Sortable доступна, версия:', Sortable.version);
    ensureAppStateShape();
    applyStrictScriptVars(mergeSpeakerCustomization(window.appState.speakerCustomization));
    loadThemePreference();
    initEventTitleEditor();
    syncSpeakerCustomizationToUI();
    initSpeakerCustomizationControls();
    initSpeakerCustomizationModal();
    initTechCustomizationModal();
    initOscModalControls();
    initCueOscModalControls();
    initCueNoteModalControls();
    initCueContextMenu();
    initHelpModals();
    initTimerPlayPauseButton();
    initializeSortable();
    initializeNoteCreator();
    initializeActionButtons();
    initializeShowFileControls();
    initOperatorHotkeysAndLayout();
    initMenuBar();
    updateStatusBar();
    document.addEventListener('click', () => hideAllActionNoteDropdowns());

    renderOperatorTimer();
    renderOperatorCueBar();
    updateActionItemsVisualState();
    setInterval(renderOperatorTimer, 500);

    try {
        const storedOsc = localStorage.getItem('oscSettings');
        if (storedOsc) {
            const parsed = JSON.parse(storedOsc);
            if (parsed && typeof parsed === 'object') {
                window.appState.oscSettings = {
                    enabled: !!parsed.enabled,
                    remoteIP: parsed.remoteIP || '127.0.0.1',
                    remotePort: Number(parsed.remotePort) > 0 ? Number(parsed.remotePort) : 7000,
                    globalCommands: mergeGlobalCommands(parsed.globalCommands || {})
                };
                notifyStateChange();
            }
        }
    } catch (e) {
        console.warn('oscSettings load:', e);
    }
});

// Глобальный обработчик для предотвращения нежелательного перетаскивания
document.addEventListener('dragstart', function(e) {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) {
        return;
    }

    // Разрешаем перетаскивание нового примечания из note-creator
    if (target.closest('.draggable-note')) {
        document.body.classList.add('dragging-note');
        return;
    }

    // Для всех остальных элементов отменяем встроенное перетаскивание
    if (!target.closest('.action-content')) {
        e.preventDefault();
    }
}, true);

// Обработчики для кнопок добавления примечания и действия
function initializeActionButtons() {
    // Старые раздельные кнопки паузы/продолжить удалены — используется единая timerPlayPauseBtn.
}

function initializeNoteCreator() {
    const noteCreator = document.getElementById('note-creator');
    const btnCloseNote = noteCreator.querySelector('.btn-close-note');
    const noteContent = noteCreator.querySelector('.draggable-note');
    noteContent.setAttribute('draggable', 'true');

    // Закрытие окна создания примечания
    btnCloseNote.addEventListener('click', () => {
        noteCreator.style.display = 'none';
        noteContent.textContent = '';
    });

    // Делаем примечание перетаскиваемым
    noteContent.addEventListener('dragstart', function(e) {
        const noteText = this.textContent.trim();
        if (!noteText) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/plain', noteText);
        e.dataTransfer.setData('application/x-note-type', 'new');
        e.dataTransfer.effectAllowed = 'copy';
        document.body.classList.add('dragging-note');
    });

    noteContent.addEventListener('dragend', function() {
        document.body.classList.remove('dragging-note');
    });

    // Обработка перетаскивания примечания
    document.addEventListener('dragover', function(e) {
        e.preventDefault();
        const actionItem = e.target.closest('.action-item');
        if (actionItem) {
            actionItem.classList.add('drag-over');
        }
    });

    document.addEventListener('dragleave', function(e) {
        const actionItem = e.target.closest('.action-item');
        if (actionItem) {
            actionItem.classList.remove('drag-over');
        }
    });

    document.addEventListener('drop', function(e) {
        if (!document.body.classList.contains('dragging-note')) {
            return;
        }

        e.preventDefault();
        const actionItem = e.target.closest('.action-item');
        if (actionItem) {
            actionItem.classList.remove('drag-over');
            const noteText = e.dataTransfer.getData('text/plain').trim();
            if (noteText) {
                addNoteToAction(actionItem, noteText);
                noteCreator.style.display = 'none';
                noteContent.textContent = '';
            }
        }

        document.body.classList.remove('dragging-note');
    });
}

function toggleNoteCreator() {
    const noteCreator = document.getElementById('note-creator');
    noteCreator.style.display = noteCreator.style.display === 'none' ? 'flex' : 'none';
    if (noteCreator.style.display === 'flex') {
        noteCreator.querySelector('.draggable-note').focus();
    }
}

function addNoteToAction(actionItem, noteText) {
    const notesContainer = actionItem.querySelector('.action-notes');
    const noteElement = document.createElement('div');
    noteElement.className = 'note';
    noteElement.contentEditable = true;
    noteElement.textContent = noteText;
    notesContainer.appendChild(noteElement);

    const actionId = getActionIdFromElement(actionItem);
    const actionState = window.appState.actions.find(a => a.id === actionId);
    if (actionState) {
        const noteId = generateId('note');
        noteElement.dataset.noteId = noteId;
        actionState.notes.push({ id: noteId, text: noteText });

        // Сохраняем изменения примечания после редактирования
        noteElement.addEventListener('blur', () => {
            const currentText = noteElement.textContent?.trim() || '';
            const note = actionState.notes.find(n => n.id === noteId);
            if (note) {
                note.text = currentText;
            }
            if (!currentText) {
                actionState.notes = actionState.notes.filter(n => n.id !== noteId);
                noteElement.remove();
            }
            updateActionNoteSummary(actionItem, actionState);
            renderActionNotesDropdown(actionItem, actionState);
            notifyStateChange();
        });
        updateActionNoteSummary(actionItem, actionState);
        renderActionNotesDropdown(actionItem, actionState);
    }

    notifyStateChange();
}

function addNewAction() {
    const scenarioItems = document.getElementById('scenario-items');
    const currentActions = scenarioItems.querySelectorAll('.action-item');
    const newNumber = currentActions.length + 1;

    const actionId = generateId('action');
    const actionItem = createActionItem('Новое действие', '', newNumber, actionId);
    scenarioItems.appendChild(actionItem);

    updateActionNumbers();
    // Не вызываем setActiveAction: текущий cue в эфире не меняется, currentIndex сохраняется через sync (ищет .active в DOM).
    syncStateFromDomOrder({ notify: true });
    updateCounters();

    const actionText = actionItem.querySelector('.action-text');
    actionText.focus();
    actionItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Функция инициализации сортировки
function initializeSortable() {
    // Drag-and-drop временно отключен: основной способ reorder — кнопки ↑/↓ и контекстное меню.
    return;
    const scenarioItems = document.getElementById('scenario-items');
    
    if (!scenarioItems) {
        console.error('Не найден элемент scenario-items');
        return;
    }
    
    // Удаляем предыдущий экземпляр, если есть
    if (window.sortableInstance) {
        window.sortableInstance.destroy();
    }
    
    try {
        const SortableCtor = window.Sortable || (typeof Sortable !== 'undefined' ? Sortable : null);
        if (!SortableCtor) {
            console.error('Sortable не найден в глобальной области видимости');
            return;
        }

        const getDomOrder = () =>
            Array.from(scenarioItems.querySelectorAll('.action-item[data-action-id]'))
                .map((el) => el.dataset.actionId)
                .filter(Boolean);

        let oldOrder = [];
        let reorderFinalized = false;

        const finalizeReorder = (evt) => {
            if (reorderFinalized) return;
            reorderFinalized = true;

            const newOrder = getDomOrder();
            const changed = oldOrder.length !== newOrder.length || oldOrder.some((id, idx) => id !== newOrder[idx]);
            if (!changed) {
                if (evt.item?.dataset) delete evt.item.dataset.wasActive;
                return;
            }

            updateActionNumbers();
            if (evt.item?.dataset?.wasActive === 'true') {
                setActiveAction(evt.item, { resetTimer: false, notifyState: false });
            }
            if (evt.item?.dataset) delete evt.item.dataset.wasActive;
            updateCounters();
            syncStateFromDomOrder({ notify: true });
        };

        window.sortableInstance = new SortableCtor(scenarioItems, {
            group: 'scenario-items',
            animation: 150,
            handle: '.drag-handle',
            draggable: '.action-item',
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            scroll: true,
            bubbleScroll: true,
            onStart: function(evt) {
                oldOrder = getDomOrder();
                reorderFinalized = false;
                evt.item.dataset.wasActive = evt.item.classList.contains('active');
                document.body.classList.add('dragging-action');
                evt.item.classList.add('dragging');
            },
            onEnd: function(evt) {
                document.body.classList.remove('dragging-action');
                evt.item.classList.remove('dragging');
                finalizeReorder(evt);
            },
            onMove: function(evt) {
                if (!evt.related) return true;
                return true;
            }
        });
        
        console.log('Sortable успешно инициализирован');
    } catch (error) {
        console.error('Ошибка при инициализации Sortable:', error);
    }
}

// Функция обновления номеров действий
function updateActionNumbers() {
    const actions = Array.from(document.querySelectorAll('#scenario-items .action-item'));
    
    actions.forEach((action, index) => {
        const numberElement = action.querySelector('.action-number');
        if (numberElement) {
            numberElement.textContent = `#${index + 1}`;
        }
    });
    
    console.log('Номера обновлены для', actions.length, 'действий');
}

window.sendOSC = sendOSC;
window.testOSCConnection = testOSCConnection;
window.syncScriptToState = syncScriptToState;
window.wireGoDoneForActionItem = wireGoDoneForActionItem;
window.createActionItem = createActionItem;

let speakerScrollSyncNotifyTimer = null;
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== SCREEN_MESSAGE_TYPES.SPEAKER_SCROLL_SYNC) return;
    const actionId = msg.actionId;
    const p = clampScriptScrollPos(msg.scrollPercent);
    const strict = msg.mode === 'strict';
    const scrollTopPx = Number.isFinite(msg.scrollTopPx) ? Math.max(0, Number(msg.scrollTopPx)) : 0;
    if (!actionId) return;
    const st = window.appState.actions.find((a) => a.id === actionId);
    if (st) {
        st.scriptScrollPos = p;
        if (strict) st.scriptScrollTopPx = scrollTopPx;
    }
    const item = document.querySelector(`#scenario-items .action-item[data-action-id="${actionId}"]`);
    const ta = item && item.querySelector('textarea.script-textarea');
    const strictEditor = item && item.querySelector('.script-editor-strict');
    if (ta || strictEditor) {
        if (ta) ta.dataset._scriptScrollIgnore = '1';
        if (strictEditor) strictEditor.dataset._scriptScrollIgnore = '1';
        if (strict && strictEditor) {
            strictEditor.scrollTop = scrollTopPx;
            if (ta) setScrollPercent(ta, p);
        } else if (ta) {
            setScrollPercent(ta, p);
            if (strictEditor) strictEditor.scrollTop = (st?.scriptScrollTopPx ?? 0);
        }
        requestAnimationFrame(() => {
            if (ta) ta.dataset._scriptScrollIgnore = '0';
            if (strictEditor) strictEditor.dataset._scriptScrollIgnore = '0';
        });
    }
    if (speakerScrollSyncNotifyTimer) clearTimeout(speakerScrollSyncNotifyTimer);
    speakerScrollSyncNotifyTimer = setTimeout(() => {
        speakerScrollSyncNotifyTimer = null;
        notifyStateChange();
    }, 450);
});

let strictResizeDebounce = null;
window.addEventListener('resize', () => {
    if (!isStrictScriptSyncEnabled()) return;
    if (strictResizeDebounce) clearTimeout(strictResizeDebounce);
    strictResizeDebounce = setTimeout(() => {
        strictResizeDebounce = null;
        document.querySelectorAll('#scenario-items .action-item[data-action-id]').forEach((item) => {
            const actionId = item.dataset.actionId;
            if (!actionId) return;
            const st = window.appState.actions.find((a) => a.id === actionId);
            const strictEditor = item.querySelector('.script-editor-strict');
            if (!st || !strictEditor) return;
            const max = Math.max(0, strictEditor.scrollHeight - strictEditor.clientHeight);
            const p = max <= 0 ? 0 : clampScriptScrollPos((strictEditor.scrollTop || 0) / max);
            st.scriptScrollPos = p;
            st.scriptScrollTopPx = p * max;
            strictEditor.scrollTop = st.scriptScrollTopPx;
        });
        notifyStateChange();
    }, 120);
});

(function logOscDiagnosticsOnLoad() {
    if (typeof window === 'undefined') return;
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 OSC диагностика');
    console.log('   Сервер (origin):', window.location.origin);
    console.log('   OSC настройки:', window.appState && window.appState.oscSettings);
    console.log('   sendOSC:', typeof sendOSC, '| testOSCConnection:', typeof testOSCConnection);
    console.log('   Подробные логи sendOSC: localStorage OSC_DEBUG=1 или ?oscdebug=1');
    console.log('   Подробные логи сервера: OSC_DEBUG=1 npm start');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
})(); 