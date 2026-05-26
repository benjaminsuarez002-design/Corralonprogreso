(function () {
  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function statesEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function isUndoShortcut(event) {
    return Boolean(event && (event.ctrlKey || event.metaKey) && !event.shiftKey && String(event.key || '').toLowerCase() === 'z');
  }

  function createUndoStack(options = {}) {
    const stack = [];
    const limit = Number(options.limit || 50);
    const getState = options.getState;
    const restoreState = options.restoreState;
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;

    function push(state) {
      if (!state) return false;
      if (typeof getState === 'function' && statesEqual(state, getState())) return false;
      const last = stack[stack.length - 1];
      if (last && statesEqual(last, state)) return false;
      stack.push(deepClone(state));
      while (stack.length > limit) stack.shift();
      return true;
    }

    function undo() {
      const state = stack.pop();
      if (!state) {
        if (onStatus) onStatus('No hay cambios para deshacer');
        return false;
      }
      if (typeof restoreState === 'function') restoreState(deepClone(state));
      return true;
    }

    function clear() {
      stack.length = 0;
    }

    return {
      push,
      undo,
      clear,
      size: () => stack.length
    };
  }

  function isPrintableTypingKey(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return false;
    return String(event.key || '').length === 1;
  }

  function normalizeElementList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value.length === 'number' && typeof value !== 'string') return Array.from(value).filter(Boolean);
    return [value].filter(Boolean);
  }

  function dispatchInputChange(element) {
    if (!element) return;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function defaultGetCellValue(cell) {
    const field = cell?.matches?.('input, textarea, select') ? cell : cell?.querySelector?.('input, textarea, select');
    if (field) return field.value;
    return cell?.textContent || '';
  }

  function defaultSetCellValue(cell, value) {
    const field = cell?.matches?.('input, textarea, select') ? cell : cell?.querySelector?.('input, textarea, select');
    if (field) {
      field.value = value;
      dispatchInputChange(field);
      return;
    }
    if (cell) cell.textContent = value;
  }

  function parseClipboardTable(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const value = String(text || '');

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      const next = value[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && char === '\t') {
        row.push(cell);
        cell = '';
        continue;
      }

      if (!inQuotes && (char === '\n' || char === '\r')) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }

      cell += char;
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  function formatClipboardTable(rows) {
    return normalizeElementList(rows).map((row) => normalizeElementList(row).map((cell) => {
      const value = String(cell ?? '');
      return /["\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join('\t')).join('\n');
  }

  function bindDropdownOnlyWhenTyping(options = {}) {
    const root = options.root || document;
    const inputSelector = options.inputSelector || 'input';
    const buttonSelector = options.buttonSelector || '';
    const show = typeof options.show === 'function' ? options.show : null;
    const hide = typeof options.hide === 'function' ? options.hide : null;
    const isOpen = typeof options.isOpen === 'function' ? options.isOpen : null;
    const pickActive = typeof options.pickActive === 'function' ? options.pickActive : null;
    const pickFirst = typeof options.pickFirst === 'function' ? options.pickFirst : null;
    const moveActive = typeof options.moveActive === 'function' ? options.moveActive : null;
    const inputFromButton = typeof options.inputFromButton === 'function' ? options.inputFromButton : null;
    const containerFromInput = typeof options.containerFromInput === 'function' ? options.containerFromInput : null;
    const selectOnFocus = options.selectOnFocus !== false;
    const openOnTyping = options.openOnTyping !== false;
    const openOnButton = options.openOnButton !== false;
    const buttonOnlyWhenFocused = options.buttonOnlyWhenFocused === true;
    const openOnAltArrow = options.openOnAltArrow !== false;
    const openOnF4 = options.openOnF4 !== false;
    const enterPicksFirst = options.enterPicksFirst !== false;
    const focusedClass = options.focusedClass || '';
    let focusedInput = null;

    function inputFromEvent(event) {
      return event?.target?.closest?.(inputSelector) || null;
    }

    function getContainer(input) {
      if (!input) return null;
      return containerFromInput ? containerFromInput(input) : input.closest?.('[data-combo], .combo, .combo-cell') || input.parentElement;
    }

    function setFocused(input, isFocused) {
      if (!focusedClass) return;
      const container = getContainer(input);
      if (container) container.classList.toggle(focusedClass, isFocused);
    }

    function hasFocusInside(input) {
      const container = getContainer(input);
      return input === document.activeElement || Boolean(container && container.contains(document.activeElement));
    }

    function showDropdown(input, reason, event) {
      if (show) show(input, reason, event);
    }

    function hideDropdown(input, reason, event) {
      if (hide) hide(input, reason, event);
    }

    function handleFocusIn(event) {
      const input = inputFromEvent(event);
      if (!input) return;
      focusedInput = input;
      setFocused(input, true);
      if (selectOnFocus && typeof input.select === 'function') input.select();
      hideDropdown(input, 'focus', event);
    }

    function handleFocusOut(event) {
      const input = inputFromEvent(event);
      if (!input) return;
      setTimeout(() => {
        if (!hasFocusInside(input)) {
          if (focusedInput === input) focusedInput = null;
          setFocused(input, false);
        }
      }, 0);
    }

    function handleInput(event) {
      const input = inputFromEvent(event);
      if (!input || !openOnTyping) return;
      showDropdown(input, 'typing', event);
    }

    function handleKeyDown(event) {
      const input = inputFromEvent(event);
      if (!input) return;

      if ((openOnF4 && event.key === 'F4') || (openOnAltArrow && event.altKey && event.key === 'ArrowDown')) {
        event.preventDefault();
        if (isOpen && isOpen(input)) {
          hideDropdown(input, 'toggle', event);
        } else if (show) {
          showDropdown(input, 'toggle', event);
        }
        return;
      }

      if (event.key === 'Escape' && isOpen && isOpen(input)) {
        event.preventDefault();
        hideDropdown(input, 'escape', event);
        return;
      }

      if (event.key === 'Enter' && isOpen && isOpen(input) && pickActive) {
        event.preventDefault();
        const picked = pickActive(input, event);
        if (picked === false && enterPicksFirst && pickFirst) pickFirst(input, event);
        return;
      }

      if (event.key === 'Enter' && isOpen && isOpen(input) && enterPicksFirst && pickFirst) {
        event.preventDefault();
        pickFirst(input, event);
        return;
      }

      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && isOpen && isOpen(input) && moveActive) {
        event.preventDefault();
        moveActive(input, event.key === 'ArrowDown' ? 1 : -1, event);
        return;
      }

      if (openOnTyping && isPrintableTypingKey(event) && !(isOpen && isOpen(input)) && show) {
        setTimeout(() => showDropdown(input, 'typing-key', event), 0);
      }
    }

    function handleButtonMouseDown(event) {
      if (!buttonSelector || !openOnButton) return;
      const button = event.target.closest(buttonSelector);
      if (!button) return;
      const input = inputFromButton
        ? inputFromButton(button)
        : button.parentElement?.querySelector?.(inputSelector);
      if (!input) return;
      const wasFocused = focusedInput === input || hasFocusInside(input);
      event.preventDefault();
      event.stopPropagation();
      input.focus();
      if (buttonOnlyWhenFocused && !wasFocused) return;
      if (isOpen && isOpen(input)) {
        hideDropdown(input, 'button', event);
      } else {
        showDropdown(input, 'button', event);
      }
    }

    root.addEventListener('focusin', handleFocusIn);
    root.addEventListener('focusout', handleFocusOut);
    root.addEventListener('input', handleInput);
    root.addEventListener('keydown', handleKeyDown);
    if (buttonSelector) root.addEventListener('mousedown', handleButtonMouseDown);

    return {
      destroy() {
        root.removeEventListener('focusin', handleFocusIn);
        root.removeEventListener('focusout', handleFocusOut);
        root.removeEventListener('input', handleInput);
        root.removeEventListener('keydown', handleKeyDown);
        if (buttonSelector) root.removeEventListener('mousedown', handleButtonMouseDown);
      }
    };
  }

  function bindDropdownF4(options = {}) {
    return bindDropdownOnlyWhenTyping({
      ...options,
      openOnTyping: false,
      openOnButton: options.openOnButton !== false,
      openOnF4: true,
      openOnAltArrow: options.openOnAltArrow !== false
    });
  }

  function bindGridNavigation(options = {}) {
    const root = options.root || document;
    const cellSelector = options.cellSelector || 'input, textarea, select, [tabindex]';
    const selectOnFocus = options.selectOnFocus !== false;
    const scrollIntoView = options.scrollIntoView !== false;
    const navigateLeftRight = options.navigateLeftRight === true;
    const getPosition = typeof options.getPosition === 'function'
      ? options.getPosition
      : (cell) => ({
        row: Number(cell?.dataset?.row ?? cell?.closest?.('[data-row]')?.dataset?.row),
        col: Number(cell?.dataset?.col ?? cell?.closest?.('[data-col]')?.dataset?.col)
      });
    const findCell = typeof options.findCell === 'function'
      ? options.findCell
      : (row, col) => Array.from(root.querySelectorAll(cellSelector)).find((cell) => {
        const position = getPosition(cell);
        return Number(position?.row) === Number(row) && Number(position?.col) === Number(col);
      });
    const beforeMove = typeof options.beforeMove === 'function' ? options.beforeMove : null;
    const afterMove = typeof options.afterMove === 'function' ? options.afterMove : null;

    function cellFromEvent(event) {
      return event?.target?.closest?.(cellSelector) || null;
    }

    function focusCell(cell, event, fromCell) {
      if (!cell) return false;
      if (beforeMove && beforeMove(cell, fromCell, event) === false) return false;
      cell.focus?.();
      if (selectOnFocus && typeof cell.select === 'function') cell.select();
      if (scrollIntoView) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (afterMove) afterMove(cell, fromCell, event);
      return true;
    }

    function moveFrom(cell, rowDelta, colDelta, event) {
      const position = getPosition(cell, event);
      if (!position || !Number.isFinite(position.row) || !Number.isFinite(position.col)) return false;
      const target = findCell(position.row + rowDelta, position.col + colDelta, cell, event);
      return focusCell(target, event, cell);
    }

    function handleKeyDown(event) {
      if (event.defaultPrevented) return;
      const cell = cellFromEvent(event);
      if (!cell) return;
      let moved = false;

      if (event.key === 'Enter') {
        moved = moveFrom(cell, event.shiftKey ? -1 : 1, 0, event);
      } else if (event.key === 'Tab') {
        moved = moveFrom(cell, 0, event.shiftKey ? -1 : 1, event);
      } else if (event.key === 'ArrowDown') {
        moved = moveFrom(cell, 1, 0, event);
      } else if (event.key === 'ArrowUp') {
        moved = moveFrom(cell, -1, 0, event);
      } else if (navigateLeftRight && event.key === 'ArrowRight') {
        moved = moveFrom(cell, 0, 1, event);
      } else if (navigateLeftRight && event.key === 'ArrowLeft') {
        moved = moveFrom(cell, 0, -1, event);
      }

      if (moved) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    root.addEventListener('keydown', handleKeyDown);

    return {
      destroy() {
        root.removeEventListener('keydown', handleKeyDown);
      },
      moveFrom
    };
  }

  function bindTableSelectPaste(options = {}) {
    const root = options.root || document;
    const cellSelector = options.cellSelector || '[data-row][data-col]';
    const columnSelector = options.columnSelector || '[data-col-select], th[data-col], [data-select-column]';
    const cornerSelector = options.cornerSelector || '[data-select-all], [data-table-corner]';
    const selectedClass = options.selectedClass || 'is-selected';
    const activeClass = options.activeClass || 'is-active-cell';
    const getCellValue = typeof options.getCellValue === 'function' ? options.getCellValue : defaultGetCellValue;
    const setCellValue = typeof options.setCellValue === 'function' ? options.setCellValue : defaultSetCellValue;
    const afterSelect = typeof options.afterSelect === 'function' ? options.afterSelect : null;
    const afterPaste = typeof options.afterPaste === 'function' ? options.afterPaste : null;
    const afterClear = typeof options.afterClear === 'function' ? options.afterClear : null;
    const pasteTextOverride = typeof options.pasteText === 'function' ? options.pasteText : null;
    const selectOnCellMouseDown = options.selectOnCellMouseDown !== false;
    const clearOnDelete = options.clearOnDelete !== false;
    const selectAllOnCtrlA = options.selectAllOnCtrlA !== false;
    const copyOnCtrlC = options.copyOnCtrlC !== false;
    const getPosition = typeof options.getPosition === 'function'
      ? options.getPosition
      : (cell) => ({
        row: Number(cell?.dataset?.row ?? cell?.closest?.('[data-row]')?.dataset?.row),
        col: Number(cell?.dataset?.col ?? cell?.closest?.('[data-col]')?.dataset?.col)
      });
    const findCell = typeof options.findCell === 'function'
      ? options.findCell
      : (row, col) => Array.from(root.querySelectorAll(cellSelector)).find((cell) => {
        const position = getPosition(cell);
        return Number(position?.row) === Number(row) && Number(position?.col) === Number(col);
      });
    const selected = new Map();
    let activeCell = null;

    function keyFromPosition(position) {
      return `${position.row}:${position.col}`;
    }

    function allCells() {
      return Array.from(root.querySelectorAll(cellSelector));
    }

    function setActive(cell) {
      if (activeCell) activeCell.classList.remove(activeClass);
      activeCell = cell || null;
      if (activeCell) activeCell.classList.add(activeClass);
    }

    function clearSelection() {
      selected.forEach((cell) => cell.classList.remove(selectedClass));
      selected.clear();
    }

    function addCell(cell) {
      if (!cell) return;
      const position = getPosition(cell);
      if (!position || !Number.isFinite(position.row) || !Number.isFinite(position.col)) return;
      selected.set(keyFromPosition(position), cell);
      cell.classList.add(selectedClass);
      setActive(cell);
    }

    function selectCells(cells, append = false) {
      if (!append) clearSelection();
      normalizeElementList(cells).forEach(addCell);
      if (afterSelect) afterSelect(Array.from(selected.values()));
    }

    function selectColumn(col, append = false) {
      const targetCol = Number(col);
      const cells = allCells().filter((cell) => Number(getPosition(cell)?.col) === targetCol);
      selectCells(cells, append);
    }

    function selectAll() {
      selectCells(allCells());
    }

    function selectedPositions() {
      return Array.from(selected.values()).map((cell) => ({ cell, ...getPosition(cell) }));
    }

    function pasteText(text, startCell = activeCell) {
      const rows = parseClipboardTable(text);
      const start = getPosition(startCell) || selectedPositions().sort((a, b) => a.row - b.row || a.col - b.col)[0];
      if (!rows.length || !start || !Number.isFinite(start.row) || !Number.isFinite(start.col)) return false;

      rows.forEach((row, rowIndex) => {
        row.forEach((value, colIndex) => {
          const cell = findCell(start.row + rowIndex, start.col + colIndex, startCell);
          if (cell) setCellValue(cell, value, start.row + rowIndex, start.col + colIndex);
        });
      });

      if (afterPaste) afterPaste(rows, start);
      return true;
    }

    function clearSelectedCells() {
      const cells = selected.size ? Array.from(selected.values()) : normalizeElementList(activeCell);
      cells.forEach((cell) => setCellValue(cell, ''));
      if (afterClear) afterClear(cells);
    }

    function copySelectedCells() {
      const positions = selectedPositions().sort((a, b) => a.row - b.row || a.col - b.col);
      if (!positions.length) return '';
      const minRow = Math.min(...positions.map((position) => position.row));
      const minCol = Math.min(...positions.map((position) => position.col));
      const maxRow = Math.max(...positions.map((position) => position.row));
      const maxCol = Math.max(...positions.map((position) => position.col));
      const grid = [];
      for (let row = minRow; row <= maxRow; row += 1) {
        const values = [];
        for (let col = minCol; col <= maxCol; col += 1) {
          const cell = selected.get(`${row}:${col}`);
          values.push(cell ? getCellValue(cell, row, col) : '');
        }
        grid.push(values);
      }
      return formatClipboardTable(grid);
    }

    function handleMouseDown(event) {
      const corner = event.target.closest?.(cornerSelector);
      if (corner && root.contains(corner)) {
        event.preventDefault();
        selectAll();
        return;
      }

      const column = event.target.closest?.(columnSelector);
      if (column && root.contains(column)) {
        const col = column.dataset.col ?? column.dataset.colSelect ?? column.dataset.selectColumn;
        if (col !== undefined) {
          event.preventDefault();
          selectColumn(col, event.ctrlKey || event.metaKey);
        }
        return;
      }

      const cell = event.target.closest?.(cellSelector);
      if (selectOnCellMouseDown && cell && root.contains(cell)) selectCells([cell], event.ctrlKey || event.metaKey);
    }

    function handlePaste(event) {
      if (event.defaultPrevented) return;
      const eventCell = event.target?.closest?.(cellSelector) || document.activeElement?.closest?.(cellSelector);
      if (eventCell && root.contains(eventCell)) setActive(eventCell);
      if (!activeCell && !selected.size) return;
      const text = event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text') || '';
      if (!text) return;
      if (pasteTextOverride) {
        if (pasteTextOverride(text, activeCell, event)) event.preventDefault();
        return;
      }
      if (pasteText(text)) event.preventDefault();
    }

    function handleKeyDown(event) {
      if (event.defaultPrevented) return;
      if (!activeCell && !selected.size) return;

      if (clearOnDelete && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        clearSelectedCells();
        return;
      }

      if (selectAllOnCtrlA && (event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'a') {
        event.preventDefault();
        selectAll();
        return;
      }

      if (copyOnCtrlC && (event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'c' && navigator.clipboard) {
        const text = copySelectedCells();
        if (text) {
          event.preventDefault();
          navigator.clipboard.writeText(text);
        }
      }
    }

    root.addEventListener('mousedown', handleMouseDown);
    root.addEventListener('paste', handlePaste);
    root.addEventListener('keydown', handleKeyDown);

    return {
      destroy() {
        root.removeEventListener('mousedown', handleMouseDown);
        root.removeEventListener('paste', handlePaste);
        root.removeEventListener('keydown', handleKeyDown);
      },
      selectCells,
      selectColumn,
      selectAll,
      clearSelection,
      clearSelectedCells,
      pasteText,
      copySelectedCells,
      getActiveCell: () => activeCell,
      getSelectedCells: () => Array.from(selected.values())
    };
  }

  window.CorralonFunciones = {
    deepClone,
    statesEqual,
    isUndoShortcut,
    createUndoStack,
    dispatchInputChange,
    parseClipboardTable,
    formatClipboardTable,
    isPrintableTypingKey,
    bindDropdownOnlyWhenTyping,
    bindDropdownF4,
    bindGridNavigation,
    bindTableSelectPaste
  };
})();
