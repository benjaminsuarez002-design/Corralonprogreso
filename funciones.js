(function () {
  function createUuid() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

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
    const weekday=String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),weekdays=['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
    if(weekdays.includes(weekday)){const recent=new Date(now.getFullYear(),now.getMonth(),now.getDate());recent.setDate(recent.getDate()-(recent.getDay()-weekdays.indexOf(weekday)+7)%7);return parseFechaFlexible(recent.getDate()+'/'+(recent.getMonth()+1)+'/'+recent.getFullYear(),now);}
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
        if (options.advanceOnEnter !== true) event.preventDefault();
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
    if (buttonSelector) root.addEventListener(options.buttonEvent || 'mousedown', handleButtonMouseDown);

    return {
      destroy() {
        root.removeEventListener('focusin', handleFocusIn);
        root.removeEventListener('focusout', handleFocusOut);
        root.removeEventListener('input', handleInput);
        root.removeEventListener('keydown', handleKeyDown);
        if (buttonSelector) root.removeEventListener(options.buttonEvent || 'mousedown', handleButtonMouseDown);
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

  function focusField(element, options = {}) {
    if (!element || element.disabled || element.hidden || element.closest?.('[hidden]')) return false;
    element.focus?.();
    if (options.select !== false && typeof element.select === 'function') element.select();
    if (options.keyboardClass) element.classList.add(options.keyboardClass);
    element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (typeof options.openDropdown === 'function') options.openDropdown(element);
    else if (options.openDropdown === true && typeof element.showPicker === 'function') {
      try { element.showPicker(); } catch { /* El teclado sigue disponible si el navegador exige otro gesto. */ }
    }
    return true;
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
      if(options.modalScope){const modal=root.querySelector('dialog[open]');if(modal&&!modal.contains(el))return false;}
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
          el.setSelectionRange(end, end);if(el.closest('tbody'))el.classList.add('table-text-editing');
        } else {
          el.select();if(el.closest('tbody'))el.classList.remove('table-text-editing');
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

  function evaluateBasicArithmetic(value) {
    const text=String(value??'').replace(/\$/g,'').replace(/\s+/g,'').replace(/[−–—]/g,'-');
    if(!text)return 0;
    let at=0;
    const invalid=()=>{throw new Error('Cuenta inválida. Usá números y +, -, * o /.');};
    function factor(){
      if(text[at]==='+'){at++;return factor();}
      if(text[at]==='-'){at++;return -factor();}
      if(text[at]==='('){at++;const result=sum();if(text[at++]!==')')invalid();return result;}
      const match=text.slice(at).match(/^(?:\d[\d.,]*|[.,]\d+)/);
      if(!match || /[.,]$/.test(match[0]))invalid();
      at+=match[0].length;
      const result=parseLocaleNumber(match[0]);if(!Number.isFinite(result))invalid();return result;
    }
    function product(){let result=factor();while(text[at]==='*'||text[at]==='/'){const op=text[at++],right=factor();if(op==='/'&&right===0)throw new Error('No se puede dividir por cero.');result=op==='*'?result*right:result/right;}return result;}
    function sum(){let result=product();while(text[at]==='+'||text[at]==='-'){const op=text[at++],right=product();result=op==='+'?result+right:result-right;}return result;}
    const result=sum();if(at!==text.length||!Number.isFinite(result))invalid();return result;
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
      if (control.tagName === 'SELECT') return;
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
        const input=event.target;if(input.matches?.('input,textarea')&&input.selectionStart!==input.selectionEnd)return;
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
    const firstDirection = key => options.firstDirectionByKey?.[key] === 'desc' ? 'desc' : 'asc';

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
        currentDir = firstDirection(key);
      } else if (currentDir === firstDirection(key)) {
        currentDir = currentDir === 'asc' ? 'desc' : 'asc';
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
      reset() {
        currentKey = ''; currentDir = '';
        applyHeaderState();
        if (sort) sort('', '');
      },
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

  function menuUserIsAdministrator(menuId, user = menuSessionUser()) {
    const wanted=String(menuId||'').trim();
    if(!user||!wanted)return false;
    if(String(user.nivel||'').trim().toLowerCase()==='administrador')return true;
    return Array.isArray(user.permisos)&&user.permisos.includes(wanted)&&Array.isArray(user.permisosEdicion)&&user.permisosEdicion.includes(wanted);
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
    if (level === 'vendedor') return ['lista', 'remitos', 'admin', 'garantias', 'historial'].includes(wanted)||(wanted==='historial_movimiento'&&Array.isArray(user.permisos)&&user.permisos.includes(wanted));
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
    const field=event=>{const input=states.has(event.target)?event.target:event.target?.closest?.(selector);return input&&!input.readOnly&&!input.disabled&&!input.matches('[type="date"],[type="tel"],[data-date],[data-number-expression="off"]')?input:null;};
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
    root.addEventListener('focusin',remember,true);root.addEventListener('input',onInput,true);root.addEventListener('keydown',onKey,true);root.addEventListener('blur',onBlur,true);if(options.commitOnChange)root.addEventListener('change',onBlur,true);
    return {commit,destroy(){root.removeEventListener('focusin',remember,true);root.removeEventListener('input',onInput,true);root.removeEventListener('keydown',onKey,true);root.removeEventListener('blur',onBlur,true);if(options.commitOnChange)root.removeEventListener('change',onBlur,true);}};
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
      const original=input.value,caret=input.selectionStart;
      const tokensBeforeCaret=(original.slice(0,caret??original.length).match(/[\d,-]/g)||[]).length;
      const text = input.value.replace(/[^\d,-]/g, ''), negative = text.startsWith('-') ? '-' : '';
      const parts = text.replace(/-/g, '').split(','), integer = parts[0].replace(/^0+(?=\d)/, '');
      input.value = integer || parts.length > 1 ? `$ ${negative}${(integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${parts.length > 1 ? ',' + parts[1].slice(0, 2) : ''}` : negative;
      if(options.preserveCaret&&caret!=null){
        let position=0,tokens=0;
        while(position<input.value.length&&tokens<tokensBeforeCaret){if(/[\d,-]/.test(input.value[position]))tokens++;position++;}
        input.setSelectionRange(position,position);
      }

    });
    if(options.fixedOnBlur)root.addEventListener('blur',event=>{
      const input=event.target.closest?.(selector);
      if(input&&!input.disabled&&!input.readOnly&&input.value.trim())input.value=new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(parseLocaleNumber(input.value));
    },true);
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
      if (event.defaultPrevented || event.target.disabled) return;
      if(event.target.readOnly&&(event.key==='Escape'||isUndoShortcut(event)))return;
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
    return { clearSelection() { selected.clear(); paint(); }, resetHistory(){session=null;history.length=0;selected.clear();paint();}, finish };
  }

  function bindFlexibleDates(options = {}) {
    const root = options.root || document, selector = options.selector || '[data-date]';
    root.querySelectorAll(selector).forEach(field => { field.dataset.date = ''; });
    function normalize(event) {
      const field = event.target;
      if (!field.matches?.(selector) || (event.type === 'keydown' && !['Enter', 'Tab'].includes(event.key))) return;
      const parsed = parseFechaFlexible(field.value);
      if (parsed) { field.value = parsed.text; field.setCustomValidity(''); }
    }
    root.addEventListener('blur', normalize, true);
    root.addEventListener('keydown', normalize, true);
    return { destroy() { root.removeEventListener('blur', normalize, true); root.removeEventListener('keydown', normalize, true); } };
  }

  function bindTextDropdown(options = {}) {
    const input = options.input, items = options.items || [];
    const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const wrapper = document.createElement('span');
    wrapper.style.cssText = `position:relative;display:block;min-width:${options.minWidth ?? 200}px`;
    input.before(wrapper); wrapper.append(input);
    input.style.width = '100%'; input.style.paddingRight = '30px';
    input.autocomplete = 'off'; input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false');
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.tabIndex = -1; toggle.textContent = '▾'; toggle.setAttribute('aria-label', 'Desplegar opciones');
    toggle.style.cssText = 'position:absolute;right:2px;top:2px;bottom:2px;height:auto;min-height:0;line-height:1;padding:0 7px;visibility:visible;opacity:0';
    const menu = document.createElement('div'); menu.hidden = true; menu.setAttribute('role', 'listbox');
    menu.style.cssText = 'position:absolute;top:100%;left:0;min-width:100%;max-height:240px;overflow:auto;z-index:100;background:white;border:1px solid #bbb;box-shadow:0 4px 12px #0003';
    menu.style.zIndex=String(options.zIndex||100);
    wrapper.append(toggle, menu);
    if(options.fixedMenu)document.body.append(menu);
    let matches = [], active = 0, selectedItem = items.find(item=>String(item.value)===String(options.selectedValue)) || null;
    const hide = () => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    let renderMatches=null,rendered=0;
    const pager=options.batchSize?bindIncrementalRendering({root:menu,batchSize:options.batchSize,getTotal:()=>matches.length,renderRange:(from,to)=>{if(renderMatches)for(let index=from;index<to;index++)renderMatches(matches[index],index);rendered=to;}}):null;
    function mark() {
      pager?.ensure(active+1);
      const rows=Array.from(menu.querySelectorAll('[data-index]'));
      rows.forEach((row, index) => { row.style.background = index === active ? '#ef1015' : 'white'; row.style.color = index === active ? 'white' : '#222'; row.setAttribute('aria-selected', String(index === active)); });
      rows[active]?.scrollIntoView({ block: 'nearest', inline:'nearest' });
    }
    function show(_, reason) {
      if(options.fixedMenu){const rect=input.getBoundingClientRect(),width=Math.min(Math.max(rect.width,options.menuWidth||0),Math.max(1,window.innerWidth-16));menu.style.position='fixed';menu.style.top=rect.bottom+'px';menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+'px';menu.style.width=width+'px';menu.style.minWidth=width+'px';menu.style.maxHeight=Math.max(80,Math.min(240,window.innerHeight-rect.bottom-10))+'px';}
      const query = reason === 'typing' || reason === 'typing-key' ? normalize(input.value) : '';
      matches = items.filter(item => !query || (options.match?options.match(item,query):normalize(item.searchText||item.label).includes(query)) || normalize(item.value) === query);
      active = 0; menu.replaceChildren();
      const columns=options.columns||[],grid=columns.map(column=>`${column.width||100}px`).join(' '),gridWidth=columns.reduce((sum,column)=>sum+(column.width||100),20);
      function fillColumns(row,cells){row.style.cssText=`display:grid;grid-template-columns:${grid};min-width:${gridWidth}px;padding:6px 10px;white-space:nowrap;font-size:12px;cursor:pointer`;cells.forEach((value,index)=>{const cell=document.createElement('span');cell.textContent=String(value??'');cell.title=cell.textContent;cell.style.cssText=`overflow:hidden;text-overflow:ellipsis;padding:0 5px;text-align:${columns[index]?.align||'left'}`;row.append(cell);});}
      if(columns.length){const heading=document.createElement('div');fillColumns(heading,columns.map(column=>column.label));heading.style.cssText+=';position:sticky;top:0;z-index:1;font-weight:700;cursor:default;'+(options.headerStyle||'background:#171717;color:white');menu.append(heading);}
      renderMatches=(item, index) => {
        const row = document.createElement('div'); row.setAttribute('role', 'option'); row.dataset.index = index;
        if(columns.length)fillColumns(row,item.cells||[item.label]);else{row.textContent=item.label;row.style.cssText='padding:7px 10px;white-space:nowrap;cursor:pointer';}menu.append(row);
      };
      if(pager)pager.reset();else matches.forEach(renderMatches);
      if (!matches.length) { const empty = document.createElement('div'); empty.textContent = 'Sin coincidencias'; empty.style.padding = '7px 10px'; menu.append(empty); }
      menu.hidden = false; input.setAttribute('aria-expanded', 'true'); mark();
    }
    function pick() {
      if (!input.value.trim()) { hide(); return false; }
      const item = matches[active]; if (!item) return false;
      selectedItem = item;
      input.value = item.label; input.setCustomValidity(''); hide(); input.dispatchEvent(new Event('change', { bubbles: true })); return true;
    }
    toggle.addEventListener('mousedown',event=>event.preventDefault());
    const bindings = bindDropdownOnlyWhenTyping({ root: wrapper, inputSelector: 'input', buttonSelector: 'button', buttonEvent:'click', show, hide, isOpen: () => !menu.hidden, advanceOnEnter: options.advanceOnEnter !== false,
      pickActive: pick, enterPicksFirst: false, moveActive: (_, step) => { active = Math.max(0, Math.min(matches.length - 1, active + step)); mark(); } });
    wrapper.onmouseenter = () => { toggle.style.opacity = '1'; };
    wrapper.onmouseleave = () => { toggle.style.opacity = '0'; };
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) hide(); });
    menu.addEventListener('mousedown', event => {
      const row = event.target.closest('[data-index]'); if (!row) return;
      event.preventDefault(); active = Number(row.dataset.index); input.value = matches[active].label; pick(); input.focus();
    });
    const outside = event => { if (!wrapper.contains(event.target) && !menu.contains(event.target)) hide(); };
    document.addEventListener('pointerdown', outside);
    return {
      setValue(value) { selectedItem = items.find(item=>String(item.value)===String(value)) || null; input.value=selectedItem?.label || ''; },
      getValue() { const query = normalize(input.value); if (!query) return options.emptyValue ?? ''; if(selectedItem && normalize(selectedItem.label)===query)return selectedItem.value; return items.find(item => normalize(item.label) === query || normalize(item.value) === query)?.value ?? null; },
      destroy() { pager?.destroy(); bindings.destroy(); document.removeEventListener('pointerdown', outside); if(options.fixedMenu)menu.remove(); }
    };
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
    root.addEventListener('focusin',remember);root.addEventListener('keydown',restore,options.capture === true);
    return {destroy(){root.removeEventListener('focusin',remember);root.removeEventListener('keydown',restore,options.capture === true);}};
  }
  function formatComprobanteNumber(value, options = {}) {
    const text=String(value ?? '').trim();
    if(!text)return '';
    const parts=text.match(/^(\d{1,4})\s*-\s*(\d{1,8})$/);
    if(parts)return parts[1].padStart(4,'0')+'-'+parts[2].padStart(8,'0');
    if(/^\d{1,12}$/.test(text)) {
      if(text.length <= 8 && options.defaultPoint) return String(options.defaultPoint).padStart(4,'0')+'-'+text.padStart(8,'0');
      const digits=text.padStart(12,'0');
      return digits.slice(0,4)+'-'+digits.slice(4);
    }
    return text;
  }
  function bindComprobanteNumber(field, options = {}) {
    const commit=()=>{if(!field.readOnly && !field.disabled)field.value=formatComprobanteNumber(field.value, options);};
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
  let loadingAnimationHideTimer = null;
  function ensureLoadingAnimation() {
    let indicator = document.getElementById('corralonArticleSyncIndicator');
    if (indicator) return indicator;
    const style = document.createElement('style');
    style.id = 'corralonArticleSyncIndicatorStyle';
    style.textContent = `
      #corralonArticleSyncIndicator {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        width: min(330px, calc(100vw - 40px));
        padding: 12px 14px 13px;
        border: 1px solid #c9c9c9;
        border-radius: 13px;
        background: rgba(255,255,255,.98);
        color: #171717;
        box-shadow: 0 12px 32px rgba(0,0,0,.22);
        font: 700 13px/1.25 Arial, sans-serif;
        opacity: 0;
        visibility: hidden;
        transform: translateY(12px);
        transition: opacity .18s ease, transform .18s ease, visibility .18s ease;
        pointer-events: none;
      }
      #corralonArticleSyncIndicator.is-visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      #corralonArticleSyncIndicator .corralon-sync-copy {
        display: flex;
        align-items: center;
        gap: 9px;
        margin-bottom: 9px;
      }
      #corralonArticleSyncIndicator .corralon-sync-dot {
        width: 9px;
        height: 9px;
        flex: 0 0 9px;
        border-radius: 50%;
        background: #f20d18;
        box-shadow: 0 0 0 4px rgba(242,13,24,.12);
      }
      #corralonArticleSyncIndicator .corralon-sync-track {
        height: 5px;
        overflow: hidden;
        border-radius: 999px;
        background: #e4e4e4;
      }
      #corralonArticleSyncIndicator .corralon-sync-fill {
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: #f20d18;
        transform: translateX(-120%);
      }
      #corralonArticleSyncIndicator.is-syncing .corralon-sync-fill {
        animation: corralonArticleSyncProgress 1.05s ease-in-out infinite;
      }
      #corralonArticleSyncIndicator.is-success .corralon-sync-dot,
      #corralonArticleSyncIndicator.is-success .corralon-sync-fill {
        background: #159447;
      }
      #corralonArticleSyncIndicator.is-success .corralon-sync-dot {
        box-shadow: 0 0 0 4px rgba(21,148,71,.12);
      }
      #corralonArticleSyncIndicator.is-success .corralon-sync-fill {
        width: 100%;
        transform: translateX(0);
      }
      #corralonArticleSyncIndicator.is-error .corralon-sync-fill {
        width: 100%;
        transform: translateX(0);
      }
      @keyframes corralonArticleSyncProgress {
        0% { transform: translateX(-120%); }
        55% { transform: translateX(105%); }
        100% { transform: translateX(245%); }
      }
    `;
    document.head.appendChild(style);
    indicator = document.createElement('div');
    indicator.id = 'corralonArticleSyncIndicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.innerHTML = `
      <div class="corralon-sync-copy">
        <span class="corralon-sync-dot"></span>
        <span data-corralon-sync-text>Sincronizando en segundo plano…</span>
      </div>
      <div class="corralon-sync-track"><div class="corralon-sync-fill"></div></div>
      <button type="button" data-corralon-sync-retry hidden style="margin-top:8px;padding:4px 10px;border:1px solid #aaa;border-radius:6px;background:#fff;cursor:pointer;pointer-events:auto">Reintentar</button>
      <button type="button" data-corralon-sync-cancel hidden style="margin-top:8px;padding:4px 10px;border:1px solid #aaa;border-radius:6px;background:#fff;cursor:pointer;pointer-events:auto">Cancelar</button>
    `;
    document.body.appendChild(indicator);
    return indicator;
  }

  function animacionCarga(state, message, options = {}) {
    const indicator = ensureLoadingAnimation();
    const container=options.container||document.body;if(indicator.parentElement!==container)container.append(indicator);
    const text = indicator.querySelector('[data-corralon-sync-text]');
    clearTimeout(loadingAnimationHideTimer);
    indicator.classList.remove('is-syncing', 'is-success', 'is-error');
    indicator.classList.add('is-visible', `is-${state}`);
    if (text) text.textContent = message;
    const fill=indicator.querySelector('.corralon-sync-fill');
    const determinate=Number.isFinite(options.progress);
    fill.style.animation=determinate ? 'none' : '';
    fill.style.width=determinate ? `${Math.max(0,Math.min(100,options.progress))}%` : '';
    fill.style.transform=determinate ? 'translateX(0)' : '';
    const retry=indicator.querySelector('[data-corralon-sync-retry]');
    retry.hidden=!options.retry;retry.onclick=()=>options.retry?.();
    const cancel=indicator.querySelector('[data-corralon-sync-cancel]');
    cancel.hidden=!options.cancel;cancel.onclick=()=>options.cancel?.();
    if ((state === 'success' || state === 'error') && !options.retry) {
      loadingAnimationHideTimer = setTimeout(() => {
        indicator.classList.remove('is-visible');
      }, state === 'success' ? 1700 : 5000);
    }
  }


  // Menú único de la aplicación. Lista de precios y documentos de impresión no lo montan.
  const systemMenuMarkup="<nav id=\"systemMenu\" hidden=\"\" aria-label=\"Menú del sistema\"><header><img src=\"logo-corralon.png\" alt=\"Corralón Progreso\"><button id=\"systemNotificationsBell\" type=\"button\" hidden=\"\" aria-label=\"Notificaciones\" title=\"Notificaciones\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4\"></path></svg><span data-notification-count=\"\">0</span></button><button type=\"button\" id=\"systemMenuClose\" aria-label=\"Cerrar menú\">×</button></header><span class=\"system-menu-caption\">NAVEGACIÓN</span><div class=\"system-menu-group\"><div class=\"system-menu-card\"><button type=\"button\" data-system-section=\"invoice\" aria-current=\"page\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8\"></path></svg></span><span>Facturación</span></button><button id=\"systemInvoiceExpand\" type=\"button\" aria-label=\"Desplegar opciones de Facturación\" aria-expanded=\"false\" aria-controls=\"systemInvoiceSubmenu\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div id=\"systemInvoiceSubmenu\" hidden=\"\"><button type=\"button\" data-system-section=\"invoice-consult\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button></div></div><div class=\"system-menu-group\" data-system-receipts-group=\"\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-system-section=\"receipts\" id=\"systemReceiptsOption\" hidden=\"\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M3 7V3h15v4M3 7h18v14H3zM15 11h6v6h-6z\"></path></svg></span><span>Recibos de cobro</span></button><button id=\"systemReceiptsExpand\" type=\"button\" aria-label=\"Desplegar opciones de Recibos de cobro\" aria-expanded=\"false\" aria-controls=\"systemReceiptsSubmenu\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div id=\"systemReceiptsSubmenu\" hidden=\"\"><button type=\"button\" data-system-section=\"receipts-consult\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button></div></div><div class=\"system-menu-group\" data-system-caja-group=\"\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-system-section=\"caja\" id=\"systemCajaOption\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M4 8h16v13H4zM7 3h10v5H7zM8 12h8M8 16h3M15 16h1\"></path></svg></span><span>Control de caja</span></button><button id=\"systemCajaExpand\" type=\"button\" aria-label=\"Desplegar opciones de Control de caja\" aria-expanded=\"false\" aria-controls=\"systemCajaSubmenu\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div id=\"systemCajaSubmenu\" hidden=\"\"><button type=\"button\" data-system-section=\"caja-consult\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button><button type=\"button\" data-system-section=\"caja-additional\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6\"></path></svg><span>Opciones adicionales</span></button><button type=\"button\" data-system-section=\"caja-collections\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M3 7h18v14H3zM3 7V3h15v4M15 11h6v6h-6z\"></path></svg><span>Cobranzas en caja</span></button></div></div><div class=\"system-menu-group\" data-sql-group=\"compras\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-sql-module=\"compras\" hidden=\"\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8\"></path></svg></span><span>Cargar facturas</span></button><button type=\"button\" data-sql-expand=\"compras\" aria-label=\"Desplegar opciones de Cargar facturas\" aria-expanded=\"false\" aria-controls=\"sqlSubmenu-compras\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div class=\"system-sql-submenu\" id=\"sqlSubmenu-compras\" hidden=\"\"><button type=\"button\" data-sql-module=\"compras\" data-sql-view=\"cuentas\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Ctas. Ctes.</span></button><button type=\"button\" data-sql-module=\"compras\" data-sql-view=\"iva\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>IVA Compras</span></button><button type=\"button\" data-sql-module=\"compras\" data-sql-view=\"consultar\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button></div></div><div class=\"system-menu-group\" data-sql-group=\"pagos\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-sql-module=\"pagos\" hidden=\"\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8\"></path></svg></span><span>Pagos a proveedores</span></button><button type=\"button\" data-sql-expand=\"pagos\" aria-label=\"Desplegar opciones de Pagos a proveedores\" aria-expanded=\"false\" aria-controls=\"sqlSubmenu-pagos\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div class=\"system-sql-submenu\" id=\"sqlSubmenu-pagos\" hidden=\"\"><button type=\"button\" data-sql-module=\"pagos\" data-sql-view=\"cuentas\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Ctas. Ctes.</span></button><button type=\"button\" data-sql-module=\"pagos\" data-sql-view=\"consultar\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button></div></div><div class=\"system-menu-group\" data-sql-group=\"stock\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-sql-module=\"stock\" hidden=\"\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8\"></path></svg></span><span>Cargar stock</span></button><button type=\"button\" data-sql-expand=\"stock\" aria-label=\"Desplegar opciones de Cargar stock\" aria-expanded=\"false\" aria-controls=\"sqlSubmenu-stock\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div class=\"system-sql-submenu\" id=\"sqlSubmenu-stock\" hidden=\"\"><button type=\"button\" data-sql-module=\"stock\" data-sql-view=\"consultar\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button><button type=\"button\" data-sql-module=\"stock\" data-sql-view=\"articulo\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M4 3h16v18H4zM8 7h8M8 12h8M8 17h5\"></path></svg><span>Movimientos por artículo</span></button></div></div><div class=\"system-menu-group\" data-sql-group=\"proveedores\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-sql-module=\"proveedores\" hidden=\"\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8\"></path></svg></span><span>Proveedores SQL</span></button><button type=\"button\" data-sql-expand=\"proveedores\" aria-label=\"Desplegar opciones de Proveedores SQL\" aria-expanded=\"false\" aria-controls=\"sqlSubmenu-proveedores\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div class=\"system-sql-submenu\" id=\"sqlSubmenu-proveedores\" hidden=\"\"><button type=\"button\" data-sql-module=\"proveedores\" data-sql-view=\"consultar\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button><button type=\"button\" data-sql-module=\"proveedores\" data-sql-view=\"informe\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Informe</span></button></div></div><div class=\"system-menu-group\" data-sql-group=\"articulos\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-sql-module=\"articulos\" hidden=\"\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8\"></path></svg></span><span>Artículos</span></button><button type=\"button\" data-sql-expand=\"articulos\" aria-label=\"Desplegar opciones de Artículos\" aria-expanded=\"false\" aria-controls=\"sqlSubmenu-articulos\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div class=\"system-sql-submenu\" id=\"sqlSubmenu-articulos\" hidden=\"\"><button type=\"button\" data-sql-module=\"articulos\" data-sql-view=\"consultar\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button></div></div><div class=\"system-menu-group\" data-sql-group=\"tarjetas\" hidden=\"\"><div class=\"system-menu-card\"><button type=\"button\" data-sql-module=\"tarjetas\" hidden=\"\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8\"></path></svg></span><span>Ventas con tarjeta</span></button><button type=\"button\" data-sql-expand=\"tarjetas\" aria-label=\"Desplegar opciones de Ventas con tarjeta\" aria-expanded=\"false\" aria-controls=\"sqlSubmenu-tarjetas\"><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></button></div><div class=\"system-sql-submenu\" id=\"sqlSubmenu-tarjetas\" hidden=\"\"><button type=\"button\" data-sql-module=\"tarjetas\" data-sql-view=\"informe\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Informe</span></button><button type=\"button\" data-sql-module=\"tarjetas\" data-sql-view=\"consultar\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><circle cx=\"10\" cy=\"10\" r=\"7\"></circle><path d=\"m15 15 6 6\"></path></svg><span>Consultar</span></button></div></div><a href=\"menu.html\"><span class=\"system-menu-icon\"><svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"></rect><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"></rect><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"></rect><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"></rect></svg></span><span>Menú principal</span><span class=\"system-menu-chevron\" aria-hidden=\"true\">›</span></a><footer>Corralón Progreso<small><i aria-hidden=\"true\"></i>Sistema de gestión</small></footer></nav>";
  let sharedSystemMenu=null;
  function ensureSystemMenu(){
    let menu=document.getElementById('systemMenu');document.body.classList.add('corralon-sidebar-enabled');if(menu)return menu;
    let backdrop=document.getElementById('systemMenuBackdrop');if(!backdrop){backdrop=document.createElement('div');backdrop.id='systemMenuBackdrop';backdrop.hidden=true;document.body.append(backdrop);}
    const template=document.createElement('template');template.innerHTML=systemMenuMarkup;menu=template.content.firstElementChild;document.body.append(menu);return menu;
  }
  function initializeSystemMenu({integrated=false}={}){
    if(sharedSystemMenu)return sharedSystemMenu;
    if(window.CorralonSidebarMenu?.open)return sharedSystemMenu=window.CorralonSidebarMenu;
    
const menu=ensureSystemMenu();
if(!integrated)menu.addEventListener('click',event=>{const target=event.target.closest('[data-sql-module]');if(!target)return;event.preventDefault();const url='gestion.html#sql/'+target.dataset.sqlModule+(target.dataset.sqlView?'/'+target.dataset.sqlView:'');if(event.ctrlKey||event.metaKey)window.open(url,'_blank','noopener');else location.href=url;});
const entries=[{"id": "lista", "html": "<a data-system-web=\"lista\" href=\"index.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Lista de precios</span></a>"}, {"id": "a_descontar", "html": "<a data-system-web=\"a_descontar\" href=\"index.html#adescontar\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 21L20 3 M6 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M18 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6\"/></svg></span><span>A descontar</span></a>"}, {"id": "remitos", "html": "<a data-system-web=\"remitos\" href=\"remitos.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 5h12v12H2z M14 10h4l4 5v2h-8 M7 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M21 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0\"/></svg></span><span>Remitos</span></a>"}, {"id": "historial", "html": "<a data-system-web=\"historial\" href=\"historial.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 12a9 9 0 1 0 3-7 L3 8 M3 3v5h5 M12 7v6l4 2\"/></svg></span><span>Historial</span></a>"}, {"id": "comprobantes", "html": "<a data-system-web=\"comprobantes\" href=\"comprobantes.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Comprobantes</span></a>"}, {"id": "faltantes", "html": "<a data-system-web=\"faltantes\" href=\"faltantes.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Faltantes</span></a>"}, {"id": "pedidos", "html": "<a data-system-web=\"pedidos\" href=\"pedidos.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Pedidos</span></a>"}, {"id": "tarjetas", "html": "<a data-system-web=\"tarjetas\" href=\"tarjetas.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 5h20v15H2z M2 9h20 M5 15h5\"/></svg></span><span>Tarjetas</span></a>"}, {"id": "actualizar_articulos", "html": "<a data-system-web=\"actualizar_articulos\" href=\"actualizar articulos.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2l10 5v11l-10 5-10-5V7z M2 7l10 5 10-5 M12 12v11\"/></svg></span><span>Actualizar artículos</span></a>"}, {"id": "proveedores", "html": "<a data-system-web=\"proveedores\" href=\"proveedores.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M2 22v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 15a5 5 0 0 1 3 5\"/></svg></span><span>Proveedores</span></a>"}, {"id": "listas_proveedores", "html": "<a data-system-web=\"listas_proveedores\" href=\"listasproveedores.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7h17l-5-5 M21 17H4l5 5 M20 7l-5 5 M4 17l5-5\"/></svg></span><span>Comparar listas</span></a>"}, {"id": "diferencias_proveedores", "html": "<a data-system-web=\"diferencias_proveedores\" href=\"diferencias-proveedores.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7h17l-5-5 M21 17H4l5 5 M20 7l-5 5 M4 17l5-5\"/></svg></span><span>Diferencias proveedores</span></a>"}, {"id": "admin", "html": "<a data-system-web=\"admin\" href=\"soloadmin.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3 M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10\"/></svg></span><span>Administrar página</span></a>"}, {"id": "garantias", "html": "<a data-system-web=\"garantias\" href=\"garantías.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2l9 4v7c0 5-9 10-9 10S3 18 3 13V6z M12 5v14\"/></svg></span><span>Garantías</span></a>"}, {"id": "usuarios", "html": "<a data-system-web=\"usuarios\" href=\"usuarios.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M2 22v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 15a5 5 0 0 1 3 5\"/></svg></span><span>Usuarios</span></a>"}, {"id": "calculadoras", "html": "<a data-system-web=\"calculadoras\" href=\"calculadoras.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 2h14v20H5z M8 5h8v4H8z M8 13h1 M12 13h1 M16 13h1 M8 17h1 M12 17h1 M16 17h1\"/></svg></span><span>Calculadoras</span></a>"}, {"id": "configuracion", "html": "<a data-system-web=\"configuracion\" href=\"configuracion.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3 M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10\"/></svg></span><span>Configuración</span></a>"}],defaults=["lista", "a_descontar", "remitos", "historial", "comprobantes", "caja", "faltantes", "pedidos", "facturacion", "recibos_cobro", "cargar_facturas", "proveedores_sql", "ventas_tarjeta", "tarjetas", "actualizar_articulos", "carga_stock", "articulos_sql", "proveedores", "listas_proveedores", "diferencias_proveedores", "admin", "garantias", "usuarios", "calculadoras", "configuracion"];
const caption=document.createElement('span');caption.className='system-menu-caption';caption.textContent='WEB';caption.hidden=true;
const web=document.createElement('div');web.className='system-web-links';web.hidden=true;web.innerHTML=entries.map(item=>item.html).join('');
const main=menu.querySelector('a[href="menu.html"]');menu.insertBefore(caption,main);menu.insertBefore(web,main);
const sql=[...menu.querySelectorAll(':scope>.system-menu-group')];
const ids=['facturacion','recibos_cobro','caja','cargar_facturas','pagos_proveedores','carga_stock','proveedores_sql','articulos_sql','ventas_tarjeta'];
sql.forEach((group,i)=>group.dataset.sidebarOrderId=ids[i]);
const stockHistorySource=menu.querySelector('[data-sql-module="stock"][data-sql-view="articulo"]');
if(stockHistorySource){
 const group=document.createElement('div');group.className='system-menu-group';group.dataset.sqlGroup='historial';group.dataset.sidebarOrderId='historial_movimiento';
 const card=document.createElement('div');card.className='system-menu-card';const button=document.createElement('button');button.type='button';button.dataset.sqlModule='historial';button.innerHTML='<span class="system-menu-icon">'+(stockHistorySource.querySelector('svg')?.outerHTML||'')+'</span><span>Historial de movimiento</span>';card.append(button);group.append(card);
 stockHistorySource.closest('.system-menu-group').after(group);stockHistorySource.remove();sql.push(group);
}

const priceLink=web.querySelector('[data-system-web="lista"]');
const priceGroup=document.createElement('div');priceGroup.className='system-menu-group';priceGroup.dataset.sidebarOrderId='lista';
const priceCard=document.createElement('div');priceCard.className='system-menu-card';priceLink.replaceWith(priceGroup);priceCard.append(priceLink);
const expand=document.createElement('button');expand.type='button';expand.dataset.sidebarExpand='prices';expand.setAttribute('aria-label','Desplegar opciones de Lista de precios');expand.setAttribute('aria-expanded','false');expand.setAttribute('aria-controls','systemPriceSubmenu');expand.innerHTML='<span class="system-menu-chevron" aria-hidden="true">›</span>';priceCard.append(expand);
const priceSubmenu=document.createElement('div');priceSubmenu.id='systemPriceSubmenu';priceSubmenu.className='system-sql-submenu';priceSubmenu.hidden=true;priceGroup.append(priceCard,priceSubmenu);
for(const id of ['a_descontar','admin']){const link=web.querySelector('[data-system-web="'+id+'"]');if(link)priceSubmenu.append(link);}
const ordersLink=web.querySelector('[data-system-web="pedidos"]');
const ordersGroup=document.createElement('div');ordersGroup.className='system-menu-group';ordersGroup.dataset.sidebarOrderId='pedidos';
const ordersCard=document.createElement('div');ordersCard.className='system-menu-card';ordersLink.replaceWith(ordersGroup);ordersCard.append(ordersLink);
const ordersExpand=expand.cloneNode(true);ordersExpand.dataset.sidebarExpand='orders';ordersExpand.setAttribute('aria-label','Desplegar opciones de Pedidos');ordersExpand.setAttribute('aria-controls','systemOrdersSubmenu');ordersExpand.setAttribute('aria-expanded','false');ordersCard.append(ordersExpand);
const ordersSubmenu=document.createElement('div');ordersSubmenu.id='systemOrdersSubmenu';ordersSubmenu.className='system-sql-submenu';ordersSubmenu.hidden=true;ordersGroup.append(ordersCard,ordersSubmenu);
const missingLink=web.querySelector('[data-system-web="faltantes"]');if(missingLink)ordersSubmenu.append(missingLink);
ordersExpand.addEventListener('click',()=>{ordersSubmenu.hidden=!ordersSubmenu.hidden;ordersExpand.setAttribute('aria-expanded',String(!ordersSubmenu.hidden));});
const vouchersLink=web.querySelector('[data-system-web="comprobantes"]');if(vouchersLink)document.getElementById('systemCajaSubmenu').append(vouchersLink);
const invoiceSubmenu=document.getElementById('systemInvoiceSubmenu');
for(const id of ['tarjetas','garantias']){const link=web.querySelector('[data-system-web="'+id+'"]');if(link)invoiceSubmenu.append(link);}
expand.addEventListener('click',()=>{priceSubmenu.hidden=!priceSubmenu.hidden;expand.setAttribute('aria-expanded',String(!priceSubmenu.hidden));});

let userKey='',order=[],serial=0,unsubscribe=null;
function apply(){
 const access=window.CorralonFunciones?.menuUserHasAccess;
 menu.querySelectorAll('[data-system-web]').forEach(link=>link.hidden=!access?.(link.dataset.systemWeb));
 priceGroup.hidden=!access?.('lista');ordersGroup.hidden=!access?.('pedidos');
 caption.hidden=web.hidden=![...web.children].some(link=>!link.hidden);
 const full=[...new Set([...order,...defaults])];const rank=id=>{const index=full.indexOf(id);return index<0?full.length:index;};
 [...web.children].sort((a,b)=>rank(a.dataset.sidebarOrderId||a.dataset.systemWeb)-rank(b.dataset.sidebarOrderId||b.dataset.systemWeb)).forEach(link=>web.append(link));
 sql.sort((a,b)=>rank(a.dataset.sidebarOrderId)-rank(b.dataset.sidebarOrderId)).forEach(group=>menu.insertBefore(group,caption));
}
async function refresh(){
 const user=window.CorralonFunciones?.menuSessionUser?.();if(!user)return;const key=String(user.id||user.usuario||'default').trim()||'default';
 const ticket=++serial;if(userKey!==key){unsubscribe?.();unsubscribe=null;userKey=key;order=[];}apply();
 try{const local=await new Promise((resolve,reject)=>{const request=indexedDB.open('corralon_menu_cache_v1',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('menuOrdenes'))request.result.createObjectStore('menuOrdenes',{keyPath:'usuarioId'});};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const get=db.transaction('menuOrdenes','readonly').objectStore('menuOrdenes').get(key);get.onsuccess=()=>{resolve(get.result?.orden);db.close();};get.onerror=()=>{reject(get.error);db.close();};};});if(ticket!==serial)return;if(Array.isArray(local))order=local;else{try{order=JSON.parse(localStorage.getItem('corralon_menu_order_v1:'+key)||'[]');}catch{order=[];}}apply();}catch{}
 if(unsubscribe||ticket!==serial)return;
 try{const [app,fire]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')]);if(ticket!==serial||unsubscribe)return;const current=app.getApps().find(a=>a.name==='[DEFAULT]');if(!current)return;unsubscribe=fire.onSnapshot(fire.doc(fire.getFirestore(current),'menuOrdenes',encodeURIComponent(key)),snapshot=>{if(userKey!==key)return;if(snapshot.exists()&&Array.isArray(snapshot.data()?.orden)){order=snapshot.data().orden;apply();}},()=>{});}catch{}
}
window.CorralonSidebarMenu={refresh};window.addEventListener('menu-user-validated',refresh);refresh();

    const backdrop=document.getElementById('systemMenuBackdrop');
    document.body.classList.add('corralon-sidebar-enabled');
    const nativeRefresh=refresh;
    function fullRefresh(){nativeRefresh();const access=window.CorralonFunciones?.menuUserHasAccess;
      sql.forEach(group=>{group.hidden=!access?.(group.dataset.sidebarOrderId);});
      menu.querySelectorAll('[data-sql-module]').forEach(button=>{const ids={compras:'cargar_facturas',stock:'carga_stock',historial:'historial_movimiento',proveedores:'proveedores_sql',articulos:'articulos_sql',tarjetas:'ventas_tarjeta',pagos:'pagos_proveedores'};button.hidden=!access?.(ids[button.dataset.sqlModule]);});
      menu.querySelectorAll('[data-system-section]').forEach(button=>{const id=button.dataset.systemSection;button.hidden=!access?.(id.startsWith('caja')?'caja':id.startsWith('receipts')?'recibos_cobro':'facturacion');});
    }
    let focusBefore=null,closeTimer=0;
    const close=()=>{clearTimeout(closeTimer);menu.classList.remove('is-opening');backdrop.classList.remove('is-opening');menu.classList.add('is-closing');backdrop.classList.add('is-closing');document.querySelectorAll('[data-corralon-menu-toggle]').forEach(button=>button.setAttribute('aria-expanded','false'));closeTimer=setTimeout(()=>{menu.hidden=true;backdrop.hidden=true;menu.classList.remove('is-closing');backdrop.classList.remove('is-closing');},220);focusBefore?.focus();};
    const open=()=>{if(integrated&&window.CorralonInvoiceSections?.openMenu){window.CorralonInvoiceSections.openMenu();return;}fullRefresh();clearTimeout(closeTimer);focusBefore=document.activeElement;menu.hidden=backdrop.hidden=false;menu.classList.remove('is-closing');backdrop.classList.remove('is-closing');menu.classList.add('is-opening');backdrop.classList.add('is-opening');document.querySelectorAll('[data-corralon-menu-toggle]').forEach(button=>button.setAttribute('aria-expanded','true'));document.getElementById('systemMenuClose').focus();};
    sharedSystemMenu={open,close,refresh:fullRefresh};window.CorralonSidebarMenu=sharedSystemMenu;
    window.addEventListener('menu-user-validated',fullRefresh);
    if(!integrated){
      document.getElementById('systemMenuClose').addEventListener('click',close);backdrop.addEventListener('click',close);
      const paths={invoice:'#facturacion','invoice-consult':'#facturacion/consultar',receipts:'#recibos/emitir','receipts-consult':'#recibos/consultar',caja:'#caja/diaria','caja-consult':'#caja/consultar','caja-additional':'#caja/adicionales','caja-collections':'#caja/cobranzas'};
      menu.addEventListener('click',event=>{
        const expand=event.target.closest('button[aria-controls]:not([data-sidebar-expand])');if(expand){const submenu=document.getElementById(expand.getAttribute('aria-controls'));if(submenu){submenu.hidden=!submenu.hidden;expand.setAttribute('aria-expanded',String(!submenu.hidden));}return;}
        const section=event.target.closest('[data-system-section]');if(section){location.href='gestion.html'+paths[section.dataset.systemSection];}
        // SQL links are handled by the shared Web builder; provide its native route adapter below.
      });
      document.addEventListener('keydown',event=>{if(menu.hidden)return;if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=[...menu.querySelectorAll('button,a[href]')].filter(el=>!el.hidden&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
      const header=document.querySelector('body>.app>header,body>header,.page>.top,.app>.topbar,.topbar,.header,.menu-head,.top-shell');
      const existing=[...document.querySelectorAll('a,button')].filter(el=>!menu.contains(el)&&!el.closest('dialog,[role="dialog"],.modal')).find(el=>/^(?:☰\s*)?men[uú]$/i.test(el.textContent.trim()));
      const button=document.createElement('button');button.type='button';button.className='corralon-menu-toggle';button.dataset.corralonMenuToggle='';button.setAttribute('aria-label','Abrir menú del sistema');button.setAttribute('aria-controls','systemMenu');button.setAttribute('aria-expanded','false');button.textContent='☰ Menú';
      if(existing){if(existing.id)button.id=existing.id;existing.remove();}if(header)header.prepend(button);else{button.classList.add('corralon-menu-floating');document.body.prepend(button);}button.addEventListener('click',open);
      fullRefresh();
    }
    return sharedSystemMenu;
  }
  function autoSystemMenu(){
    const file=decodeURIComponent(location.pathname.split('/').pop()||'index.html').toLowerCase();
    const excluded=['index.html','index - copia.html','impcomp.html','pedido-compartido.html','prode-reference.html','gestion.html','cargastock (2).html'];
    if(excluded.includes(file)||new URLSearchParams(location.search).has('embed')||document.documentElement.getRootNode()?.host)return;
    initializeSystemMenu();
  }

  // Opt-in form behavior; page callbacks remain responsible for application data.
  function bindFormBehaviors(options = {}) {
    const root=options.root||document, combos=new Map(), tables=[], staticTables=new WeakSet();
    const editable='input:not([type="hidden"]),textarea,select,button[data-grid-field]';
    bindNumericExpressions({root,commitOnChange:true});
    bindLiveCurrency({root,selector:'input[data-number-format="currency"]',preserveCaret:true,fixedOnBlur:true});
    bindFlexibleDates({root,selector:'input[data-date]'});
    bindLabelSelect({root});
    bindFieldRestore({root,selector:'input:not(tbody input),textarea:not(tbody textarea),select:not(tbody select)',capture:true});
    bindShiftEnterNewLine({root});
    function refreshCombos(){
      for(const [input,record] of combos)if(!(root.body||root).contains(input)){record.binding.destroy();record.wrapper?.replaceWith(input);combos.delete(input);}
      root.querySelectorAll('select:not([data-combo-source])').forEach(select=>{
        const input=document.createElement('input');input.type='text';input.dataset.selectProxy='';input.className='shared-combo-input';input.setAttribute('aria-label',select.getAttribute('aria-label')||select.closest('label')?.firstChild?.textContent||select.name||'Seleccionar');
        for(const name of ['billField','valueField','field'])if(select.dataset[name])input.dataset[name]=select.dataset[name];
        select.before(input);select.hidden=true;select.dataset.comboSource='';input._sourceSelect=select;
        input.addEventListener('change',event=>{event.stopPropagation();const record=combos.get(input),value=record?.binding.getValue();if(value===null)return;select.value=String(value);select.dispatchEvent(new Event('change',{bubbles:true}));});
      });
      root.querySelectorAll('input[data-select-proxy],input[data-shared-combo]').forEach(input=>{
        const select=input._sourceSelect, spec=select?{items:Array.from(select.options).filter(x=>x.value!=='').map(x=>({value:x.value,label:x.textContent})),selectedValue:select.value}:options.combo?.(input);
        if(!spec)return;
        const signature=JSON.stringify([spec.items,spec.columns]);let record=combos.get(input);
        if(record&&record.signature!==signature){record.binding.destroy();record.wrapper?.replaceWith(input);record=null;combos.delete(input);}
        if(!record){const binding=bindTextDropdown({...spec,input,fixedMenu:true,minWidth:0,advanceOnEnter:false});record={binding,signature,wrapper:input.parentElement};combos.set(input,record);}
        if(select){input.disabled=select.disabled;input.value=select.selectedOptions[0]?.value?select.selectedOptions[0].textContent:'';}
      });
    }
    for(const spec of options.tables||[]){
      const body=spec.body,table=body.closest('table');
      const controller=bindEditableTable({root:table,selector:editable,rowSelector:spec.rowSelector,readRow:spec.readRow,restoreRow:spec.restoreRow,deleteRows:spec.deleteRows});
      const clipboard=bindTableSelectPaste({root:table,cellSelector:'tbody td[data-col]',columnSelector:'th[data-col]',selectOnCellMouseDown:false,clearOnDelete:false,selectAllOnCtrlA:false,copyOnCtrlC:false,
        getPosition:cell=>({row:Number(cell.parentElement.dataset.visualRow),col:Number(cell.dataset.col)}),
        getCellValue:cell=>{const f=cell.querySelector('input:not([hidden]),select:not([hidden]),textarea');return f?f.value:cell.textContent;},
        setCellValue:(cell,value)=>{const f=cell.querySelector('input:not([hidden]),select:not([hidden]),textarea');if(!f||f.readOnly||f.disabled)return;f.value=value;f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));},
        pasteText:(text,cell)=>{const matrix=parseClipboardTable(text),start=cell||document.activeElement?.closest('td');if(!start)return false;return spec.paste?.(matrix,Number(start.parentElement.dataset.visualRow),Number(start.dataset.col))!==false;}});
      table.querySelectorAll('thead th').forEach((th,i)=>{th.dataset.col=i;th.dataset.sortKey=String(i);});
      bindTableSort({root:table,sort:(key,dir)=>{if(key!=='')spec.sort?.(Number(key),dir);}});
      tables.push({spec,controller,clipboard});
    }
    function refresh(){root.querySelectorAll('table').forEach(table=>{if(tables.some(t=>t.spec.body.closest('table')===table)||staticTables.has(table))return;staticTables.add(table);Array.from(table.querySelectorAll('thead th')).forEach((th,col)=>{th.dataset.col=col;th.dataset.sortKey=String(col);});const rowList=()=>Array.from(table.querySelectorAll('tbody tr'));let anchor=null,selected=new Set();table.addEventListener('mousedown',e=>{const row=e.target.closest('tbody tr');if(!row||e.button!==0)return;const list=rowList(),index=list.indexOf(row);if(e.shiftKey&&anchor!==null){if(!e.ctrlKey&&!e.metaKey)selected.clear();list.slice(Math.min(anchor,index),Math.max(anchor,index)+1).forEach(r=>selected.add(r));}else if(e.ctrlKey||e.metaKey){if(selected.has(row))selected.delete(row);else selected.add(row);anchor=index;}else{selected=new Set([row]);anchor=index;}list.forEach(r=>r.classList.toggle('is-selected-row',selected.has(r)));});bindTableSelectPaste({root:table,cellSelector:'tbody td',columnSelector:'th[data-col]',clearOnDelete:false,selectAllOnCtrlA:true,getPosition:cell=>({row:rowList().indexOf(cell.parentElement),col:cell.cellIndex}),getCellValue:cell=>cell.textContent,setCellValue:()=>{}});bindTableSort({root:table,sort:(key,dir)=>{if(key==='')return;const col=Number(key),sign=dir==='desc'?-1:1;const list=rowList();list.sort((a,b)=>{const x=a.cells[col]?.textContent.trim()||'',y=b.cells[col]?.textContent.trim()||'';if(/^[\d.$,\s-]+$/.test(x)&&/^[\d.$,\s-]+$/.test(y))return sign*(parseLocaleNumber(x)-parseLocaleNumber(y));const dx=parseFechaFlexible(x),dy=parseFechaFlexible(y);return dx&&dy?sign*(dx.date-dy.date):sign*x.localeCompare(y,'es',{numeric:true});});list.forEach(row=>row.parentElement.append(row));}});});root.querySelectorAll('input[type="date"]').forEach(input=>{input.type='text';input.dataset.date='';input.placeholder='dd/mm/aaaa';});root.querySelectorAll('input[data-date]').forEach(input=>{if(/^\d{4}-\d{2}-\d{2}$/.test(input.value))input.value=input.value.split('-').reverse().join('/');});root.querySelectorAll('input.money:not([readonly])').forEach(input=>{input.dataset.numberFormat='currency';input.inputMode='decimal';});refreshCombos();for(const {spec} of tables){Array.from(spec.body.querySelectorAll(spec.rowSelector)).forEach((row,index)=>{row.dataset.row=spec.rowKey(row);row.dataset.visualRow=index;Array.from(row.cells).forEach((cell,col)=>{cell.dataset.col=col;cell.querySelectorAll(editable).forEach(field=>{field.dataset.field=field.dataset.billField||field.dataset.valueField||field.dataset.gridField||'column-'+col;});});});}}
    // Global focus selection also handles controls added after the initial render.
    bindLinearNavigation({root,selector:'input:not([hidden]):not(dialog:not([open]) *),textarea:not(dialog:not([open]) *),select:not([hidden]):not(dialog:not([open]) *),button:not([tabindex="-1"]):not(dialog:not([open]) *):not(tbody button:not([data-grid-field]))',modalScope:true,selectOnAnyFocus:true,selectOnFirstPointerFocus:true,navigateLeftRight:true,smartCaret:true});
    root.addEventListener('keydown',event=>{if(event.defaultPrevented||event.key!=='Enter'||event.shiftKey)return;const form=event.target.closest('form[data-enter-submit]');if(!form)return;const fields=Array.from(form.querySelectorAll('input:not([hidden]),textarea,select:not([hidden])')).filter(x=>!x.disabled&&!x.readOnly);if(event.target!==fields.at(-1))return;event.preventDefault();form.requestSubmit();},true);
    const dialogs=new Map();
    function openDialog(dialog,origin=document.activeElement){
      const row=origin?.closest?.('[data-row]'),column=origin?.dataset?.field;
      const state={origin,rowKey:row?.dataset.row,column,table:row?.closest('table')};dialogs.set(dialog,state);origin?.closest?.('td')?.classList.add('popup-origin');
      dialog.addEventListener('close',()=>{const current=dialogs.get(dialog);if(!current)return;dialogs.delete(dialog);const row=Array.from(current.table?.querySelectorAll('[data-row]')||[]).find(x=>x.dataset.row===current.rowKey);const field=Array.from(row?.querySelectorAll(editable)||[]).find(x=>x.dataset.field===current.column&&!x.hidden);const target=current.origin?.isConnected?current.origin:field;root.querySelectorAll('.popup-origin').forEach(x=>x.classList.remove('popup-origin'));target?.focus?.({preventScroll:true});},{once:true});
      if(!dialog.open)dialog.showModal();
    }
    refresh();return {refresh,openDialog,finish:()=>tables.forEach(t=>t.controller.finish()),resetHistory:()=>tables.forEach(t=>t.controller.resetHistory()),clearSelection:()=>tables.forEach(t=>{t.controller.clearSelection();t.clipboard.clearSelection();})};
  }

  window.CorralonFunciones = {
    bindFormBehaviors,
    ensureSystemMenu,
    initializeSystemMenu,
    animacionCarga,
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
    createUuid,
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
    focusField,
    bindFlexibleDates,
    bindTextDropdown,
    parseLocaleNumber,
    evaluateNumericExpression,
    evaluateBasicArithmetic,
    formatLocaleNumber,
    bindLiveLocaleNumber,
    rawCurrencyText,
    formatCurrencyText,
    bindRawCurrencySelection,
    bindLabelSelect,
    bindShiftEnterNewLine,
    menuSessionUser,
    menuUserIsAdministrator,
    isMenuSessionActive,
    menuUserHasAccess,
    presupuestoMediosPago,
    normalizePresupuestoDatos
  };
  window.dispatchEvent(new Event('corralon:funciones-ready'));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(autoSystemMenu,0),{once:true});else setTimeout(autoSystemMenu,0);
  // Las cuentas en campos se activan explícitamente en los precios de Artículos.
})();
