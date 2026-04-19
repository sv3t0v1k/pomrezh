class FinalAction {
    constructor() {
        this.element = null;
    }

    create(actionId = null) {
        const template = document.querySelector('.action-item-template');
        if (!template) return null;

        this.element = template.cloneNode(true);
        this.element.classList.remove('action-item-template');
        this.element.classList.add('action-item', 'final-action');
        this.element.style.display = 'flex';

        if (actionId) {
            this.element.dataset.actionId = actionId;
        }

        const actionText = this.element.querySelector('.action-text');
        actionText.textContent = 'Мероприятие окончено';

        if (actionId && typeof attachActionTypeControl === 'function') {
            attachActionTypeControl(this.element, actionId);
        }

        const controls = this.element.querySelector('.action-controls');
        const oldPlay = this.element.querySelector('.btn-play');
        if (oldPlay) oldPlay.remove();

        const btnGo = document.createElement('button');
        btnGo.type = 'button';
        btnGo.className = 'btn-go';
        btnGo.textContent = 'СТАРТ';
        btnGo.title = 'Сделать текущим (финальный cue)';

        const btnDone = document.createElement('button');
        btnDone.type = 'button';
        btnDone.className = 'btn-done';
        btnDone.textContent = 'ГОТОВО';
        btnDone.title = 'Завершить мероприятие';

        if (controls) {
            controls.appendChild(btnGo);
            controls.appendChild(btnDone);
        }

        btnGo.addEventListener('mousedown', (e) => e.stopPropagation());
        btnDone.addEventListener('mousedown', (e) => e.stopPropagation());

        btnGo.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.setActiveAction === 'function') {
                window.setActiveAction(this.element);
            }
        });

        btnDone.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = this.element.dataset.actionId;
            const st = id ? window.appState.actions.find(a => a.id === id) : null;
            if (st && !st.completed && typeof applyDoneOscAndMaybeFinishShow === 'function') {
                applyDoneOscAndMaybeFinishShow(this.element, id);
            }
            if (st) st.completed = true;
            this.element.classList.add('completed');
            btnDone.disabled = true;
            this.showEndingMessage();
        });

        if (actionId && typeof attachOscDetailsToActionItem === 'function') {
            queueMicrotask(() => attachOscDetailsToActionItem(this.element, actionId));
        }

        this.element.querySelector('.action-script')?.remove();

        return this.element;
    }

    showEndingMessage() {
        // В новой архитектуре финал отражаем через appState, без старого second-window.
        if (window.appState) {
            window.appState.startedAt = null;
            window.appState.isRunning = false;
            window.appState.pausedAt = null;
            window.appState.accumulatedPause = 0;
        }
        if (typeof window.notifyStateChange === 'function') {
            window.notifyStateChange();
        }
    }
}

// Экспортируем класс
window.FinalAction = FinalAction; 