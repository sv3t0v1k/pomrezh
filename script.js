document.addEventListener('DOMContentLoaded', () => {
    // Реорганизуем шапку
    const header = document.querySelector('.header');
    const navigationButtons = document.querySelector('.navigation-buttons');
    const actionButtons = document.querySelector('.action-buttons');
    
    // Очищаем шапку
    header.innerHTML = '';
    
    // Создаем контейнеры
    const headerLeft = document.createElement('div');
    headerLeft.className = 'header-left';
    
    const headerCenter = document.createElement('div');
    headerCenter.className = 'header-center';
    
    const headerRight = document.createElement('div');
    headerRight.className = 'header-right';
    
    // Создаем отображение времени
    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'current-time';
    
    // Добавляем элементы в нужном порядке
    headerLeft.appendChild(navigationButtons);
    headerCenter.appendChild(timeDisplay);
    headerRight.appendChild(actionButtons);
    
    header.appendChild(headerLeft);
    header.appendChild(headerCenter);
    header.appendChild(headerRight);

    function updateTime() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        timeDisplay.textContent = `${hours}:${minutes}:${seconds}`;
    }

    // Обновляем время каждую секунду
    updateTime();
    setInterval(updateTime, 1000);

    // История действий для кнопок Назад/Вперед
    const history = {
        actions: [],
        currentIndex: -1,
        push(action) {
            this.actions = this.actions.slice(0, this.currentIndex + 1);
            this.actions.push(action);
            this.currentIndex++;
        }
    };

    // Загрузка Excel файла
    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', handleFileSelect);

    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        showLoadingIndicator();

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
                    header: 1,
                    defval: '' // Устанавливаем пустую строку как значение по умолчанию
                });
                
                if (jsonData.length > 0) {
                    processExcelData(jsonData);
                } else {
                    showError('Файл не содержит данных');
                }
            } catch (error) {
                showError('Ошибка при чтении файла');
                console.error(error);
            } finally {
                hideLoadingIndicator();
            }
        };

        reader.onerror = function() {
            hideLoadingIndicator();
            showError('Ошибка при чтении файла');
        };

        reader.readAsArrayBuffer(file);
    }

    function processExcelData(jsonData) {
        // Очищаем текущий сценарий
        const scenarioItems = document.getElementById('scenario-items');
        scenarioItems.innerHTML = '';
        
        // Устанавливаем название мероприятия
        if (jsonData[0] && jsonData[0][0]) {
            document.querySelector('.event-title h1').textContent = jsonData[0][0];
        }
        
        // Добавляем действия из Excel
        let actionNumber = 1;
        for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (row && row[0]) {
                const actionItem = createActionItemFromTemplate(
                    actionNumber,
                    row[0], // текст действия
                    row[1] || '', // примечание (если есть)
                    row[2] || '' // время (если есть)
                );
                scenarioItems.appendChild(actionItem);
                actionNumber++;
            }
        }

        updateActionCounters();
        
        // Добавляем в историю
        history.push({
            type: 'load',
            content: jsonData
        });
    }

    function createActionItemFromTemplate(number, text, note, time) {
        const template = document.querySelector('.action-item-template');
        const clone = template.cloneNode(true);
        
        clone.classList.remove('action-item-template');
        clone.classList.add('action-item');
        clone.style.display = 'flex';
        
        // Устанавливаем номер действия
        clone.querySelector('.action-number').textContent = `#${number}`;
        
        // Устанавливаем текст действия
        clone.querySelector('.action-text').textContent = text;
        
        // Добавляем примечание, если оно есть
        if (note) {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'note';
            noteDiv.textContent = note;
            clone.querySelector('.action-notes').appendChild(noteDiv);
        }

        // Устанавливаем время, если оно есть
        const timeDisplay = clone.querySelector('.time-display');
        if (time) {
            timeDisplay.textContent = time;
        } else {
            timeDisplay.style.display = 'none';
        }
        
        setupActionItemListeners(clone);
        return clone;
    }

    function setupActionItemListeners(actionItem) {
        const deleteBtn = actionItem.querySelector('.btn-delete');
        const playBtn = actionItem.querySelector('.btn-play');
        const actionText = actionItem.querySelector('.action-text');
        const timeDisplay = actionItem.querySelector('.time-display');
        const actionNotes = actionItem.querySelector('.action-notes');

        // Настраиваем перетаскивание для примечаний
        const setupNoteDraggable = (noteElement) => {
            noteElement.setAttribute('draggable', 'true');
            
            noteElement.addEventListener('dragstart', (e) => {
                if (document.body.classList.contains('dragging-action')) {
                    e.preventDefault();
                    return;
                }
                e.stopPropagation();
                noteElement.classList.add('dragging');
                e.dataTransfer.setData('text/plain', noteElement.textContent);
                e.dataTransfer.setData('application/x-note', 'true');
                e.dataTransfer.effectAllowed = 'move';
            });

            noteElement.addEventListener('dragend', (e) => {
                e.stopPropagation();
                noteElement.classList.remove('dragging');
                document.querySelectorAll('.action-notes').forEach(notes => {
                    notes.classList.remove('drag-over');
                });
            });

            // Делаем примечание редактируемым
            noteElement.addEventListener('dblclick', () => {
                noteElement.contentEditable = true;
                noteElement.focus();
            });

            noteElement.addEventListener('blur', () => {
                noteElement.contentEditable = false;
            });
        };

        // Применяем к существующим примечаниям
        actionItem.querySelectorAll('.note').forEach(setupNoteDraggable);

        // Обработчики для области примечаний
        actionNotes.addEventListener('dragover', (e) => {
            if (document.body.classList.contains('dragging-action')) return;
            e.preventDefault();
            e.stopPropagation();
            actionNotes.classList.add('drag-over');
        });

        actionNotes.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            actionNotes.classList.remove('drag-over');
        });

        actionNotes.addEventListener('drop', (e) => {
            if (document.body.classList.contains('dragging-action')) return;
            e.preventDefault();
            e.stopPropagation();
            actionNotes.classList.remove('drag-over');

            const noteText = e.dataTransfer.getData('text/plain');
            const isExistingNote = e.dataTransfer.getData('application/x-note') === 'true';
            
            if (noteText.trim()) {
                const draggingNote = document.querySelector('.note.dragging');
                
                if (isExistingNote && draggingNote) {
                    // Перемещаем существующее примечание
                    actionNotes.appendChild(draggingNote);
                    history.push({
                        type: 'move-note',
                        element: draggingNote,
                        newParent: actionNotes
                    });
                } else {
                    // Создаем новое примечание
                    const noteDiv = document.createElement('div');
                    noteDiv.className = 'note';
                    noteDiv.textContent = noteText;
                    setupNoteDraggable(noteDiv);
                    actionNotes.appendChild(noteDiv);
                    
                    history.push({
                        type: 'add-note',
                        element: noteDiv,
                        parent: actionItem
                    });
                }

                // Скрываем создатель примечаний
                if (noteCreator.style.display === 'flex') {
                    noteCreator.style.display = 'none';
                    draggableNote.textContent = '';
                }
            }
        });

        // Остальные обработчики...
        deleteBtn.addEventListener('click', () => {
            history.push({
                type: 'delete',
                element: actionItem,
                parent: actionItem.parentNode,
                position: Array.from(actionItem.parentNode.children).indexOf(actionItem)
            });
            actionItem.remove();
            updateActionCounters();
        });

        playBtn.addEventListener('click', () => {
            const isActive = actionItem.classList.contains('active');
            
            document.querySelectorAll('.action-item').forEach(item => {
                item.classList.remove('active', 'next');
                if (item.classList.contains('completed')) {
                    item.querySelector('.btn-play').classList.add('completed');
                }
            });

            if (!isActive) {
                actionItem.classList.add('active');
                playBtn.classList.add('active');

                let prev = actionItem.previousElementSibling;
                while (prev) {
                    if (!prev.classList.contains('action-item-template')) {
                        prev.classList.add('completed');
                        prev.querySelector('.btn-play').classList.add('completed');
                    }
                    prev = prev.previousElementSibling;
                }

                const next = actionItem.nextElementSibling;
                if (next && !next.classList.contains('action-item-template')) {
                    next.classList.add('next');
                }

                // Плавная прокрутка к активному действию
                const headerHeight = document.querySelector('.header').offsetHeight;
                const titleHeight = document.querySelector('.event-title').offsetHeight;
                const totalOffset = headerHeight + titleHeight + 20; // 20px дополнительный отступ

                window.scrollTo({
                    top: actionItem.offsetTop - totalOffset,
                    behavior: 'smooth'
                });
            }
            
            updateActionCounters();
        });

        actionText.addEventListener('blur', () => {
            history.push({
                type: 'edit',
                element: actionItem,
                field: 'text',
                oldText: actionText.dataset.previousText,
                newText: actionText.textContent
            });
        });

        actionText.addEventListener('focus', () => {
            actionText.dataset.previousText = actionText.textContent;
        });

        timeDisplay.addEventListener('blur', () => {
            history.push({
                type: 'edit',
                element: actionItem,
                field: 'time',
                oldTime: timeDisplay.dataset.previousTime,
                newTime: timeDisplay.textContent
            });
        });

        timeDisplay.addEventListener('focus', () => {
            timeDisplay.dataset.previousTime = timeDisplay.textContent;
        });
    }

    function updateActionCounters() {
        const totalActions = document.querySelectorAll('.action-item').length;
        const completedActions = document.querySelectorAll('.action-item.completed').length;
        
        document.getElementById('actions-count').textContent = totalActions;
        document.getElementById('completed-count').textContent = completedActions;
    }

    function showLoadingIndicator() {
        document.getElementById('loading-indicator').style.display = 'flex';
    }

    function hideLoadingIndicator() {
        document.getElementById('loading-indicator').style.display = 'none';
    }

    function showError(message) {
        const errorElement = document.getElementById('error-message');
        errorElement.querySelector('.error-text').textContent = message;
        errorElement.style.display = 'flex';
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 3000);
    }

    // Добавление нового действия
    const addActionButton = document.querySelector('.btn-add-action');
    addActionButton.addEventListener('click', () => {
        const scenarioItems = document.getElementById('scenario-items');
        const actionNumber = document.querySelectorAll('.action-item').length + 1;
        const actionItem = createActionItemFromTemplate(actionNumber, 'Новое действие');
        scenarioItems.insertBefore(actionItem, scenarioItems.firstChild);
        updateActionCounters();
        history.push({
            type: 'add',
            element: actionItem
        });
    });

    // Добавление примечания
    const addNoteButton = document.querySelector('.btn-note');
    const noteCreator = document.getElementById('note-creator');
    const closeNoteButton = document.querySelector('.btn-close-note');
    const draggableNote = document.querySelector('.draggable-note');

    addNoteButton.addEventListener('click', () => {
        noteCreator.style.display = 'flex';
        draggableNote.textContent = '';
        draggableNote.focus();
    });

    closeNoteButton.addEventListener('click', () => {
        noteCreator.style.display = 'none';
        draggableNote.textContent = '';
    });

    // Настройка drag and drop для нового примечания
    draggableNote.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        draggableNote.classList.add('dragging');
        e.dataTransfer.setData('text/plain', draggableNote.textContent);
        e.dataTransfer.setData('application/x-note-type', 'new');
        e.dataTransfer.effectAllowed = 'copy';
    });

    draggableNote.addEventListener('dragend', (e) => {
        e.stopPropagation();
        draggableNote.classList.remove('dragging');
        document.querySelectorAll('.action-item').forEach(item => {
            item.classList.remove('drag-over');
        });
    });

    // Обработка перетаскивания для действий и примечаний
    document.addEventListener('dragover', (e) => {
        if (document.body.classList.contains('dragging-action')) return;

        const actionItem = e.target.closest('.action-item');
        if (actionItem) {
            e.preventDefault();
            actionItem.classList.add('drag-over');
        }
    }, true);

    document.addEventListener('dragleave', (e) => {
        if (document.body.classList.contains('dragging-action')) return;

        const actionItem = e.target.closest('.action-item');
        if (actionItem) {
            actionItem.classList.remove('drag-over');
        }
    }, true);

    document.addEventListener('drop', (e) => {
        if (document.body.classList.contains('dragging-action')) return;

        const actionItem = e.target.closest('.action-item');
        if (!actionItem) return;

        e.preventDefault();
        e.stopPropagation();
        
        actionItem.classList.remove('drag-over');
        const noteText = e.dataTransfer.getData('text/plain');
        const noteType = e.dataTransfer.getData('application/x-note-type');

        if (!noteText.trim()) return;

        const actionNotes = actionItem.querySelector('.action-notes');
        
        if (noteType === 'new') {
            // Создаем новое примечание
            const noteDiv = document.createElement('div');
            noteDiv.className = 'note';
            noteDiv.textContent = noteText;
            setupNoteDraggable(noteDiv);
            actionNotes.appendChild(noteDiv);

            // Скрываем создатель примечаний
            noteCreator.style.display = 'none';
            draggableNote.textContent = '';

            history.push({
                type: 'add-note',
                element: noteDiv,
                parent: actionItem
            });
        } else if (noteType === 'existing') {
            const draggedNote = document.querySelector('.note.dragging');
            if (draggedNote && draggedNote.parentElement !== actionNotes) {
                actionNotes.appendChild(draggedNote);
                history.push({
                    type: 'move-note',
                    element: draggedNote,
                    newParent: actionNotes
                });
            }
        }
    }, true);

    function setupNoteDraggable(noteElement) {
        noteElement.setAttribute('draggable', 'true');
        
        noteElement.addEventListener('dragstart', (e) => {
            if (document.body.classList.contains('dragging-action')) {
                e.preventDefault();
                return;
            }
            e.stopPropagation();
            noteElement.classList.add('dragging');
            e.dataTransfer.setData('text/plain', noteElement.textContent);
            e.dataTransfer.setData('application/x-note-type', 'existing');
            e.dataTransfer.effectAllowed = 'move';
        });

        noteElement.addEventListener('dragend', (e) => {
            e.stopPropagation();
            noteElement.classList.remove('dragging');
            document.querySelectorAll('.action-item, .action-notes').forEach(el => {
                el.classList.remove('drag-over');
            });
        });

        // Делаем примечание редактируемым по двойному клику
        noteElement.addEventListener('dblclick', () => {
            noteElement.contentEditable = true;
            noteElement.focus();
        });

        noteElement.addEventListener('blur', () => {
            noteElement.contentEditable = false;
        });
    }

    // Обработка drag and drop на действиях
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        const actionItem = e.target.closest('.action-item');
        if (actionItem && !actionItem.classList.contains('sortable-chosen')) {
            actionItem.classList.add('drag-over');
        }
    });

    document.addEventListener('dragleave', (e) => {
        const actionItem = e.target.closest('.action-item');
        if (actionItem) {
            actionItem.classList.remove('drag-over');
        }
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        const actionItem = e.target.closest('.action-item');
        // Проверяем, что это перетаскивание примечания, а не сортировка действий
        if (actionItem && e.dataTransfer && e.dataTransfer.getData('text/plain') && !document.body.classList.contains('dragging-action')) {
            actionItem.classList.remove('drag-over');
            const noteText = e.dataTransfer.getData('text/plain');
            if (noteText.trim()) {
                const noteDiv = document.createElement('div');
                noteDiv.className = 'note';
                noteDiv.contentEditable = true;
                noteDiv.textContent = noteText;
                actionItem.querySelector('.action-notes').appendChild(noteDiv);
                
                history.push({
                    type: 'add-note',
                    element: noteDiv,
                    parent: actionItem
                });

                // Скрываем создатель примечаний после успешного добавления
                noteCreator.style.display = 'none';
                draggableNote.textContent = '';
            }
        }
    });

    // Делаем примечание перетаскиваемым
    draggableNote.setAttribute('draggable', 'true');

    // Кнопки навигации
    const backButton = document.querySelector('.btn-back');
    const forwardButton = document.querySelector('.btn-forward');

    backButton.addEventListener('click', () => {
        if (history.currentIndex >= 0) {
            const action = history.actions[history.currentIndex];
            undoAction(action);
            history.currentIndex--;
        }
    });

    forwardButton.addEventListener('click', () => {
        if (history.currentIndex < history.actions.length - 1) {
            history.currentIndex++;
            const action = history.actions[history.currentIndex];
            redoAction(action);
        }
    });

    function undoAction(action) {
        if (action.type === 'add') {
            action.element.remove();
        } else if (action.type === 'delete') {
            action.parent.insertBefore(action.element, action.parent.children[action.position]);
        } else if (action.type === 'load') {
            // Возвращаем предыдущее состояние сценария
            const scenarioItems = document.getElementById('scenario-items');
            scenarioItems.innerHTML = action.previousContent || '';
        }
    }

    function redoAction(action) {
        if (action.type === 'add') {
            const scenarioItems = document.getElementById('scenario-items');
            scenarioItems.insertBefore(action.element, scenarioItems.firstChild);
        } else if (action.type === 'delete') {
            action.element.remove();
        } else if (action.type === 'load') {
            // Восстанавливаем загруженное состояние
            const scenarioItems = document.getElementById('scenario-items');
            action.previousContent = scenarioItems.innerHTML;
            processExcelData(action.content);
        }
    }

    // Включаем drag-and-drop для элементов сценария
    const scenarioItems = document.getElementById('scenario-items');
    new Sortable(scenarioItems, {
        animation: 150,
        handle: '.action-item',
        filter: '.note, .action-text, .time-display, .btn-delete, .btn-play',
        preventOnFilter: true,
        group: 'scenario-items',
        draggable: '.action-item',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        forceFallback: false,
        scroll: true,
        scrollSensitivity: 30,
        scrollSpeed: 10,
        delayOnTouchOnly: true,
        delay: 100,
        swapThreshold: 0.65,
        direction: 'vertical',
        onChoose: function(evt) {
            evt.item.classList.add('sortable-chosen');
        },
        onUnchoose: function(evt) {
            evt.item.classList.remove('sortable-chosen');
        },
        onStart: function(evt) {
            document.body.classList.add('dragging-action');
            evt.item.classList.add('is-dragging');
            
            // Добавляем класс для визуального индикатора возможности вставки
            const items = scenarioItems.querySelectorAll('.action-item');
            items.forEach(item => {
                if (item !== evt.item) {
                    item.classList.add('drop-target');
                }
            });
        },
        onEnd: function(evt) {
            document.body.classList.remove('dragging-action');
            evt.item.classList.remove('is-dragging');
            
            // Удаляем классы визуального индикатора
            const items = scenarioItems.querySelectorAll('.action-item');
            items.forEach(item => {
                item.classList.remove('drop-target', 'drop-target-above', 'drop-target-below');
            });
            
            // Обновляем номера действий
            const actions = Array.from(scenarioItems.querySelectorAll('.action-item'));
            actions.forEach((action, index) => {
                action.querySelector('.action-number').textContent = `#${index + 1}`;
            });
            
            if (evt.oldIndex !== evt.newIndex) {
                history.push({
                    type: 'move',
                    element: evt.item,
                    oldIndex: evt.oldIndex,
                    newIndex: evt.newIndex
                });
                updateActionCounters();
            }
        },
        onMove: function(evt) {
            const dragged = evt.dragged;
            const related = evt.related;
            
            if (!related || !related.classList.contains('action-item')) {
                return false;
            }
            
            // Определяем позицию курсора относительно центра элемента
            const relatedRect = related.getBoundingClientRect();
            const draggedRect = dragged.getBoundingClientRect();
            const relatedMiddle = relatedRect.top + relatedRect.height / 2;
            const draggedMiddle = evt.originalEvent.clientY;
            
            // Удаляем предыдущие индикаторы
            document.querySelectorAll('.action-item').forEach(item => {
                item.classList.remove('drop-target-above', 'drop-target-below');
            });
            
            // Добавляем индикатор в зависимости от положения
            if (draggedMiddle < relatedMiddle) {
                related.classList.add('drop-target-above');
            } else {
                related.classList.add('drop-target-below');
            }
            
            return true;
        }
    });

    // Очищаем индикаторы перетаскивания при отпускании
    document.addEventListener('mouseup', function() {
        const items = document.querySelectorAll('.action-item');
        items.forEach(item => {
            item.classList.remove('drag-over', 'is-dragging');
        });
    });

    // Предотвращаем стандартное поведение drag and drop для текстовых полей
    document.addEventListener('dragstart', function(e) {
        if (e.target.matches('.action-text, .time-display, .note')) {
            e.preventDefault();
        }
    });
}); 