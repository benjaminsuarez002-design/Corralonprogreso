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
    const smartCaret = options.smartCaret === true;
    const selectOnAnyFocus = options.selectOnAnyFocus === true;
    const selectOnFirstPointerFocus = options.selectOnFirstPointerFocus === true;
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

    function isTextControl(el) {
      return !!el?.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea');
    }

    function selectionIsComplete(el) {
      if (!isTextControl(el)) return false;
      const length = String(el.value || '').length;
      return el.selectionStart === 0 && el.selectionEnd === length;
    }

    function caretAllowsHorizontalMove(el, direction) {
      if (!smartCaret || !isTextControl(el)) return true;
      if (selectionIsComplete(el)) return true;
      const start = Number(el.selectionStart ?? 0);
      const end = Number(el.selectionEnd ?? start);
      if (start !== end) return false;
      return direction > 0 ? end >= String(el.value || '').length : start <= 0;
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
      if (event.key === 'Enter' && event.shiftKey && el.matches?.('textarea, [data-shift-enter-newline]')) return;
      if (isTextCaretKey(event)) return;
      if (event.key === 'ArrowRight' && !caretAllowsHorizontalMove(el, 1)) return;
      if (event.key === 'ArrowLeft' && !caretAllowsHorizontalMove(el, -1)) return;
      if (event.key === 'Enter' || event.key === 'Tab' || event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        moveFrom(el, event.shiftKey ? -1 : 1, event);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        moveFrom(el, -1, event);
      }
    }

    function handlePointerDown(event) {
      if (!selectOnFirstPointerFocus) return;
      const el = event.target?.closest?.(selector);
      if (!el || !root.contains(el) || !isTextControl(el) || el.disabled || el.readOnly) return;
      if (document.activeElement === el) return;
      event.preventDefault();
      el.focus?.();
      el.select?.();
    }

    function handleFocusIn(event) {
      if (!selectOnAnyFocus) return;
      const el = event.target?.closest?.(selector);
      if (!el || !root.contains(el) || !isTextControl(el)) return;
      el.select?.();
    }

    root.addEventListener('keydown', handleKeyDown);
    if (selectOnFirstPointerFocus) root.addEventListener('pointerdown', handlePointerDown);
    if (selectOnAnyFocus) root.addEventListener('focusin', handleFocusIn);

    return {
      destroy() {
        root.removeEventListener('keydown', handleKeyDown);
        if (selectOnFirstPointerFocus) root.removeEventListener('pointerdown', handlePointerDown);
        if (selectOnAnyFocus) root.removeEventListener('focusin', handleFocusIn);
      },
      focusFirst() {
        return focusControl(controls()[0]);
      }
    };
  }

  function parseLocaleNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
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
      const groupedThousands = separator === '.' && comma < 0 && /^\d{1,3}(?:\.\d{3})+$/.test(text);
      const separatorIsDecimal = !groupedThousands && (separator === ',' || digitsAfter.length !== 3 || text.indexOf(separator) !== decimalAt);
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
      if (options.preserveEmpty && !String(input.value || '').trim()) return;
      const previousCaret = input.selectionStart;
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
      let caret = output.length;
      if (options.fixedOnInput && previousCaret != null) {
        const comma = original.lastIndexOf(','), outputComma = output.indexOf(',');
        if (comma >= 0 && previousCaret > comma) caret = Math.min(output.length, outputComma + 1 + Math.min(decimals, previousCaret - comma - 1));
        else {
          const digitsBefore = original.slice(0, previousCaret).replace(/\D/g, '').length;
          let digits = 0; caret = 0;
          while (caret < (outputComma >= 0 ? outputComma : output.length) && digits < digitsBefore) { if (/\d/.test(output[caret])) digits++; caret++; }
        }
      }
      input.setSelectionRange?.(caret, caret);
    }

    root.addEventListener('input', (event) => {
      const input = event.target?.closest?.(selector);
      if (input && root.contains(input)) formatEditing(input, options.fixedOnInput === true);
    });
    if (options.fixedOnInput) root.addEventListener('keydown', event => {
      const input = event.target?.closest?.(selector);
      if (!input || ![',', '.'].includes(event.key) && event.code !== 'NumpadDecimal') return;
      const comma = input.value.indexOf(',');
      if (comma >= 0) { event.preventDefault(); input.setSelectionRange?.(comma + 1, comma + 1); }
    });
    root.addEventListener('focusin', (event) => {
      const input = event.target?.closest?.(selector);
      if (!input || !root.contains(input)) return;
      if (options.selectOnFocus === false) return;
      const end = String(input.value || '').replace(suffix, '').trim().length;
      input.setSelectionRange?.(0, end);
    });
    root.addEventListener('focusout', (event) => {
      const input = event.target?.closest?.(selector);
      if (input && root.contains(input)) formatEditing(input, true);
    });

    return { format: (input, fixed = true) => formatEditing(input, fixed) };
  }

  function rawCurrencyText(value, options = {}) {
    const decimals = Math.max(0, Number(options.decimals ?? 2));
    return parseLocaleNumber(value).toFixed(decimals).replace('.', ',');
  }

  function formatCurrencyText(value, options = {}) {
    const prefix = options.prefix ?? '$ ';
    return `${prefix}${formatLocaleNumber(value, { decimals: options.decimals ?? 2 })}`;
  }

  function bindRawCurrencySelection(options = {}) {
    const root = options.root || document;
    const selector = options.selector || '.money, .moneda, [data-currency], [data-money]';
    const selectedClass = options.selectedClass || 'currency-raw-selected';

    function getValue(element) {
      if (!element) return '';
      return element.matches?.('input, textarea') ? element.value : element.textContent;
    }

    function setValue(element, value) {
      if (!element) return;
      if (element.matches?.('input, textarea')) element.value = value;
      else element.textContent = value;
    }

    function selectElementText(element) {
      if (!element) return;
      element.focus?.({ preventScroll: true });
      if (typeof element.select === 'function') {
        element.select();
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function showRaw(element) {
      if (!element || !root.contains(element)) return;
      element.dataset.currencyFormatted = getValue(element);
      const raw = rawCurrencyText(getValue(element), options);
      element.dataset.currencyRaw = raw;
      setValue(element, raw);
      element.classList.add(selectedClass);
      element.style.textAlign = options.textAlign || 'right';
      selectElementText(element);
    }

    function restore(element) {
      if (!element || !root.contains(element)) return;
      const formatted = formatCurrencyText(getValue(element), options);
      element.dataset.currencyFormatted = formatted;
      element.dataset.currencyRaw = rawCurrencyText(getValue(element), options);
      setValue(element, formatted);
      element.classList.remove(selectedClass);
      if (options.restoreTextAlign !== false) element.style.textAlign = '';
    }

    root.addEventListener('focusin', (event) => {
      const element = event.target?.closest?.(selector);
      if (element) showRaw(element);
    });
    root.addEventListener('focusout', (event) => {
      const element = event.target?.closest?.(selector);
      if (element) restore(element);
    });
    root.addEventListener('click', (event) => {
      const element = event.target?.closest?.(selector);
      if (element) showRaw(element);
    });
    root.addEventListener('input', (event) => {
      const element = event.target?.closest?.(selector);
      if (!element || !root.contains(element)) return;
      element.dataset.currencyRaw = rawCurrencyText(getValue(element), options);
    });
    document.addEventListener('selectionchange', () => {
      root.querySelectorAll(`${selector}.${selectedClass}`).forEach((element) => {
        if (element.matches?.('input, textarea')) return;
        if (document.activeElement === element) return;
        restore(element);
      });
    });

    return { showRaw, restore, rawCurrencyText, formatCurrencyText };
  }

  function bindLabelSelect(options = {}) {
    const root = options.root || document;
    const labelSelector = options.labelSelector || 'label';
    const controlSelector = options.controlSelector || 'input, textarea, select';

    root.addEventListener('pointerdown', (event) => {
      const control = event.target?.closest?.(controlSelector);
      if (!control || !root.contains(control) || control.disabled) return;
      const belongsToLabel = control.closest?.(labelSelector) || control.labels?.length;
      if (!belongsToLabel || document.activeElement === control) return;
      event.preventDefault();
      control.focus?.({ preventScroll: true });
      if (typeof control.select === 'function' && control.type !== 'checkbox' && control.type !== 'radio') control.select();
    }, true);

    root.addEventListener('click', (event) => {
      const label = event.target?.closest?.(labelSelector);
      if (!label || !root.contains(label)) return;
      const control = label.htmlFor
        ? root.querySelector(`#${CSS.escape(label.htmlFor)}`)
        : label.querySelector(controlSelector) || label.nextElementSibling?.matches?.(controlSelector) && label.nextElementSibling;
      if (!control || control.disabled) return;
      const directControl = event.target?.closest?.(controlSelector);
      if (directControl === control) return;
      control.focus?.();
      if (typeof control.select === 'function' && control.type !== 'checkbox' && control.type !== 'radio') control.select();
    });
  }

  function bindShiftEnterNewLine(options = {}) {
    const root = options.root || document;
    const selector = options.selector || 'textarea, [data-shift-enter-newline]';

    function insertNewLine(field) {
      const value = String(field.value ?? '');
      const start = field.selectionStart ?? value.length;
      const end = field.selectionEnd ?? start;
      field.value = `${value.slice(0, start)}\n${value.slice(end)}`;
      const next = start + 1;
      field.setSelectionRange?.(next, next);
      dispatchInputChange(field);
    }

    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !event.shiftKey) return;
      const field = event.target?.closest?.(selector);
      if (!field || !root.contains(field) || field.disabled || field.readOnly) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      insertNewLine(field);
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
    let columnAnchor = null;

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

    function removeCell(cell) {
      if (!cell) return;
      const position = getPosition(cell);
      if (!position || !Number.isFinite(position.row) || !Number.isFinite(position.col)) return;
      selected.delete(keyFromPosition(position));
      cell.classList.remove(selectedClass);
      if (activeCell === cell) setActive(null);
    }

    function toggleCells(cells) {
      const targets = normalizeElementList(cells);
      const allSelected = targets.length > 0 && targets.every((cell) => {
        const position = getPosition(cell);
        return position && selected.has(keyFromPosition(position));
      });
      targets.forEach((cell) => allSelected ? removeCell(cell) : addCell(cell));
      if (afterSelect) afterSelect(Array.from(selected.values()));
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

    function toggleColumn(col) {
      const targetCol = Number(col);
      toggleCells(allCells().filter((cell) => Number(getPosition(cell)?.col) === targetCol));
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
      if (event.button !== 0) return;
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
          const targetCol = Number(col);
          if (event.shiftKey && Number.isFinite(columnAnchor)) {
            if (!(event.ctrlKey || event.metaKey)) clearSelection();
            const from = Math.min(columnAnchor, targetCol);
            const to = Math.max(columnAnchor, targetCol);
            for (let index = from; index <= to; index += 1) selectColumn(index, true);
          } else {
            if (event.ctrlKey || event.metaKey) toggleColumn(targetCol);
            else selectColumn(targetCol);
            columnAnchor = targetCol;
          }
        }
        return;
      }

      const cell = event.target.closest?.(cellSelector);
      if (selectOnCellMouseDown && cell && root.contains(cell)) {
        if (event.ctrlKey || event.metaKey) toggleCells([cell]);
        else selectCells([cell]);
      }
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

  function menuUserHasAccess(menuId) {
    const user = menuSessionUser();
    const wanted = String(menuId || '').trim();
    if (!user || !wanted) return false;
    const level = String(user.nivel || '').trim().toLowerCase();
    if (level === 'administrador') return true;
    if (level === 'vendedor') return ['lista', 'remitos', 'admin', 'garantias', 'historial'].includes(wanted);
    return Array.isArray(user.permisos) && user.permisos.map(String).includes(wanted);
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

  function evaluatePriceAdjustment(value, originalValue) {
    const text=String(value??'').trim();
    const formula=text.match(/^(-?\d[\d.,]*)\s*([+\-*/xX×])\s*(\d+(?:[.,]\d+)?)\s*(%)?$/);
    if(formula){
      const base=parseLocaleNumber(formula[1]),amount=Number(formula[3].replace(',','.')),op=formula[2];
      const operand=formula[4]?amount/100:amount;
      const result=op==='+'?base+(formula[4]?base*operand:operand):op==='-'?base-(formula[4]?base*operand:operand):op==='/'?(operand?base/operand:NaN):base*operand;
      return Number.isFinite(result)?Math.round((result+Number.EPSILON)*100)/100:NaN;
    }
    const match=text.match(/^([+-])\s*(\d+(?:[.,]\d+)?)\s*%$/)||text.match(/^([xX×*/])\s*(\d+(?:[.,]\d+)?)$/);
    if(!match)return NaN;
    const amount=Number(match[2].replace(',','.')),base=Number(originalValue);
    if(!Number.isFinite(amount)||!Number.isFinite(base))return NaN;
    const result=match[1]==='+'?base*(1+amount/100):match[1]==='-'?base*(1-amount/100):match[1]==='/'?(amount?base/amount:NaN):base*amount;
    return Math.round((result+Number.EPSILON)*100)/100;
  }

  function bindNumericExpressions(options = {}) {
    const root=options.root||document;
    const selector=options.selector||'input[type="number"],input[inputmode="decimal"],input[inputmode="numeric"],input[data-number-format],input[data-currency],input[data-money]';
    const states=new WeakMap();
    const field=event=>{const input=states.has(event.target)?event.target:event.target?.closest?.(selector);return input&&!input.readOnly&&!input.disabled&&!input.matches('[type="date"],[type="tel"]')?input:null;};
    const hasExpression=value=>/[+xX×*/]/.test(String(value))||/\d\s*-/.test(String(value))||/^\s*-.*%/.test(String(value));
    function remember(event){const input=field(event);if(input)states.set(input,{base:input.type==='number'?Number(input.value):parseLocaleNumber(input.value),value:input.value,type:input.type});}
    function commit(input){
      if(!hasExpression(input.value)){input.setCustomValidity('');return true;}
      const state=states.get(input)||{base:0,value:'',type:input.type};
      const value=evaluatePriceAdjustment(input.value.replace(/US\$|\$|€/g,'').trim(),state.base);
      if(!Number.isFinite(value)){input.setCustomValidity('Cuenta inválida. Usá +3%, x 1.03 o 100*1.03.');input.reportValidity();return false;}
      input.setCustomValidity('');
      const localized=state.type!=='number'&&/[,€$%]/.test(state.value);
      input.value=value.toFixed(2).replace('.',localized?',':'.');
      if(state.type==='number')input.type='number';
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;
    }
    function onInput(event){const input=field(event);if(!input)return;input.setCustomValidity('');if(hasExpression(input.value)){event.stopImmediatePropagation();}}
    function onKey(event){
      const input=field(event);if(!input)return;
      if(input.type==='number'&&['+','x','X','*','/','%'].includes(event.key)){if(!states.has(input))remember(event);input.type='text';}
      if(['Enter','Tab'].includes(event.key)&&!commit(input)){event.preventDefault();event.stopImmediatePropagation();}
    }
    function onBlur(event){const input=field(event);if(input)commit(input);}
    root.addEventListener('focusin',remember,true);root.addEventListener('input',onInput,true);root.addEventListener('keydown',onKey,true);root.addEventListener('blur',onBlur,true);
    return {commit,destroy(){root.removeEventListener('focusin',remember,true);root.removeEventListener('input',onInput,true);root.removeEventListener('keydown',onKey,true);root.removeEventListener('blur',onBlur,true);}};
  }

  function bindIncrementalRendering(options = {}) {
    const root=options.root,batchSize=Math.max(1,Number(options.batchSize)||120);
    const getTotal=options.getTotal,renderRange=options.renderRange;
    let count=0;
    function ensure(minimum){
      const total=Math.max(0,Number(getTotal())||0);
      const target=Math.min(total,Math.ceil(Math.max(0,minimum)/batchSize)*batchSize);
      if(target>count){const start=count;count=target;renderRange(start,target,start===0);options.afterRender?.(count,total);}
      return count;
    }
    function reset(){
      count=0;root.scrollTop=0;
      if(!getTotal()){renderRange(0,0,true);options.afterRender?.(0,0);}else ensure(batchSize);
    }
    function onScroll(){if(root.scrollHeight-root.scrollTop-root.clientHeight<=Number(options.threshold??40))ensure(count+batchSize);}
    root.addEventListener('scroll',onScroll,{passive:true});
    return {reset,ensure,getCount:()=>count,destroy:()=>root.removeEventListener('scroll',onScroll)};
  }

  let imagePreviewDialog = null;
  function openImagePreview(src, options = {}) {
    if (!src) return false;
    if (!imagePreviewDialog?.isConnected) {
      imagePreviewDialog = document.createElement('dialog');
      imagePreviewDialog.setAttribute('aria-label','Imagen ampliada');
      imagePreviewDialog.style.cssText='width:min(1200px,96vw);height:94dvh;max-width:96vw;max-height:94dvh;padding:0;border:0;border-radius:10px;background:#181818;overflow:hidden;color:#fff';
      imagePreviewDialog.innerHTML='<div style="position:relative;width:100%;height:100%"><img alt="" style="display:block;width:100%;height:100%;object-fit:contain"><button type="button" aria-label="Cerrar imagen ampliada" style="position:absolute;right:10px;top:10px;min-height:36px;padding:4px 12px;border:1px solid #777;border-radius:8px;background:#fff;color:#171717;font-weight:700;cursor:pointer">Cerrar ×</button></div>';
      imagePreviewDialog.querySelector('button').addEventListener('click',()=>imagePreviewDialog.close());
      imagePreviewDialog.addEventListener('click',event=>{if(event.target===imagePreviewDialog)imagePreviewDialog.close();});
      imagePreviewDialog.addEventListener('keydown',event=>{
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();imagePreviewDialog.close();}
      });
      imagePreviewDialog.addEventListener('close',()=>{
        imagePreviewDialog.querySelector('img').removeAttribute('src');
        imagePreviewDialog.returnFocus?.focus?.({preventScroll:true});
      });
      document.body.append(imagePreviewDialog);
    }
    imagePreviewDialog.returnFocus=options.returnFocus || document.activeElement;
    const image=imagePreviewDialog.querySelector('img');
    image.src=src; image.alt=options.alt || 'Imagen ampliada';
    if(!imagePreviewDialog.open)imagePreviewDialog.showModal();
    imagePreviewDialog.querySelector('button').focus();
    return true;
  }

  // Restore only the current field's value when Escape is pressed.
  function bindCuit(field) {
    field.type = 'tel'; field.inputMode = 'numeric'; field.maxLength = 13;
    field.placeholder = '00-00000000-0'; field.pattern = '[0-9]{2}-[0-9]{8}-[0-9]';
    field.title = 'CUIT de 11 dígitos: 00-00000000-0';
    function format() {
      const caret = field.selectionStart, before = String(field.value).slice(0, caret ?? field.value.length).replace(/\D/g, '').length;
      const digits = String(field.value).replace(/\D/g, '').slice(0, 11);
      field.value = digits.slice(0, 2) + (digits.length > 2 ? '-' + digits.slice(2, 10) : '') + (digits.length > 10 ? '-' + digits.slice(10) : '');
      const position = Math.min(field.value.length, before + (before > 2 ? 1 : 0) + (before > 10 ? 1 : 0));
      field.setSelectionRange?.(position, position);
    }
    field.addEventListener('input', format); field.addEventListener('blur', format);
    return { format };
  }

  function parseCurrencyNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const text = String(value ?? '').replace(/[^\d,-]/g, '');
    const number = Number(text.replace(',', '.'));
    return Number.isFinite(number) ? number : 0;
  }

  function bindLiveCurrency(options = {}) {
    const root = options.root || document, selector = options.selector || '[data-number-format="currency"]';
    root.addEventListener('input', event => {
      const input = event.target.closest?.(selector); if (!input || input.disabled || input.readOnly) return;
      const text = input.value.replace(/[^\d,-]/g, ''), negative = text.startsWith('-') ? '-' : '';
      const parts = text.replace(/-/g, '').split(','), integer = parts[0].replace(/^0+(?=\d)/, '');
      input.value = integer || parts.length > 1 ? `$ ${negative}${(integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${parts.length > 1 ? ',' + parts[1].slice(0, 2) : ''}` : '';
    });
    root.addEventListener('keydown', event => {
      const input = event.target.closest?.(selector);
      if (input && event.code === 'NumpadDecimal') {
        event.preventDefault(); input.setRangeText(',', input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  function bindEditableTable(options = {}) {
    const root = options.root, selector = options.selector || 'input[data-field]', rowSelector = options.rowSelector || 'tbody tr';
    const selected = new Set(), history = []; let anchor = null, session = null, restoring = false, movement = 0;
    const rowKey = row => row?.dataset.row;
    const rowNodes = () => Array.from(root.querySelectorAll(rowSelector));
    const fields = row => Array.from(row.querySelectorAll(selector)).filter(field => !field.disabled && !field.closest('[hidden]'));
    const snapshot = key => deepClone(options.readRow(key));
    function paint() { rowNodes().forEach(row => row.classList.toggle('is-selected-row', selected.has(rowKey(row)))); }
    function finish() {
      if (!session || restoring) return;
      if (!statesEqual(session.before, options.readRow(session.key))) history.push(session);
      session = null;
    }
    function restore(state) {
      restoring = true; session = null;
      try {
        options.restoreRow(state.key, deepClone(state.before));
        const row = rowNodes().find(item => rowKey(item) === state.key);
        const field = row && fields(row).find(item => item.dataset.field === state.column);
        if (field) { field.focus(); field.select?.(); session = { ...state, before: snapshot(state.key), movement: ++movement }; }
        paint();
      } finally { restoring = false; }
    }
    root.addEventListener('focusin', event => {
      const field = event.target.closest(selector); if (!field || restoring) return;
      finish(); const key = rowKey(field.closest(rowSelector));
      session = { key, column: field.dataset.field, before: snapshot(key), movement: ++movement };
    });
    root.addEventListener('focusout', event => {
      if (event.target.matches(selector)) { event.target.classList.remove('table-text-editing'); finish(); }
    });
    root.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const row = event.target.closest(rowSelector); if (!row) return;
      const key = rowKey(row), list = rowNodes().map(rowKey);
      if (event.shiftKey && anchor !== null) {
        if (!event.ctrlKey && !event.metaKey) selected.clear();
        const start = list.indexOf(anchor), end = list.indexOf(key);
        if (start >= 0) list.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(id => selected.add(id));
      } else if (event.ctrlKey || event.metaKey) {
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        anchor = key;
      } else { selected.clear(); selected.add(key); anchor = key; }
      paint(); event.target.closest(selector)?.classList.add('table-text-editing');
    });
    root.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.target.disabled || event.target.readOnly) return;
      const field = event.target.closest(selector);
      if (event.key === 'Escape' && session) { event.preventDefault(); event.stopPropagation(); restore(session); return; }
      if (isUndoShortcut(event)) {
        event.preventDefault(); event.stopPropagation();
        if (session && !statesEqual(session.before, options.readRow(session.key))) restore(session);
        else { finish(); const previous = history.pop(); if (previous) restore(previous); }
        return;
      }
      if (event.key === 'Delete' && (selected.size || event.target.closest(rowSelector))) {
        event.preventDefault(); event.stopPropagation(); session = null;
        const current = rowKey(event.target.closest(rowSelector));
        const keys = selected.has(current) ? Array.from(selected) : current ? [current] : Array.from(selected);
        options.deleteRows(keys); selected.clear(); return;
      }
      if (!field || !['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const list = rowNodes(), row = field.closest(rowSelector), cells = fields(row), r = list.indexOf(row), c = cells.indexOf(field);
      const complete = field.selectionStart === 0 && field.selectionEnd === field.value.length;
      if (event.key === 'ArrowLeft' && !complete && field.selectionStart !== 0) return;
      if (event.key === 'ArrowRight' && !complete && field.selectionEnd !== field.value.length) return;
      let target;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const next = event.ctrlKey ? (event.key === 'ArrowUp' ? 0 : list.length - 1) : r + (event.key === 'ArrowUp' ? -1 : 1);
        target = list[next] && fields(list[next])[c];
      } else if (event.ctrlKey && event.key.startsWith('Arrow')) target = cells[event.key === 'ArrowLeft' ? 0 : cells.length - 1];
      else {
        const step = event.key === 'ArrowLeft' || event.shiftKey ? -1 : 1;
        target = cells[c + step];
        if (!target) { const next = list[r + step]; target = next ? fields(next)[step > 0 ? 0 : fields(next).length - 1] : step > 0 ? options.newRowTarget?.() : null; }
      }
      if (target) { event.preventDefault(); event.stopPropagation(); target.focus(); target.select?.(); target.scrollIntoView?.({ block: 'nearest' }); }
    });
    return { clearSelection() { selected.clear(); paint(); }, finish };
  }

  function bindFieldRestore(options = {}) {
    const root=options.root||document, selector=options.selector||'input,textarea,select', originals=new WeakMap();
    function remember(event){const field=event.target;if(field.matches?.(selector))originals.set(field,{value:field.value,checked:field.checked});}
    function restore(event){
      const field=event.target;
      if(event.defaultPrevented || event.key!=='Escape' || !field.matches?.(selector) || field.readOnly || field.disabled)return;
      const previous=originals.get(field);if(!previous)return;
      event.preventDefault();field.value=previous.value;if(field.type==='checkbox')field.checked=previous.checked;
      field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));field.select?.();
    }
    root.addEventListener('focusin',remember);root.addEventListener('keydown',restore);
    return {destroy(){root.removeEventListener('focusin',remember);root.removeEventListener('keydown',restore);}};
  }
  function formatComprobanteNumber(value) {
    const text=String(value ?? '').trim();
    if(!text)return '';
    const parts=text.match(/^(\d{1,4})\s*-\s*(\d{1,8})$/);
    if(parts)return parts[1].padStart(4,'0')+'-'+parts[2].padStart(8,'0');
    if(/^\d{1,12}$/.test(text)) {
      const digits=text.padStart(12,'0');
      return digits.slice(0,4)+'-'+digits.slice(4);
    }
    return text;
  }
  function bindComprobanteNumber(field) {
    const commit=()=>{if(!field.readOnly && !field.disabled)field.value=formatComprobanteNumber(field.value);};
    field.addEventListener('change',commit);
    field.addEventListener('blur',commit);
    return {commit,destroy(){field.removeEventListener('change',commit);field.removeEventListener('blur',commit);}};
  }
  let clipboardTextRequest = null;
  function requestClipboardText() {
    if(clipboardTextRequest)return clipboardTextRequest;
    clipboardTextRequest=(async()=>{
      if(navigator.clipboard?.readText){
        try{return await navigator.clipboard.readText();}catch(_){}
      }
      // HTTP on the local network has no Clipboard API. Native paste remains available.
      return await new Promise(resolve=>{
        const previous=document.activeElement, dialog=document.createElement('dialog');
        dialog.style.cssText='width:min(520px,94vw);padding:16px;border:1px solid #ccc;border-radius:10px;background:var(--panel,#fff);color:var(--text,#171717);font:inherit';
        dialog.innerHTML='<strong>Pegar tabla</strong><p>Pegá acá con Ctrl + V o mantené presionado y elegí Pegar.</p><textarea aria-label="Pegar tabla del portapapeles" rows="4" style="width:100%;box-sizing:border-box;font:inherit"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" data-cancel>Cancelar</button><button type="button" data-accept>Pegar</button></div>';
        document.body.append(dialog);
        const input=dialog.querySelector('textarea');let settled=false;
        function finish(value){if(settled)return;settled=true;dialog.close();dialog.remove();previous?.focus?.();resolve(value);}
        input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain');if(text){event.preventDefault();event.stopPropagation();finish(text);}});
        dialog.querySelector('[data-cancel]').onclick=()=>finish(null);
        dialog.querySelector('[data-accept]').onclick=()=>{if(input.value.trim())finish(input.value);else input.focus();};
        dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
        dialog.addEventListener('close',()=>{if(!settled)finish(null);});
        dialog.showModal();input.focus();
      });
    })().finally(()=>{clipboardTextRequest=null;});
    return clipboardTextRequest;
  }
  window.CorralonFunciones = {
    formatComprobanteNumber,
    bindComprobanteNumber,
    requestClipboardText,
    bindFieldRestore,
    bindEditableTable,
    bindLiveCurrency,
    parseCurrencyNumber,
    bindCuit,
    openImagePreview,
    evaluatePriceAdjustment,
    bindNumericExpressions,
    bindIncrementalRendering,
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
    rawCurrencyText,
    formatCurrencyText,
    bindRawCurrencySelection,
    bindLabelSelect,
    bindShiftEnterNewLine,
    menuSessionUser,
    isMenuSessionActive,
    menuUserHasAccess,
    presupuestoMediosPago,
    normalizePresupuestoDatos
  };
  bindNumericExpressions();
})();
