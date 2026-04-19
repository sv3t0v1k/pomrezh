import {
    ACTION_TYPES,
    APP_VERSION,
    SCREEN_MESSAGE_TYPES,
    THEMES
} from './constants.js';

/**
 * @typedef {{id: string, text: string}} Note
 * @typedef {{address: string, args: string[]}} OscCommand
 * @typedef {{onStart: OscCommand|null, onEnd: OscCommand|null}} CueOsc
 * @typedef {{
 *   id: string,
 *   title: string,
 *   notes: Note[],
 *   plannedStart: string|null,
 *   durationSec: number|null,
 *   type: string,
 *   completed: boolean,
 *   scriptText: string,
 *   scriptScrollPos: number,
 *   scriptScrollTopPx: number,
 *   scriptAutoSpeed: number,
 *   scriptAutoEnabled: boolean,
 *   scriptAutoStart: boolean,
 *   osc: CueOsc
 * }} ActionState
 * @typedef {{name: string, createdAt: string|null, updatedAt: string|null, version: string, autoSaveEnabled: boolean}} ShowMeta
 * @typedef {{enabled: boolean, remoteIP: string, remotePort: number, globalCommands: Record<string, OscCommand>}} OscSettings
 * @typedef {{
 *   showCurrent: boolean,
 *   showNext: boolean,
 *   showPrepare: boolean,
 *   showNotes: boolean,
 *   showScript: boolean,
 *   showTimer: boolean,
 *   showCountdown: boolean,
 *   showLiveIndicator: boolean,
 *   showClock: boolean,
 *   showLogo: boolean,
 *   fontSize: string,
 *   theme: string,
 *   logoUrl: string,
 *   strictScriptSync: boolean,
 *   mirrorScript: boolean,
 *   strictScriptWidthPx: number,
 *   strictScriptHeightPx: number,
 *   strictScriptFontSizePx: number,
 *   strictScriptLineHeight: number,
 *   strictScriptPaddingPx: number
 * }} SpeakerCustomization
 * @typedef {{
 *   layoutPreset: string,
 *   showCurrent: boolean,
 *   showNext: boolean,
 *   showPrepare: boolean,
 *   showNotes: boolean,
 *   showTimer: boolean,
 *   showCountdown: boolean,
 *   showClock: boolean,
 *   showLiveIndicator: boolean,
 *   fontSize: string,
 *   logoUrl: string
 * }} TechCustomization
 * @typedef {{
 *   actions: ActionState[],
 *   currentIndex: number,
 *   startedAt: number|null,
 *   isRunning: boolean,
 *   pausedAt: number|null,
 *   accumulatedPause: number,
 *   showMeta: ShowMeta,
 *   oscSettings: OscSettings,
 *   speakerCustomization: SpeakerCustomization,
 *   techCustomization: TechCustomization,
 *   uiTheme?: string,
 *   _speakerCustomizationHydrated?: boolean,
 *   _techCustomizationHydrated?: boolean
 * }} AppState
 */

export function createInitialAppState(mergeGlobalCommands) {
    /** @type {AppState} */
    return {
        actions: [],
        currentIndex: 0,
        startedAt: null,
        isRunning: false,
        pausedAt: null,
        accumulatedPause: 0,
        showMeta: {
            name: 'Без названия',
            createdAt: null,
            updatedAt: null,
            version: APP_VERSION,
            autoSaveEnabled: false
        },
        oscSettings: {
            enabled: false,
            remoteIP: '127.0.0.1',
            remotePort: 7000,
            globalCommands: mergeGlobalCommands(null)
        },
        speakerCustomization: {
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
            fontSize: 'medium',
            theme: 'dark',
            logoUrl: '',
            strictScriptSync: false,
            mirrorScript: false,
            strictScriptWidthPx: 800,
            strictScriptHeightPx: 400,
            strictScriptFontSizePx: 42,
            strictScriptLineHeight: 1.5,
            strictScriptPaddingPx: 16
        },
        techCustomization: {
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
        }
    };
}

