export const APP_VERSION = '1.0.3';

export const EVENT_TITLE_STORAGE_KEY = 'event_title';
export const APP_THEME_STORAGE_KEY = 'app_theme';
export const SPEAKER_CUSTOMIZATION_STORAGE_KEY = 'speakerCustomization';
export const TECH_CUSTOMIZATION_STORAGE_KEY = 'techCustomization';

export const DEFAULT_GLOBAL_COMMANDS = {
    onPause: { address: '/transport/pause', args: [] },
    onResume: { address: '/transport/play', args: [] },
    onNext: { address: '/cue/next', args: [] },
    onShowEnd: { address: '/show/end', args: [] }
};

export const DEFAULT_CUE_COMMANDS = {
    onStart: { address: '/cue/start', args: ['{title}'] },
    onEnd: { address: '/cue/end', args: ['{id}'] }
};

export const THEMES = {
    dark: 'theme-dark',
    light: 'theme-light',
    highContrast: 'theme-high-contrast'
};

export const SCREEN_MESSAGE_TYPES = {
    INIT_STATE: 'INIT_STATE',
    STATE_UPDATE: 'STATE_UPDATE',
    APPLY_THEME: 'APPLY_THEME',
    APPLY_SPEAKER_CUSTOMIZATION: 'APPLY_SPEAKER_CUSTOMIZATION',
    SYNC_SCROLL: 'SYNC_SCROLL',
    SPEAKER_SCROLL_SYNC: 'SPEAKER_SCROLL_SYNC'
};

export const ACTION_TYPES = {
    PERFORMANCE: 'performance',
    HOST: 'host',
    TECH: 'tech'
};
