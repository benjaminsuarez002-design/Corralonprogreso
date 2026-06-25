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

  function parseFechaFlexible(value, now = new Date()) {
    const parts = String(value || '').trim().replace(/\s+/g, '/').split(/[\/-]/).filter(Boolean);
    if (!parts.length) return null;
    const day = Number(parts[0]);
    const month = Number(parts[1] || (now.getMonth() + 1));
    let year = Number(parts[2] || now.getFullYear());
    if (year < 100) year += 2000;
    if (!day || !month || day < 1 || day > 31 || month < 1 || month > 12) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return {
      date,
      day,
      month,
      year,
      text: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
    };
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
    const suppressEnterAfterDelete = options.suppressEnterAfterDelete === true;
    const focusedClass = options.focusedClass || '';
    let focusedInput = null;
    const deletedInputs = new WeakSet();

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

      if (suppressEnterAfterDelete && (event.key === 'Delete' || event.key === 'Supr') && isOpen && isOpen(input)) {
        deletedInputs.add(input);
        return;
      }

      if (event.key === 'Enter' && isOpen && isOpen(input) && pickActive) {
        event.preventDefault();
        if (suppressEnterAfterDelete && deletedInputs.has(input)) {
          deletedInputs.delete(input);
          hideDropdown(input, 'delete-enter', event);
          return;
        }
        const picked = pickActive(input, event);
        if (picked === false && enterPicksFirst && pickFirst) pickFirst(input, event);
        return;
      }

      if (event.key === 'Enter' && isOpen && isOpen(input) && enterPicksFirst && pickFirst) {
        event.preventDefault();
        if (suppressEnterAfterDelete && deletedInputs.has(input)) {
          deletedInputs.delete(input);
          hideDropdown(input, 'delete-enter', event);
          return;
        }
        pickFirst(input, event);
        return;
      }

      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && isOpen && isOpen(input) && moveActive) {
        event.preventDefault();
        if (suppressEnterAfterDelete) deletedInputs.delete(input);
        moveActive(input, event.key === 'ArrowDown' ? 1 : -1, event);
        return;
      }

      if (suppressEnterAfterDelete && isPrintableTypingKey(event)) deletedInputs.delete(input);

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

  function bindLinearNavigation(options = {}) {
    const root = options.root || document;
    const selector = options.selector || 'input, textarea, select, button, [tabindex]';
    const selectOnFocus = options.selectOnFocus !== false;
    const navigateLeftRight = options.navigateLeftRight === true;
    const wrap = options.wrap === true;

    function visible(el) {
      if (!el || el.disabled || el.hidden) return false;
      if (el.closest?.('.hidden,[hidden]')) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function controls() {
      return Array.from(root.querySelectorAll(selector)).filter(visible);
    }

    function focusControl(el) {
      if (!el) return false;
      el.focus?.();
      if (selectOnFocus && typeof el.select === 'function') el.select();
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return true;
    }

    function isTextCaretKey(event) {
      if (navigateLeftRight) return false;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
      const tag = event.target?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA';
    }

    function moveFrom(el, step, event) {
      const list = controls();
      const index = list.indexOf(el);
      if (index < 0) return false;
      let next = index + step;
      if (wrap) next = (next + list.length) % list.length;
      const target = list[next];
      if (!target) return false;
      if (focusControl(target)) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return true;
      }
      return false;
    }

    function handleKeyDown(event) {
      if (event.defaultPrevented) return;
      const el = event.target?.closest?.(selector);
      if (!el || !root.contains(el)) return;
      if (event.key === 'F2' && typeof el.select === 'function') {
        event.preventDefault();
        const allSelected = el.selectionStart === 0 && el.selectionEnd === String(el.value || '').length;
        if (allSelected) {
          const end = String(el.value || '').length;
          el.setSelectionRange(end, end);
        } else {
          el.select();
        }
        return;
      }
      if (isTextCaretKey(event)) return;
      if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        moveFrom(el, event.shiftKey ? -1 : 1, event);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        moveFrom(el, -1, event);
      }
    }

    root.addEventListener('keydown', handleKeyDown);

    return {
      destroy() {
        root.removeEventListener('keydown', handleKeyDown);
      },
      focusFirst() {
        return focusControl(controls()[0]);
      }
    };
  }

  function parseLocaleNumber(value) {
    let text = String(value ?? '').trim().replace(/[^\d.,-]/g, '');
    if (!text) return 0;
    const negative = text.startsWith('-');
    text = text.replace(/-/g, '');
    const comma = text.lastIndexOf(',');
    const dot = text.lastIndexOf('.');
    const decimalAt = Math.max(comma, dot);
    let integer = text;
    let decimal = '';
    if (decimalAt >= 0) {
      const separator = text[decimalAt];
      const digitsAfter = text.slice(decimalAt + 1).replace(/\D/g, '');
      const separatorIsDecimal = separator === ',' || digitsAfter.length !== 3 || text.indexOf(separator) !== decimalAt;
      if (separatorIsDecimal) {
        integer = text.slice(0, decimalAt);
        decimal = digitsAfter;
      }
    }
    integer = integer.replace(/\D/g, '') || '0';
    const number = Number(`${negative ? '-' : ''}${integer}.${decimal || '0'}`);
    return Number.isFinite(number) ? number : 0;
  }

  function evaluateNumericExpression(value) {
    const source = String(value ?? '').trim();
    if (!source) return 0;
    const clean = source
      .replace(/\$/g, '')
      .replace(/\s+/g, '')
      .replace(/[−–—]/g, '-');

    if (!/[+\-*/()%]/.test(clean.replace(/^-/, ''))) return parseLocaleNumber(clean);

    let index = 0;
    const peek = () => clean[index] || '';
    const eat = (char) => {
      if (peek() === char) {
        index += 1;
        return true;
      }
      return false;
    };

    function readNumber() {
      const start = index;
      while (/[\d.,]/.test(peek())) index += 1;
      if (start === index) return 0;
      return parseLocaleNumber(clean.slice(start, index));
    }

    function factor() {
      let sign = 1;
      while (peek() === '+' || peek() === '-') {
        if (eat('-')) sign *= -1;
        else eat('+');
      }

      let valueOut;
      if (eat('(')) {
        valueOut = expression();
        eat(')');
      } else {
        valueOut = readNumber();
      }

      valueOut *= sign;
      while (eat('%')) valueOut /= 100;
      return valueOut;
    }

    function term() {
      let valueOut = factor();
      while (peek() === '*' || peek() === '/') {
        const op = peek();
        index += 1;
        const right = factor();
        valueOut = op === '*' ? valueOut * right : (right ? valueOut / right : 0);
      }
      return valueOut;
    }

    function expression() {
      let valueOut = term();
      while (peek() === '+' || peek() === '-') {
        const op = peek();
        index += 1;
        const rightStart = index;
        const right = term();
        const rightText = clean.slice(rightStart, index);
        const isRelativePercent = /%$/.test(rightText) && !/[*/]/.test(rightText);
        const delta = isRelativePercent ? valueOut * right : right;
        valueOut = op === '+' ? valueOut + delta : valueOut - delta;
      }
      return valueOut;
    }

    const result = expression();
    return Number.isFinite(result) ? result : 0;
  }

  function formatLocaleNumber(value, options = {}) {
    const decimals = Math.max(0, Number(options.decimals ?? 2));
    const suffix = String(options.suffix || '');
    return `${parseLocaleNumber(value).toLocaleString('es-AR', {
      minimumFractionDigits: options.fixed === false ? 0 : decimals,
      maximumFractionDigits: decimals
    })}${suffix}`;
  }

  function bindLiveLocaleNumber(options = {}) {
    const root = options.root || document;
    const selector = options.selector || '[data-live-number]';
    const decimals = Math.max(0, Number(options.decimals ?? 2));
    const suffix = String(options.suffix || '');

    function formatEditing(input, fixed = false) {
      const original = String(input.value || '').replace(suffix, '').trim();
      const numericText = original.replace(/[^\d.,-]/g, '');
      const trailingDecimal = /[.,]$/.test(numericText);
      const match = numericText.match(/[.,](\d*)$/);
      const typedDecimals = match ? match[1].slice(0, decimals) : '';
      const number = parseLocaleNumber(numericText);
      const displayNumber = fixed ? number : Math.trunc(number);
      let output = displayNumber.toLocaleString('es-AR', {
        minimumFractionDigits: fixed ? decimals : 0,
        maximumFractionDigits: fixed ? decimals : 0
      });
      if (!fixed && (trailingDecimal || match)) output += `,${typedDecimals}`;
      input.value = `${output}${suffix}`;
      const caret = output.length;
      input.setSelectionRange?.(caret, caret);
    }

    root.addEventListener('input', (event) => {
      const input = event.target?.closest?.(selector);
      if (input && root.contains(input)) formatEditing(input, false);
    });
    root.addEventListener('focusin', (event) => {
      const input = event.target?.closest?.(selector);
      if (!input || !root.contains(input)) return;
      const end = String(input.value || '').replace(suffix, '').trim().length;
      input.setSelectionRange?.(0, end);
    });
    root.addEventListener('focusout', (event) => {
      const input = event.target?.closest?.(selector);
      if (input && root.contains(input)) formatEditing(input, true);
    });

    return { format: (input, fixed = true) => formatEditing(input, fixed) };
  }

  function bindLabelSelect(options = {}) {
    const root = options.root || document;
    const labelSelector = options.labelSelector || 'label';
    const controlSelector = options.controlSelector || 'input, textarea, select';

    root.addEventListener('click', (event) => {
      const label = event.target?.closest?.(labelSelector);
      if (!label || !root.contains(label)) return;
      const control = label.htmlFor
        ? root.querySelector(`#${CSS.escape(label.htmlFor)}`)
        : label.querySelector(controlSelector) || label.nextElementSibling?.matches?.(controlSelector) && label.nextElementSibling;
      if (!control || control.disabled) return;
      control.focus?.();
      if (typeof control.select === 'function' && control.type !== 'checkbox' && control.type !== 'radio') control.select();
    });
  }

  function createVirtualTableNavigator(options = {}) {
    const viewport = options.viewport;
    const rowsRoot = options.rowsRoot || options.root || document;
    const rowHeight = Math.max(1, Number(options.rowHeight || 24));
    const cellSelector = options.cellSelector || '[data-col]';
    const colCount = Math.max(1, Number(options.colCount || 1));
    const requestSlice = typeof options.requestSlice === 'function' ? options.requestSlice : null;
    const onPositionChange = typeof options.onPositionChange === 'function' ? options.onPositionChange : null;
    const onPendingChange = typeof options.onPendingChange === 'function' ? options.onPendingChange : null;
    const focusRendered = typeof options.focusRendered === 'function' ? options.focusRendered : null;
    const getTotal = typeof options.getTotal === 'function' ? options.getTotal : () => Number(options.total || 0);
    const getCell = typeof options.getCell === 'function'
      ? options.getCell
      : (row, col) => rowsRoot?.querySelector?.(`[data-match-index="${row}"] [data-col="${col}"]`);
    const getRowIndex = typeof options.getRowIndex === 'function'
      ? options.getRowIndex
      : (cell) => Number(cell?.closest?.('[data-match-index]')?.dataset?.matchIndex);
    const getCol = typeof options.getCol === 'function'
      ? options.getCol
      : (cell) => Number(cell?.dataset?.col);
    let pending = null;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function activeCell() {
      return document.activeElement?.closest?.(cellSelector) || null;
    }

    function setPending(value) {
      pending = value;
      if (onPendingChange) onPendingChange(pending);
    }

    function scrollIndexIntoView(row, fromRow = null) {
      if (!viewport) return false;
      const viewTop = viewport.scrollTop;
      const direction = Number.isFinite(fromRow) ? Math.sign(row - fromRow) : 0;
      const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const current = activeCell();

      if (current && direction) {
        const currentRow = current.closest?.('[data-match-index], .row');
        const rowRect = currentRow?.getBoundingClientRect?.();
        const viewportRect = viewport.getBoundingClientRect?.();
        if (rowRect && viewportRect) {
          const topWall = viewportRect.top + 1;
          const bottomWall = viewportRect.top + viewport.clientHeight - 1;
          let nextTop = null;
          if (direction > 0 && rowRect.bottom >= bottomWall) nextTop = viewTop + rowHeight;
          else if (direction < 0 && rowRect.top <= topWall) nextTop = viewTop - rowHeight;
          if (nextTop !== null) {
            viewport.scrollTop = clamp(nextTop, 0, maxTop);
            return Math.abs(viewport.scrollTop - viewTop) >= 1;
          }
        }
      }

      const viewBottom = viewTop + viewport.clientHeight;
      const targetTop = row * rowHeight;
      const targetBottom = targetTop + rowHeight;
      const fromTop = Number.isFinite(fromRow) ? fromRow * rowHeight : targetTop;
      const fromBottom = fromTop + rowHeight;
      let nextTop = viewTop;
      if (direction > 0 && fromBottom >= viewBottom - 1) nextTop = viewTop + rowHeight;
      else if (direction < 0 && fromTop <= viewTop + 1) nextTop = viewTop - rowHeight;
      else if (targetTop < viewTop) nextTop = targetTop;
      else if (targetBottom > viewBottom) nextTop = targetBottom - viewport.clientHeight;
      if (Math.abs(nextTop - viewTop) < 1) return false;
      viewport.scrollTop = clamp(nextTop, 0, maxTop);
      return true;
    }

    function focusCell(row = 0, col = 0, fromRow = null) {
      const total = Math.max(0, Number(getTotal()) || 0);
      if (!total) return false;
      const nextRow = clamp(Number(row) || 0, 0, total - 1);
      const nextCol = clamp(Number(col) || 0, 0, colCount - 1);
      if (onPositionChange) onPositionChange(nextRow, nextCol);
      const didScroll = scrollIndexIntoView(nextRow, fromRow);
      setPending({ row: nextRow, col: nextCol });
      if (didScroll) {
        if (requestSlice) requestSlice();
        return true;
      }
      const rendered = focusRendered
        ? focusRendered(nextRow, nextCol)
        : (getCell(nextRow, nextCol)?.focus?.(), Boolean(getCell(nextRow, nextCol)));
      if (rendered) {
        setPending(null);
        return true;
      }
      if (viewport) viewport.scrollTop = nextRow * rowHeight;
      if (requestSlice) requestSlice();
      return true;
    }

    function focusPending() {
      if (!pending) return false;
      const rendered = focusRendered
        ? focusRendered(pending.row, pending.col)
        : (getCell(pending.row, pending.col)?.focus?.(), Boolean(getCell(pending.row, pending.col)));
      if (rendered) {
        setPending(null);
        return true;
      }
      return false;
    }

    function moveFromCell(cell, rowDelta, colDelta, event) {
      if (!cell) return false;
      const row = getRowIndex(cell);
      const col = getCol(cell);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return false;
      const moved = focusCell(row + rowDelta, col + colDelta, row);
      if (moved) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
      }
      return moved;
    }

    function moveFromActive(event) {
      const delta = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0]
      }[event?.key];
      if (!delta) return false;
      return moveFromCell(activeCell(), delta[0], delta[1], event);
    }

    return {
      focusCell,
      focusPending,
      moveFromActive,
      moveFromCell,
      scrollIndexIntoView,
      getPending: () => pending
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

  function bindTableSort(options = {}) {
    const root = options.root || document;
    const headerSelector = options.headerSelector || '[data-sort-key]';
    const sort = typeof options.sort === 'function' ? options.sort : null;
    const activeClass = options.activeClass || 'sort-active';
    const ascClass = options.ascClass || 'sort-asc';
    const descClass = options.descClass || 'sort-desc';
    let currentKey = options.initialKey || '';
    let currentDir = options.initialDir || 'asc';

    function applyHeaderState() {
      root.querySelectorAll(headerSelector).forEach((header) => {
        const active = header.dataset.sortKey === currentKey;
        header.classList.toggle(activeClass, active);
        header.classList.toggle(ascClass, active && currentDir === 'asc');
        header.classList.toggle(descClass, active && currentDir === 'desc');
      });
    }

    function setSort(key, dir = null) {
      if (!key) return;
      if (dir) {
        currentKey = key;
        currentDir = dir;
      } else if (currentKey !== key) {
        currentKey = key;
        currentDir = 'asc';
      } else if (currentDir === 'asc') {
        currentDir = 'desc';
      } else {
        currentKey = '';
        currentDir = '';
      }
      applyHeaderState();
      if (sort) sort(currentKey, currentDir);
    }

    function handleClick(event) {
      const header = event.target.closest?.(headerSelector);
      if (!header || !root.contains(header)) return;
      event.preventDefault();
      setSort(header.dataset.sortKey);
    }

    root.addEventListener('click', handleClick);
    applyHeaderState();

    return {
      destroy() {
        root.removeEventListener('click', handleClick);
      },
      setSort,
      getState: () => ({ key: currentKey, dir: currentDir })
    };
  }

  function bindResizableColumns(options = {}) {
    const root = options.root || document;
    const handleSelector = options.handleSelector || '.col-resizer';
    const headerSelector = options.headerSelector || '[data-resize-col]';
    const storageKey = options.storageKey || '';
    const widths = Array.isArray(options.widths) ? options.widths : [];
    const minWidth = Number(options.minWidth || 58);
    const resizingClass = options.resizingClass || 'resizing-columns';
    const apply = typeof options.apply === 'function' ? options.apply : null;
    const getIndex = typeof options.getIndex === 'function'
      ? options.getIndex
      : (header) => Number(header?.dataset?.resizeCol);

    function applyWidths() {
      if (apply) apply(widths);
    }

    function load() {
      if (!storageKey) {
        applyWidths();
        return;
      }
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (Array.isArray(saved)) saved.forEach((width, index) => {
          if (Number(width) > 20) widths[index] = Number(width);
        });
      } catch {}
      applyWidths();
    }

    function save() {
      if (!storageKey) return;
      localStorage.setItem(storageKey, JSON.stringify(widths));
    }

    function handleMouseDown(event) {
      const handle = event.target.closest?.(handleSelector);
      if (!handle || !root.contains(handle)) return;
      const header = handle.closest?.(headerSelector);
      const index = getIndex(header);
      if (!Number.isFinite(index)) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = Number(widths[index] || header.getBoundingClientRect().width || minWidth);
      document.body.classList.add(resizingClass);
      const onMove = (moveEvent) => {
        widths[index] = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
        applyWidths();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove(resizingClass);
        save();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    root.addEventListener('mousedown', handleMouseDown);
    load();

    return {
      destroy() {
        root.removeEventListener('mousedown', handleMouseDown);
      },
      load,
      save,
      apply: applyWidths,
      widths
    };
  }

  const MENU_KEEP_LOGIN_KEY = 'historial_keep_logged_v1';
  const MENU_ACTIVE_USER_KEY = 'corralon_menu_active_user_v1';
  const MENU_ACTIVE_USER_SNAPSHOT_KEY = 'corralon_menu_active_user_snapshot_v1';
  const MENU_ACTIVE_USER_SESSION_KEY = 'corralon_menu_active_user_session_v1';

  function storageValue(storage, key) {
    try { return storage?.getItem?.(key) || ''; } catch { return ''; }
  }

  function storageJson(storage, key) {
    try {
      const raw = storageValue(storage, key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function menuSessionUser() {
    const sessionUser = storageJson(sessionStorage, MENU_ACTIVE_USER_SESSION_KEY);
    if (sessionUser?.id) return sessionUser;
    const keepLogged = storageValue(localStorage, MENU_KEEP_LOGIN_KEY) === '1';
    const activeId = storageValue(localStorage, MENU_ACTIVE_USER_KEY).trim();
    if (!keepLogged || !activeId) return null;
    const snapshot = storageJson(localStorage, MENU_ACTIVE_USER_SNAPSHOT_KEY);
    return snapshot?.id === activeId ? snapshot : { id: activeId };
  }

  function isMenuSessionActive() {
    return Boolean(menuSessionUser());
  }

  const PRESUPUESTO_MEDIOS_PAGO = [
    'Banco santander',
    'Cheques',
    'Cta. Cte.',
    'Dolares',
    'Efectivo',
    'Getnet',
    'Lapos',
    'Mercado Pago',
    'Transf Bria.',
    'Transf prov',
    'Vale'
  ];

  function presupuestoMediosPago() {
    return PRESUPUESTO_MEDIOS_PAGO.slice();
  }

  function normalizePresupuestoDatos(datos = {}) {
    return {
      nombre: String(datos.nombre || '').trim(),
      medioPago: String(datos.medioPago || '').trim(),
      nota: String(datos.nota || '').trim()
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
    parseFechaFlexible,
    isPrintableTypingKey,
    bindDropdownOnlyWhenTyping,
    bindDropdownF4,
    bindGridNavigation,
    createVirtualTableNavigator,
    bindTableSelectPaste,
    bindTableSort,
    bindResizableColumns,
    bindLinearNavigation,
    parseLocaleNumber,
    evaluateNumericExpression,
    formatLocaleNumber,
    bindLiveLocaleNumber,
    bindLabelSelect,
    menuSessionUser,
    isMenuSessionActive,
    presupuestoMediosPago,
    normalizePresupuestoDatos
  };
})();