export function createStateManager(deps) {
    function ensureAppStateShape() {
        const s = window.appState;
        if (!s.showMeta) {
            s.showMeta = { name: 'Без названия', createdAt: null, updatedAt: null, version: APP_VERSION, autoSaveEnabled: false };
        } else if (s.showMeta.autoSaveEnabled === undefined) {
            s.showMeta.autoSaveEnabled = false;
        }

        if (!s.oscSettings) {
            s.oscSettings = {
                enabled: false,
                remoteIP: '127.0.0.1',
                remotePort: 7000,
                globalCommands: deps.mergeGlobalCommands(null)
            };
        } else {
            s.oscSettings.globalCommands = deps.mergeGlobalCommands(s.oscSettings.globalCommands || {});
        }

        if (!s._speakerCustomizationHydrated) {
            s._speakerCustomizationHydrated = true;
            try {
                const savedSpeaker = localStorage.getItem(deps.SPEAKER_CUSTOMIZATION_STORAGE_KEY);
                if (savedSpeaker) {
                    const parsed = JSON.parse(savedSpeaker);
                    if (parsed && typeof parsed === 'object') {
                        s.speakerCustomization = deps.mergeSpeakerCustomization(parsed);
                    }
                }
            } catch (e) {
                // ignore parse/storage errors
            }
        }

        s.speakerCustomization = deps.mergeSpeakerCustomization(s.speakerCustomization);
        if (!s._techCustomizationHydrated) {
            s._techCustomizationHydrated = true;
            try {
                const savedTech = localStorage.getItem(deps.TECH_CUSTOMIZATION_STORAGE_KEY);
                if (savedTech) {
                    const parsed = JSON.parse(savedTech);
                    if (parsed && typeof parsed === 'object') {
                        s.techCustomization = deps.mergeTechCustomization(parsed);
                    }
                }
            } catch (e) {
                // ignore parse/storage errors
            }
        }
        s.techCustomization = deps.mergeTechCustomization(s.techCustomization);
        if (!s.uiTheme || !Object.prototype.hasOwnProperty.call(THEMES, s.uiTheme)) {
            s.uiTheme = 'dark';
        }
        if (Array.isArray(s.actions)) {
            s.actions.forEach((a) => {
                if (a && typeof a.scriptText !== 'string') a.scriptText = '';
                if (a && (typeof a.scriptScrollPos !== 'number' || !Number.isFinite(a.scriptScrollPos))) a.scriptScrollPos = 0;
                if (a && (typeof a.scriptScrollTopPx !== 'number' || !Number.isFinite(a.scriptScrollTopPx))) a.scriptScrollTopPx = 0;
                if (a && (typeof a.scriptAutoSpeed !== 'number' || !Number.isFinite(a.scriptAutoSpeed))) a.scriptAutoSpeed = 0.05;
                else if (a) a.scriptAutoSpeed = deps.clampScriptAutoSpeed(a.scriptAutoSpeed);
                if (a && typeof a.scriptAutoEnabled !== 'boolean') a.scriptAutoEnabled = false;
                if (a && typeof a.scriptAutoStart !== 'boolean') a.scriptAutoStart = false;
                if (a && !a.type) a.type = ACTION_TYPES.PERFORMANCE;
            });
        }
    }

    function notifyStateChange() {
        const appState = window.appState;
        window.dispatchEvent(new CustomEvent('appStateChanged', { detail: appState }));

        if (window.openScreens) {
            window.openScreens = window.openScreens.filter((s) => s && !s.closed);
            window.openScreens.forEach((screen) => {
                try {
                    screen.postMessage({ type: SCREEN_MESSAGE_TYPES.STATE_UPDATE, payload: appState }, '*');
                } catch (e) {
                    // ignore
                }
            });
        }

        deps.renderOperatorTimer();
        deps.renderOperatorCueBar();
        deps.updateMonitorIndicators();
        deps.updateActionItemsVisualState();
        deps.updateStatusBar();
        deps.debouncedAutoSave();
    }

    function syncStateFromDomOrder({ notify = true } = {}) {
        const appState = window.appState;
        const previousById = new Map(appState.actions.map((a) => [a.id, a]));
        const actionEls = Array.from(document.querySelectorAll('#scenario-items .action-item')).filter((el) => el.dataset && el.dataset.actionId);

        const newActions = actionEls.map((el) => {
            const id = deps.getActionIdFromElement(el);
            const title = el.querySelector('.action-text')?.textContent?.trim() || '';
            const timeEl = el.querySelector('.time-display');
            const plannedFromDataset = timeEl?.dataset?.plannedStart || '';
            const plannedStartRaw = plannedFromDataset || timeEl?.textContent?.trim() || '';
            const plannedStart = plannedStartRaw && plannedStartRaw !== '--:--' ? plannedStartRaw : null;
            const scriptTextArea = el.querySelector('textarea.script-textarea');
            const scriptStrict = el.querySelector('.script-editor-strict');
            const scriptSource = (window.appState?.speakerCustomization?.strictScriptSync && scriptStrict) ? scriptStrict : (scriptTextArea || scriptStrict);
            const scriptText = scriptSource
                ? ('value' in scriptSource ? String(scriptSource.value || '') : String(scriptSource.textContent || ''))
                : '';
            const scriptScrollFromDom = scriptSource ? deps.getScrollPercent(scriptSource) : null;
            const existing = previousById.get(id);

            if (existing) {
                existing.title = title;
                existing.plannedStart = plannedStart;
                existing.scriptText = scriptText;
                if (scriptScrollFromDom !== null) existing.scriptScrollPos = scriptScrollFromDom;
                else if (typeof existing.scriptScrollPos !== 'number' || !Number.isFinite(existing.scriptScrollPos)) existing.scriptScrollPos = 0;
                if (scriptSource) existing.scriptScrollTopPx = scriptSource.scrollTop || 0;
                else if (typeof existing.scriptScrollTopPx !== 'number' || !Number.isFinite(existing.scriptScrollTopPx)) existing.scriptScrollTopPx = 0;
                if (typeof existing.scriptAutoSpeed !== 'number' || !Number.isFinite(existing.scriptAutoSpeed)) existing.scriptAutoSpeed = 0.05;
                if (typeof existing.scriptAutoEnabled !== 'boolean') existing.scriptAutoEnabled = false;
                if (typeof existing.scriptAutoStart !== 'boolean') existing.scriptAutoStart = false;
                if (!existing.type) existing.type = ACTION_TYPES.PERFORMANCE;
                existing.completed = el.classList.contains('completed');
                if (!existing.osc) existing.osc = { onStart: null, onEnd: null };
                deps.syncDurationFromPlanned(existing);
                return existing;
            }

            const newAction = {
                id,
                title,
                notes: [],
                plannedStart,
                durationSec: null,
                type: ACTION_TYPES.PERFORMANCE,
                completed: el.classList.contains('completed'),
                scriptText,
                scriptScrollPos: scriptScrollFromDom !== null ? scriptScrollFromDom : 0,
                scriptScrollTopPx: scriptSource ? scriptSource.scrollTop || 0 : 0,
                scriptAutoSpeed: 0.05,
                scriptAutoEnabled: false,
                scriptAutoStart: false,
                osc: { onStart: null, onEnd: null }
            };
            deps.syncDurationFromPlanned(newAction);
            return newAction;
        });

        appState.actions = newActions;
        const activeEl = document.querySelector('#scenario-items .action-item.active');
        const activeId = activeEl ? deps.getActionIdFromElement(activeEl) : null;
        appState.currentIndex = activeId ? newActions.findIndex((a) => a.id === activeId) : 0;
        if (appState.currentIndex < 0) appState.currentIndex = 0;

        deps.updateActionItemsVisualState();
        if (notify) notifyStateChange();
    }

    function setActiveAction(actionItem, { resetTimer = true, notifyState = true, autoScroll = false } = {}) {
        const newId = deps.getActionIdFromElement(actionItem);
        const prevIdx = window.appState.currentIndex;
        const prevAction = window.appState.actions[prevIdx];

        if (newId && prevAction && prevAction.id !== newId) {
            deps.sendCueOscOnEnd(prevAction);
            deps.stopScriptAutoLoop();
            deps.disableScriptAutoForAction(prevAction);
            deps.refreshScriptControlsForActionId(prevAction.id);
        }

        deps.clearOperatorListFocus();
        document.querySelectorAll('.action-item').forEach((item) => item.classList.remove('active'));
        actionItem.classList.add('active');

        syncStateFromDomOrder({ notify: false });

        if (resetTimer) {
            window.appState.startedAt = Date.now();
            window.appState.accumulatedPause = 0;
            window.appState.pausedAt = null;
            window.appState.isRunning = true;
        }

        if (resetTimer && newId) {
            const idx = window.appState.actions.findIndex((a) => a.id === newId);
            const newAction = idx >= 0 ? window.appState.actions[idx] : null;
            if (newAction) deps.sendCueOscOnStart(newAction);
        }

        if (autoScroll) {
            setTimeout(() => {
                const headerHeight = document.querySelector('.header')?.offsetHeight ?? 0;
                const titleHeight = document.querySelector('.event-title')?.offsetHeight ?? 0;
                const windowHeight = window.innerHeight;
                const actionHeight = actionItem.offsetHeight;
                const totalOffset = headerHeight + titleHeight;
                const targetPosition = actionItem.offsetTop - totalOffset - (windowHeight - actionHeight - totalOffset) / 2;
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
            }, 100);
        }

        if (resetTimer) {
            requestAnimationFrame(() => deps.flashActiveCueHighlight());
        }
        if (notifyState) {
            notifyStateChange();
            deps.maybeStartScriptAutoLoopForCurrentCue();
        }
    }

    return { ensureAppStateShape, notifyStateChange, syncStateFromDomOrder, setActiveAction };
}

