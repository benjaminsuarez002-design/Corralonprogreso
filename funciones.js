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

  function whatsappNumber(phone,digits){
    if(typeof phone!=='string'||!/^\+?[\d\s().-]+$/.test(phone.trim()))return '';
    digits=digits??phone.replace(/\D/g,'');
    const international=/^(?:\+|00)/.test(phone.trim());
    let number=digits.replace(/^00/,'');
    if(international&&!number.startsWith('54'))return /^[1-9]\d{6,14}$/.test(number)?number:'';
    if(number.startsWith('54')&&(international||number.length>=12))number=number.slice(2);
    number=number.replace(/^0/,'');
    if(/^9[1-3]\d{9}$/.test(number))return '54'+number;
    if(number.length===12){
      const mobile=number.match(/^((?:11|[23]\d{2,3}))15(\d+)$/);
      if(mobile)number=mobile[1]+mobile[2];
    }
    return /^[1-3]\d{9}$/.test(number)?'549'+number:'';
  }

  function collectionReminderDates(account){
    const [startYear,startMonth,startDay]=String(account?.avisoDesde||'').split('-');
    const [endYear,endMonth,endDay]=String(account?.avisoHasta||'').split('-');
    if(!startDay||!endDay)return null;
    const asOf=`${startDay}/${startMonth}/${startYear}`;
    const start=startYear!==endYear?asOf:startMonth!==endMonth?`${startDay}/${startMonth}`:startDay;
    const end=startYear!==endYear?`${endDay}/${endMonth}/${endYear}`:`${endDay}/${endMonth}`;
    return {asOf,start,end};
  }

  function collectionWhatsAppReminder(account){
    const total=Number(account?.saldoTotal),dates=collectionReminderDates(account);
    if(!Number.isFinite(total)||total<=0||!dates)return '';
    const {asOf,start,end}=dates;
    const fmt=new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'});
    const money=value=>fmt.format(value).replace(/\u00a0/g,' ');
    const overdue=Number(account.saldoVencido||0);
    const balances=[];
    for(const [label,amount] of [
      ['Saldo vencido',overdue],
      [`Facturas por vencer del ${start} al ${end}`,account.saldoProximo],
      ['Vencimientos posteriores',account.saldoPosterior],
      ['Saldo sin fecha de vencimiento informada',account.saldoSinFecha]
    ]){
      if(Number(amount)>0)balances.push(`• *${label}* — ${money(amount)}`);
    }
    const reminder=overdue>0?'¿Nos confirmás cuándo podrías abonar el saldo vencido?':'Te lo recordamos para que puedas programar el pago.';
    return [
      'Hola, te escribimos de Corralón Progreso por tu cuenta corriente.',
      `Al ${asOf}, tu *saldo total pendiente es de ${money(total)}*.`,
      ...balances,
      reminder+' Si ya hiciste algún pago, podés mandarnos el comprobante por acá. Gracias.'
    ].join('\n');
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
      if(options.openOnFocus)showDropdown(input,'focus',event);
      else hideDropdown(input, 'focus', event);
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

      if((options.verticalArrowsNavigateGrid||(options.modifiedArrowsNavigateGrid&&(event.ctrlKey||event.metaKey)))&&['ArrowDown','ArrowUp'].includes(event.key))return;
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && isOpen && isOpen(input) && moveActive) {
        event.preventDefault();
        if (suppressEnterAfterDelete) deletedInputs.delete(input);
        moveActive(input, event.key === 'ArrowDown' ? 1 : -1, event);
        return;
      }

      if (options.openOnArrowDown && event.key === 'ArrowDown' && !isOpen?.(input)) {
        event.preventDefault();
        showDropdown(input, 'toggle', event);
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
      if (!wasFocused&&(buttonOnlyWhenFocused||(options.openOnFocus&&isOpen?.(input))))return;
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
      if(options.ignoreModifiedClick&&(event.shiftKey||event.ctrlKey||event.metaKey))return;
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
    const expressionText=input=>{
      const value=input.value,suffix=options.literalSuffix;
      if(!suffix||!value.endsWith(suffix))return value;
      const text=value.slice(0,-suffix.length);
      return /^\s*\+[\d.,]+$/.test(text)?value:text;
    };
    function remember(event){const input=field(event);if(input)states.set(input,{base:input.type==='number'?Number(input.value):parseLocaleNumber(input.value),value:input.value,type:input.type});}
    function commit(input){
      const expression=expressionText(input);
      if(!hasExpression(expression)){input.setCustomValidity('');return true;}
      const state=states.get(input)||{base:0,value:'',type:input.type};
      const value=evaluatePriceAdjustment(expression.replace(/US\$|\$|€/g,'').trim(),state.base);
      if(!Number.isFinite(value)){input.setCustomValidity('Cuenta inválida. Usá +3%, x 1.03 o 100*1.03.');input.reportValidity();return false;}
      input.setCustomValidity('');
      const localized=state.type!=='number'&&/[,€$%]/.test(state.value);
      input.value=value.toFixed(2).replace('.',localized?',':'.');
      if(state.type==='number')input.type='number';
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;
    }
    function onInput(event){const input=field(event);if(!input)return;input.setCustomValidity('');if(hasExpression(expressionText(input))){event.stopImmediatePropagation();}}
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
    const decimals=options.decimals??2,prefix=options.prefix??'$ ',suffix=options.suffix??'';
    root.addEventListener('input', event => {
      const input = event.target.closest?.(selector); if (!input || input.disabled || input.readOnly) return;
      const original=input.value,caret=input.selectionStart;
      const tokensBeforeCaret=(original.slice(0,caret??original.length).match(/[\d,-]/g)||[]).length;
      const text = input.value.replace(/[^\d,-]/g, ''), negative = text.startsWith('-') ? '-' : '';
      const parts = text.replace(/-/g, '').split(','), integer = parts[0].replace(/^0+(?=\d)/, '');
      input.value = integer || parts.length > 1 ? `${prefix}${negative}${(integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${parts.length > 1 ? ',' + parts[1].slice(0, decimals) : ''}${suffix}` : negative;
      if(options.preserveCaret&&caret!=null){
        let position=0,tokens=0;
        while(position<input.value.length&&tokens<tokensBeforeCaret){if(/[\d,-]/.test(input.value[position]))tokens++;position++;}
        input.setSelectionRange(position,position);
      }

    });
    if(options.fixedOnBlur)root.addEventListener('blur',event=>{
      const input=event.target.closest?.(selector);
      if(!input||input.disabled||input.readOnly||!input.value.trim())return;
      const number=parseLocaleNumber(input.value);
      input.value=suffix?number.toLocaleString('es-AR',{maximumFractionDigits:decimals})+suffix:new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(number);
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
    const rowKey = options.rowKey || (row => row?.dataset.row);
    const fieldKey = options.fieldKey || (field => field.dataset.field);
    const columnIndex = options.columnIndex;
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
        const field = row && fields(row).find(item => fieldKey(item) === state.column);
        if (field) { field.focus(); field.select?.(); session = { ...state, before: snapshot(state.key), movement: ++movement }; }
        paint();
      } finally { restoring = false; }
    }
    root.addEventListener('focusin', event => {
      const field = event.target.closest(selector); if (!field || restoring) return;
      finish(); const key = rowKey(field.closest(rowSelector));
      session = { key, column: fieldKey(field), before: snapshot(key), value:field.value, movement: ++movement };
      if(options.selectFields)field.select?.();
    });
    root.addEventListener('focusout', event => {
      if (event.target.matches(selector)) { event.target.classList.remove('table-text-editing'); finish(); }
    });
    root.addEventListener('mousedown', event => {
      if (event.button !== 0 || (!options.selectFields&&event.target.closest('button'))) return;
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
      paint();
      const field=event.target.closest(selector);
      if(options.selectFields&&field&&!field.disabled&&!field.readOnly&&field.getRootNode().activeElement!==field){
        event.preventDefault();field.focus();field.select?.();
      }else field?.classList.add('table-text-editing');
    });
    root.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.target.disabled) return;
      if(event.target.readOnly&&(event.key==='Escape'||isUndoShortcut(event)))return;
      const field = event.target.closest(selector);
      if (event.key === 'Escape' && session) {
        event.preventDefault();event.stopPropagation();
        if(!options.selectFields||!statesEqual(session.before,options.readRow(session.key)))restore(session);
        else if(field&&field.value!==session.value){field.value=session.value;field.setCustomValidity?.('');field.select?.();}
        return;
      }
      if (isUndoShortcut(event)) {
        event.preventDefault(); event.stopPropagation();
        if (session && !statesEqual(session.before, options.readRow(session.key))) restore(session);
        else if(options.selectFields&&session&&field&&field.value!==session.value){field.value=session.value;field.setCustomValidity?.('');field.select?.();}
        else { finish(); const previous = history.pop(); if (previous) restore(previous); }
        return;
      }
      const deleting=event.key==='Delete'||(options.deleteWithSupr&&event.key==='Supr');
      if (deleting && (selected.size || event.target.closest(rowSelector))) {
        event.preventDefault(); event.stopPropagation();
        if(options.deleteWithSupr&&(event.repeat||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey))return;
        session = null;
        const current = rowKey(event.target.closest(rowSelector));
        const keys = selected.has(current)||(options.selectFields&&selected.size) ? Array.from(selected) : current ? [current] : Array.from(selected);
        if(options.deleteWithSupr){selected.clear();anchor=null;}
        options.deleteRows(keys,field); selected.clear();paint(); return;
      }
      if(options.selectFields&&field){
        const all=field.selectionStart===0&&field.selectionEnd===String(field.value||'').length;
        if(event.key==='F2'&&typeof field.select==='function'){
          event.preventDefault();
          if(all){const end=field.value.length;field.setSelectionRange(end,end);field.classList.add('table-text-editing');}
          else{field.select();field.classList.remove('table-text-editing');}
          return;
        }
        if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)field.classList.add('table-text-editing');
      }
      const vertical=['ArrowUp','ArrowDown'].includes(event.key);
      const newField=vertical&&options.navigateNewRowVertically?options.newRowTarget?.():null;
      const fromNewRow=Boolean(newField&&event.target===newField);
      if((!field&&!fromNewRow)||!['Enter','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
      const source=field||newField;
      const newRow=newField?.closest('tr');
      const row=fromNewRow?newRow:field.closest(rowSelector);
      const rowFields=node=>newRow&&node===newRow?[newField]:fields(node);
      const list=rowNodes(),cells=rowFields(row),c=cells.indexOf(source);
      if(newRow&&(fromNewRow||!columnIndex||columnIndex(source)===columnIndex(newField)))list.push(newRow);
      const navigable=vertical&&options.navigateNewRowVertically?list.filter(node=>rowFields(node).length):list;
      const r=navigable.indexOf(row);
      const complete=source.selectionStart===0&&source.selectionEnd===source.value.length;
      if(event.key==='ArrowLeft'&&!complete&&source.selectionStart!==0)return;
      if(event.key==='ArrowRight'&&!complete&&source.selectionEnd!==source.value.length)return;
      let target;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const next=event.ctrlKey?(event.key==='ArrowUp'?0:navigable.length-1):r+(event.key==='ArrowUp'?-1:1);
        const targets=navigable[next]?rowFields(navigable[next]):[];
        target=columnIndex?(targets.find(cell=>columnIndex(cell)===columnIndex(source))||targets.find(cell=>columnIndex(cell)>columnIndex(source))||targets.at(-1)):targets[c];
      } else if (event.ctrlKey && event.key.startsWith('Arrow')) target = cells[event.key === 'ArrowLeft' ? 0 : cells.length - 1];
      else {
        const step = event.key === 'ArrowLeft' || event.shiftKey ? -1 : 1;
        target = cells[c + step];
        if (!target) { const next = list[r + step]; target = next ? fields(next)[step > 0 ? 0 : fields(next).length - 1] : step > 0 ? options.newRowTarget?.() : null; }
      }
      if (target) {
        if(options.selectFields&&selected.size<=1){selected.clear();anchor=rowKey(target.closest(rowSelector))??null;if(anchor!==null)selected.add(anchor);paint();}
        event.preventDefault();event.stopPropagation();target.focus();target.select?.();target.scrollIntoView?.({block:'nearest'});
      }
    });
    return { clearSelection() { selected.clear();anchor=null;paint(); }, resetHistory(){session=null;history.length=0;selected.clear();anchor=null;paint();}, finish, paint };
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
    if(options.menuClass)menu.className=options.menuClass;
    if(options.visibleToggle){
      toggle.style.opacity='1';
      toggle.style.visibility='inherit';
      toggle.tabIndex=0;
      toggle.className='text-dropdown-toggle';
    }
    if(options.listId){
      menu.id=options.listId;
      input.setAttribute('aria-controls',menu.id);
      input.setAttribute('aria-autocomplete','list');
    }
    wrapper.append(toggle, menu);
    if(options.fixedMenu)document.body.append(menu);
    let matches = [], active = 0, selectedItem = items.find(item=>String(item.value)===String(options.selectedValue)) || null;
    let pendingExitPick=false,committedLabel=input.value;
    const hide = () => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
    let renderMatches=null,rendered=0,sortColumn=-1,sortDirection='',lastQuery='';
    const pager=options.batchSize?bindIncrementalRendering({root:menu,batchSize:options.batchSize,getTotal:()=>matches.length,renderRange:(from,to)=>{if(renderMatches)for(let index=from;index<to;index++)renderMatches(matches[index],index);rendered=to;}}):null;
    function positionScaledMenu(){
      const value=typeof options.menuScale==='function'?options.menuScale():options.menuScale,scale=Number(value)>0?Number(value):1,rect=input.getBoundingClientRect();
      const viewportWidth=window.innerWidth,viewportHeight=window.innerHeight;
      const width=Math.min(Math.max(rect.width,(options.menuWidth||220)*scale),Math.max(1,viewportWidth-16));
      const below=Math.max(0,viewportHeight-rect.bottom-8),above=Math.max(0,rect.top-8),openUp=below<160*scale&&above>below;
      const maxHeight=Math.max(1,Math.min(240*scale,openUp?above:below));
      Object.assign(menu.style,{position:'fixed',transform:'scale('+scale+')',transformOrigin:'top left',boxSizing:'border-box',fontSize:'14px',width:width/scale+'px',minWidth:width/scale+'px',maxWidth:Math.max(1,viewportWidth-16)/scale+'px',maxHeight:maxHeight/scale+'px',overflowX:'hidden',left:Math.max(8,Math.min(rect.left,viewportWidth-width-8))+'px',bottom:'auto'});
      const height=menu.hidden?maxHeight:Math.min(maxHeight,menu.getBoundingClientRect().height);
      menu.style.top=(openUp?Math.max(8,rect.top-height-4):rect.bottom+4)+'px';
    }
    const repositionScaledMenu=()=>{if(!menu.hidden)requestAnimationFrame(positionScaledMenu);};
    if(options.fixedMenu&&options.menuScale)window.addEventListener('resize',repositionScaledMenu);
    function mark() {
      pager?.ensure(active+1);
      const rows=Array.from(menu.querySelectorAll('[data-index]'));
      rows.forEach((row, index) => { row.style.background = index === active ? '#ef1015' : 'white'; row.style.color = index === active ? 'white' : '#222'; row.setAttribute('aria-selected', String(index === active)); });
      const selected=rows[active];
      if(selected?.id)input.setAttribute('aria-activedescendant',selected.id);
      else input.removeAttribute('aria-activedescendant');
      selected?.scrollIntoView({ block: 'nearest', inline:'nearest' });
    }
    function show(_, reason) {
      if(options.pickFirstOnExit){
        if(reason==='typing-key'&&input.getRootNode().activeElement!==input)return;
        if(reason!=='focus'||!input.value.trim())pendingExitPick=true;
      }
      if(options.fixedMenu&&options.menuScale)positionScaledMenu();
      else if(options.fixedMenu){const rect=input.getBoundingClientRect(),width=Math.min(Math.max(rect.width,options.menuWidth||0),Math.max(1,window.innerWidth-16));menu.style.position='fixed';menu.style.top=rect.bottom+'px';menu.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+'px';menu.style.width=width+'px';menu.style.minWidth=width+'px';menu.style.maxHeight=Math.max(80,Math.min(240,window.innerHeight-rect.bottom-10))+'px';}
      const query = reason==='sorting'?lastQuery:reason === 'typing' || reason === 'typing-key' ? normalize(input.value) : '';
      lastQuery=query;
      matches = items.filter(item => (!options.filterItem||options.filterItem(item))&&(!query || (options.match?options.match(item,query):normalize(item.searchText||item.label).includes(query)) || normalize(item.value) === query));
      if(query&&typeof options.rank==='function'){
        const ranks=new Map(matches.map(item=>[item,Number(options.rank(item,query,normalize(item.label)))||0]));
        matches.sort((a,b)=>ranks.get(a)-ranks.get(b));
      }
      if(options.sortableColumns&&sortColumn>=0){const sign=sortDirection==='desc'?-1:1;matches.sort((a,b)=>{const x=a.sortValues?.[sortColumn]??a.cells?.[sortColumn]??a.label,y=b.sortValues?.[sortColumn]??b.cells?.[sortColumn]??b.label;return sign*(typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??''),'es',{numeric:true}));});}
      active = reason==='focus'?Math.max(0,matches.indexOf(selectedItem)):0;
      menu.replaceChildren();
      const columns=options.columns||[],grid=columns.map(column=>`${column.width||100}px`).join(' '),gridWidth=columns.reduce((sum,column)=>sum+(column.width||100),20);
      function fillColumns(row,cells){row.style.cssText=`display:grid;grid-template-columns:${grid};min-width:${gridWidth}px;padding:6px 10px;white-space:nowrap;font-size:12px;cursor:pointer`;cells.forEach((value,index)=>{const cell=document.createElement('span');cell.textContent=String(value??'');cell.title=cell.textContent;cell.style.cssText=`overflow:hidden;text-overflow:ellipsis;padding:0 5px;text-align:${columns[index]?.align||'left'}`;row.append(cell);});}
      if(columns.length){const heading=document.createElement('div');fillColumns(heading,columns.map(column=>column.label));heading.style.cssText+=';position:sticky;top:0;z-index:1;font-weight:700;cursor:default;'+(options.headerStyle||'background:#171717;color:white');
        if(options.sortableColumns)Array.from(heading.children).forEach((cell,index)=>{
          cell.setAttribute('role','columnheader');cell.setAttribute('aria-sort',sortColumn===index?(sortDirection==='asc'?'ascending':'descending'):'none');cell.style.cursor='pointer';cell.title='Ordenar ascendente, descendente y volver al orden por fecha';
          cell.textContent=columns[index].label+(sortColumn===index?(sortDirection==='asc'?' ↑':' ↓'):' ↕');
          cell.addEventListener('mousedown',event=>event.preventDefault());
          cell.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();if(sortColumn!==index){sortColumn=index;sortDirection='asc';}else if(sortDirection==='asc')sortDirection='desc';else{sortColumn=-1;sortDirection='';}show(null,'sorting');});
        });menu.append(heading);}
      renderMatches=(item, index) => {
        const row = document.createElement('div'); row.setAttribute('role', 'option'); row.dataset.index = index;
        if(menu.id)row.id=menu.id+'-'+index;
        if(columns.length)fillColumns(row,item.cells||[item.label]);else{row.textContent=item.label;row.style.cssText='padding:7px 10px;white-space:nowrap;cursor:pointer';if(options.menuScale){row.style.whiteSpace='normal';row.style.overflowWrap='anywhere';}}menu.append(row);
      };
      if(pager)pager.reset();else matches.forEach(renderMatches);
      if (!matches.length) { const empty = document.createElement('div'); empty.textContent = 'Sin coincidencias'; empty.style.padding = '7px 10px'; menu.append(empty); }
      menu.hidden = false; input.setAttribute('aria-expanded', 'true'); mark();
      if(options.fixedMenu&&options.menuScale)positionScaledMenu();
    }
    function pick(index=active,leaving=false) {
      if (!options.allowEmptyPick&&!input.value.trim()) { hide(); return false; }
      const item = matches[index]; if (!item) return false;
      pendingExitPick=false;
      selectedItem = item;
      input.value=committedLabel=item.label; input.setCustomValidity(''); hide();
      const change=new Event('change', { bubbles: true });change.dropdownValue=item.value;change.dropdownExit=leaving;input.dispatchEvent(change); return true;
    }
    toggle.addEventListener('mousedown',event=>event.preventDefault());
    const bindings = bindDropdownOnlyWhenTyping({ root: wrapper, inputSelector: 'input', buttonSelector: 'button', buttonEvent:'click', show, hide, isOpen: () => !menu.hidden, advanceOnEnter: options.advanceOnEnter !== false, openOnArrowDown:options.openOnArrowDown, openOnFocus:options.openOnFocus, modifiedArrowsNavigateGrid:options.modifiedArrowsNavigateGrid, verticalArrowsNavigateGrid:options.verticalArrowsNavigateGrid,
      pickActive: () => pick(), enterPicksFirst: false, moveActive: (_, step) => { active = Math.max(0, Math.min(matches.length - 1, active + step)); mark(); } });
    wrapper.onmouseenter = () => { toggle.style.opacity = '1'; };
    if(!options.visibleToggle)wrapper.onmouseleave = () => { toggle.style.opacity = '0'; };
    wrapper.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||!pendingExitPick)return;
      event.preventDefault();event.stopPropagation();
      pendingExitPick=false;input.value=committedLabel;hide();
    },true);
    wrapper.addEventListener('focusout',event=>{
      if(wrapper.contains(event.relatedTarget))return;
      if(pendingExitPick){pendingExitPick=false;if(!pick(0,true))input.value=committedLabel;}
      hide();
    });
    menu.addEventListener('mousedown', event => {
      const row = event.target.closest('[data-index]'); if (!row) return;
      event.preventDefault(); active = Number(row.dataset.index); input.value = matches[active].label; pick(); input.focus();
    });
    const outside = event => { const path=event.composedPath(); if (!path.includes(wrapper)&&!path.includes(menu))hide(); };
    document.addEventListener('pointerdown', outside);
    return {
      setValue(value) { selectedItem = items.find(item=>String(item.value)===String(value)) || null; input.value=committedLabel=selectedItem?.label || '';pendingExitPick=false; },
      getValue() { const query = normalize(input.value); if (!query) return options.emptyValue ?? ''; if(selectedItem && normalize(selectedItem.label)===query)return selectedItem.value; return items.find(item => normalize(item.label) === query || normalize(item.value) === query)?.value ?? null; },
      destroy() { pendingExitPick=false;pager?.destroy(); bindings.destroy(); document.removeEventListener('pointerdown', outside); if(options.fixedMenu&&options.menuScale)window.removeEventListener('resize',repositionScaledMenu); if(options.fixedMenu)menu.remove(); }
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
  const appearanceKey='corralon_appearance_theme';
  const legacyAppearanceKey='corralon_customer_accounts_theme';
  const normalizeAppearance=value=>value==='classic'?'classic':'web';
  function savedAppearance(){
    try{return normalizeAppearance(localStorage.getItem(appearanceKey)??localStorage.getItem(legacyAppearanceKey));}
    catch{return 'web';}
  }
  function syncAppearanceControls(root=document){
    for(const control of root.querySelectorAll('select[data-corralon-appearance]')){
      control.value=document.documentElement.dataset.corralonTheme;
    }
  }
  function applyAppearance(value){
    const theme=normalizeAppearance(value),root=document.documentElement;
    const changed=root.dataset.corralonTheme!==theme;
    root.dataset.corralonTheme=theme;
    syncAppearanceControls();
    if(changed)window.dispatchEvent(new CustomEvent('corralon-appearance-change',{detail:{theme}}));
  }
  applyAppearance(savedAppearance());
  document.addEventListener('DOMContentLoaded',()=>syncAppearanceControls(),{once:true});
  document.addEventListener('change',event=>{
    if(!event.target.matches?.('select[data-corralon-appearance]'))return;
    const theme=normalizeAppearance(event.target.value);
    try{localStorage.setItem(appearanceKey,theme);}catch{}
    applyAppearance(theme);
  });
  window.addEventListener('storage',event=>{
    if(event.key===appearanceKey||event.key===legacyAppearanceKey||event.key===null)applyAppearance(savedAppearance());
  });

  let sharedSystemMenu=null;
  function ensureSystemMenu(){
    let menu=document.getElementById('systemMenu');document.body.classList.add('corralon-sidebar-enabled');if(menu)return menu;
    let backdrop=document.getElementById('systemMenuBackdrop');if(!backdrop){backdrop=document.createElement('div');backdrop.id='systemMenuBackdrop';backdrop.hidden=true;document.body.append(backdrop);}
    const template=document.createElement('template');template.innerHTML=systemMenuMarkup;menu=template.content.firstElementChild;
    menu.querySelector('header').insertAdjacentHTML('afterend','<label class="system-menu-appearance">Tema <select data-corralon-appearance><option value="web">Web</option><option value="classic">Clásico</option></select></label>');
    syncAppearanceControls(menu);
    document.body.append(menu);return menu;
  }
  function initializeSystemMenu({integrated=false}={}){
    if(sharedSystemMenu)return sharedSystemMenu;
    if(window.CorralonSidebarMenu?.open)return sharedSystemMenu=window.CorralonSidebarMenu;
    
const menu=ensureSystemMenu();
// Native destinations are shared by every sidebar; do not send extracted pages through Gestión.
const sqlPages={compras:'cargar-facturas.html',stock:'cargastock.html',proveedores:'proveedores-sql.html',articulos:'articulos-sql.html',tarjetas:'ventas-tarjeta.html',pagos:'pagos-proveedores.html',historial:'historial-movimiento.html',cuentas:'cuentas-corrientes.html'};
const sectionPages={invoice:'gestion.html#facturacion','invoice-consult':'gestion.html#facturacion/consultar',customers:'gestion.html#facturacion/clientes',receipts:'recibos-cobro.html#recibos/emitir','receipts-consult':'recibos-cobro.html#recibos/consultar',caja:'caja.html#caja/diaria','caja-consult':'caja.html#caja/consultar','caja-additional':'caja.html#caja/adicionales','caja-collections':'caja.html#caja/cobranzas'};
function sidebarDestination(target){
 if(target.matches('a[href]'))return target.getAttribute('href');
 if(target.dataset.sqlModule){const key=target.dataset.sqlModule,view=target.dataset.sqlView||'';if(key==='stock'&&view==='articulo')return 'historial-movimiento.html#sql/historial';const page=sqlPages[key];return page?page+'#sql/'+key+(view?'/'+view:''):null;}
 return sectionPages[target.dataset.systemSection]||null;
}
menu.addEventListener('click',event=>{
 const target=event.target.closest('[data-sql-module],[data-system-section],a[href]');if(!target||target.hidden||target.closest('.system-menu-group')?.hidden)return;
 const destination=sidebarDestination(target);if(!destination)return;
 const url=new URL(destination,location.href),current=decodeURIComponent(location.pathname.split('/').pop()||'');
 // Facturación keeps its in-page handlers so unsaved edits are checked before leaving.
 if(target.dataset.systemSection&&current==='gestion.html'&&url.pathname===location.pathname&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(event.ctrlKey||event.metaKey||event.shiftKey)window.open(url.href,'_blank','noopener');else location.assign(url.href);
},true);
const entries=[{"id": "lista", "html": "<a data-system-web=\"lista\" href=\"index.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Lista de precios</span></a>"}, {"id": "a_descontar", "html": "<a data-system-web=\"a_descontar\" href=\"index.html#adescontar\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 21L20 3 M6 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M18 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6\"/></svg></span><span>A descontar</span></a>"}, {"id": "remitos", "html": "<a data-system-web=\"remitos\" href=\"remitos.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 5h12v12H2z M14 10h4l4 5v2h-8 M7 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M21 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0\"/></svg></span><span>Remitos</span></a>"}, {"id": "historial", "html": "<a data-system-web=\"historial\" href=\"historial.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 12a9 9 0 1 0 3-7 L3 8 M3 3v5h5 M12 7v6l4 2\"/></svg></span><span>Historial</span></a>"}, {"id": "comprobantes", "html": "<a data-system-web=\"comprobantes\" href=\"comprobantes.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Comprobantes</span></a>"}, {"id": "faltantes", "html": "<a data-system-web=\"faltantes\" href=\"faltantes.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Faltantes</span></a>"}, {"id": "pedidos", "html": "<a data-system-web=\"pedidos\" href=\"pedidos.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 2h8l4 4v16H6z M14 2v5h5 M9 11h6 M9 15h6 M9 18h4\"/></svg></span><span>Pedidos</span></a>"}, {"id": "tarjetas", "html": "<a data-system-web=\"tarjetas\" href=\"tarjetas.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 5h20v15H2z M2 9h20 M5 15h5\"/></svg></span><span>Tarjetas</span></a>"}, {"id": "actualizar_articulos", "html": "<a data-system-web=\"actualizar_articulos\" href=\"actualizar articulos.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2l10 5v11l-10 5-10-5V7z M2 7l10 5 10-5 M12 12v11\"/></svg></span><span>Actualizar artículos</span></a>"}, {"id": "proveedores", "html": "<a data-system-web=\"proveedores\" href=\"proveedores.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M2 22v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 15a5 5 0 0 1 3 5\"/></svg></span><span>Proveedores</span></a>"}, {"id": "listas_proveedores", "html": "<a data-system-web=\"listas_proveedores\" href=\"listasproveedores.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7h17l-5-5 M21 17H4l5 5 M20 7l-5 5 M4 17l5-5\"/></svg></span><span>Comparar listas</span></a>"}, {"id": "diferencias_proveedores", "html": "<a data-system-web=\"diferencias_proveedores\" href=\"diferencias-proveedores.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7h17l-5-5 M21 17H4l5 5 M20 7l-5 5 M4 17l5-5\"/></svg></span><span>Diferencias proveedores</span></a>"}, {"id": "admin", "html": "<a data-system-web=\"admin\" href=\"soloadmin.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3 M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10\"/></svg></span><span>Administrar página</span></a>"}, {"id": "garantias", "html": "<a data-system-web=\"garantias\" href=\"garantías.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2l9 4v7c0 5-9 10-9 10S3 18 3 13V6z M12 5v14\"/></svg></span><span>Garantías</span></a>"}, {"id": "usuarios", "html": "<a data-system-web=\"usuarios\" href=\"usuarios.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 12a4 4 0 1 0 0-8a4 4 0 1 0 0 8 M2 22v-3a7 7 0 0 1 14 0v3 M17 4a4 4 0 0 1 0 8 M19 15a5 5 0 0 1 3 5\"/></svg></span><span>Usuarios</span></a>"}, {"id": "calculadoras", "html": "<a data-system-web=\"calculadoras\" href=\"calculadoras.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 2h14v20H5z M8 5h8v4H8z M8 13h1 M12 13h1 M16 13h1 M8 17h1 M12 17h1 M16 17h1\"/></svg></span><span>Calculadoras</span></a>"}, {"id": "configuracion", "html": "<a data-system-web=\"configuracion\" href=\"configuracion.html\" target=\"_blank\" rel=\"noopener\"><span class=\"system-menu-icon\" aria-hidden=\"true\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3 M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10\"/></svg></span><span>Configuración</span></a>"}],defaults=["lista", "a_descontar", "remitos", "historial", "comprobantes", "caja", "faltantes", "pedidos", "facturacion", "recibos_cobro", "cargar_facturas", "proveedores_sql", "ventas_tarjeta", "tarjetas", "actualizar_articulos", "carga_stock", "articulos_sql", "proveedores", "listas_proveedores", "diferencias_proveedores", "admin", "garantias", "usuarios", "calculadoras", "configuracion"];
const caption=document.createElement('span');caption.className='system-menu-caption';caption.textContent='WEB';caption.hidden=true;
const web=document.createElement('div');web.className='system-web-links';web.hidden=true;web.innerHTML=entries.map(item=>item.html).join('');
const main=menu.querySelector('a[href="menu.html"]');menu.insertBefore(caption,main);menu.insertBefore(web,main);
const sql=[...menu.querySelectorAll(':scope>.system-menu-group')];
const ids=['facturacion','recibos_cobro','caja','cargar_facturas','pagos_proveedores','carga_stock','proveedores_sql','articulos_sql','ventas_tarjeta'];
sql.forEach((group,i)=>group.dataset.sidebarOrderId=ids[i]);
const accountGroup=document.createElement('div');accountGroup.className='system-menu-group';accountGroup.dataset.sidebarOrderId='cuentas_corrientes';
const accountCard=document.createElement('div');accountCard.className='system-menu-card';
const accountButton=document.createElement('button');accountButton.type='button';accountButton.dataset.sqlModule='cuentas';
accountButton.innerHTML='<span class="system-menu-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 3h15v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 0v18m3-13h7m-7 4h7m-7 4h4"/></svg></span><span>Cuentas corrientes de clientes</span>';
accountCard.append(accountButton);accountGroup.append(accountCard);menu.insertBefore(accountGroup,caption);sql.push(accountGroup);
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
if(!invoiceSubmenu.querySelector('[data-system-section="customers"]')){const customers=document.createElement('button');customers.type='button';customers.dataset.systemSection='customers';customers.textContent='Clientes';invoiceSubmenu.append(customers);}
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
      menu.querySelectorAll('[data-sql-module]').forEach(button=>{const ids={compras:'cargar_facturas',stock:'carga_stock',historial:'historial_movimiento',proveedores:'proveedores_sql',articulos:'articulos_sql',tarjetas:'ventas_tarjeta',pagos:'pagos_proveedores',cuentas:'cuentas_corrientes'};button.hidden=!access?.(ids[button.dataset.sqlModule]);});
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
        const section=event.target.closest('[data-system-section]');if(section){const key=section.dataset.systemSection;location.href=(key.startsWith('receipts')?'recibos-cobro.html':key.startsWith('caja')?'caja.html':'gestion.html')+paths[key];}
        // SQL links are handled by the shared Web builder; provide its native route adapter below.
      });
      document.addEventListener('keydown',event=>{if(menu.hidden)return;if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=[...menu.querySelectorAll('button,a[href],select')].filter(el=>!el.hidden&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
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
    if((file==='proveedores-sql.html'&&new URLSearchParams(location.search).get('dialogo')==='1')||excluded.includes(file)||new URLSearchParams(location.search).has('embed')||document.documentElement.getRootNode()?.host)return;
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
      root.querySelectorAll('select:not([data-combo-source]):not([data-corralon-appearance])').forEach(select=>{
        const input=document.createElement('input');input.type='text';input.dataset.selectProxy='';input.className='shared-combo-input';input.setAttribute('aria-label',select.getAttribute('aria-label')||select.closest('label')?.firstChild?.textContent||select.name||'Seleccionar');
        for(const name of ['billField','valueField','field'])if(select.dataset[name])input.dataset[name]=select.dataset[name];
        select.before(input);select.hidden=true;select.dataset.comboSource='';input._sourceSelect=select;
        input.addEventListener('change',event=>{event.stopPropagation();const record=combos.get(input),value=record?.binding.getValue();if(value===null)return;select.value=String(value);select.dispatchEvent(new Event('change',{bubbles:true}));});
      });
      root.querySelectorAll('input[data-select-proxy],input[data-shared-combo]').forEach(input=>{
        const select=input._sourceSelect, spec=select?{items:Array.from(select.options).filter(x=>x.value!=='').map(x=>({value:x.value,label:x.textContent})),selectedValue:select.value}:options.combo?.(input);
        if(!spec)return;
        const signature=JSON.stringify([spec.items,spec.columns,spec.menuClass]);let record=combos.get(input);
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

  function ensureInvoiceHistory(){
    if(window.CorralonInvoiceHistory)return window.CorralonInvoiceHistory;
    const button=document.getElementById('consultInvoices');
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(value)||0);
    const number=value=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:4}).format(Number(value)||0);
    const styles=document.createElement('style');styles.textContent=`
      .receipt-values-scroll{max-height:88px;overflow:auto;scrollbar-gutter:stable}
      .invoice-receipt-detail .receipt-values-scroll .invoice-history-table th{height:24px}
      .invoice-receipt-detail .receipt-values-scroll .invoice-history-table td{height:32px}
      .invoice-history-overlay{position:fixed;inset:0;z-index:95;background:#0009;display:grid;place-items:center;padding:16px}
      .invoice-history-overlay[hidden]{display:none}.invoice-history-card{background:#fff;border-radius:12px;width:min(1200px,100%);height:min(850px,92dvh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 55px #0005;color:#151515;font:14px Barlow,Arial,sans-serif}
      .invoice-history-head{padding:12px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.invoice-history-head h2{margin:0;flex:1;font-size:22px}.invoice-history-card button{cursor:pointer;border:1px solid #bbb;border-radius:7px;background:#fff;padding:7px 12px;font:700 14px Barlow,Arial,sans-serif}.invoice-history-card button:disabled{opacity:.45;cursor:default}.invoice-history-card button.primary{background:#ed1019;color:#fff;border-color:#ed1019}
      .invoice-history-filters{padding:12px 16px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid #ddd;align-items:end}.invoice-history-filters label{display:grid;gap:4px;font-weight:700}.invoice-history-filters input,.invoice-history-filters select{height:33px;padding:4px 7px;border:1px solid #bbb;border-radius:5px;font:14px Barlow,Arial,sans-serif;max-width:100%}.invoice-history-filters input.date{width:130px}.invoice-history-filters .search{flex:1;min-width:180px}.invoice-history-status{padding:8px 16px;color:#666;min-height:30px}.invoice-history-status.error{color:#b00020}
      .invoice-history-scroll{flex:1;min-height:0;overflow:auto;padding:0 16px}.invoice-history-table{width:100%;border-collapse:collapse;font-size:14px}.invoice-history-table th{position:sticky;top:0;background:#eee;text-align:left;z-index:1}.invoice-history-table th,.invoice-history-table td{padding:9px 8px;border-bottom:1px solid #ddd}.invoice-history-table tbody tr:nth-child(even){background:#f6f6f6}.invoice-history-table tbody tr[data-invoice]{cursor:pointer}.invoice-history-table tbody tr[data-invoice]:hover{background:#ffe8e9}.invoice-history-table .money{text-align:right;white-space:nowrap}.invoice-history-table .cancelled{color:#b00020}.invoice-history-footer{padding:10px 16px;border-top:1px solid #ddd;display:flex;align-items:center;justify-content:space-between;gap:10px}.invoice-history-detail-summary{padding:12px 0;display:flex;gap:12px;flex-wrap:wrap}.invoice-history-detail-summary strong{display:block}.invoice-history-detail-summary>div{min-width:125px}.invoice-history-detail h3{margin:16px 0 8px}.invoice-history-detail-total{font-size:20px;font-weight:800;text-align:right;padding:12px 0}

      .invoice-history-card .invoice-history-table th button[data-sort]{display:inline-flex;align-items:center;gap:5px;border:0;border-radius:0;background:transparent!important;color:inherit!important;padding:0;font:inherit;font-weight:700;box-shadow:none;text-align:inherit}.invoice-history-table [data-sort-icon]{font-size:10px;color:#777}.invoice-history-table th[aria-sort="ascending"] [data-sort-icon],.invoice-history-table th[aria-sort="descending"] [data-sort-icon]{color:#ed1019}
      .shared-invoice-dialog::backdrop{background:transparent}
      @media print{.invoice-history-overlay{display:none!important}}

    .classic-history-list .invoice-history-filters,.classic-history-list .invoice-history-table thead:not(.classic-history-head),.invoice-history-overlay:not(.classic-history-list) .classic-history-head{display:none}
    .classic-history-list .invoice-history-status:empty,.invoice-history-loading[hidden]{display:none}
    .invoice-history-loading{position:fixed;inset:0;z-index:96;display:grid;place-items:center;pointer-events:none}
    .invoice-history-loading>div{display:grid;justify-items:center;gap:12px;padding:20px 24px;background:var(--corralon-white,#fff);color:var(--corralon-heading,#173b65);border:1px solid var(--corralon-line,#aaa);box-shadow:0 4px 16px #0002;font:700 14px Arial,sans-serif}
    .invoice-history-loading-ring{width:32px;height:32px;border:3px solid var(--corralon-line,#d6e0eb);border-top-color:var(--corralon-heading,#173b65);border-radius:50%;animation:invoice-history-spin .8s linear infinite}
    @keyframes invoice-history-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.invoice-history-loading-ring{animation:none}}
    .classic-receipt-heading{display:none}
    #systemInvoiceConsult :is(.classic-history-list,.classic-history-detail) .invoice-history-card{border-radius:0;background:#eee;color:#000;font:12px Arial,sans-serif}
    #systemInvoiceConsult .classic-history-list .invoice-history-scroll{padding:0;background:#fff}
    .classic-history-list .invoice-history-head{padding:2px 7px;background:#eee}
    .classic-history-list .invoice-history-head h2{font:bold 13px Arial}
    .classic-history-list :is(.invoice-history-status,.invoice-history-footer){background:#e5e7ea;min-height:0;padding:2px 6px}
    .classic-history-list .invoice-history-table{min-width:1320px;table-layout:fixed}
    .classic-history-list .invoice-history-table :is(td,th){height:21px;padding:0 3px;border:1px solid #929292;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .classic-history-list .invoice-history-table td{font:bold 16px/20px Arial,sans-serif;background:#fff}
    .classic-history-list .invoice-history-table th{background:#dbe0e5;color:#111;font:bold 16px/20px Arial;text-align:center}
    .classic-history-list .invoice-history-table :is(tr:hover,tr:focus-within)>td{background:#a5cde8}
    .classic-history-list .invoice-history-table td:nth-child(1),.classic-history-list .invoice-history-table td:nth-child(n+8){text-align:center}
    .classic-history-list .invoice-history-table td:nth-child(2){text-align:right}
    .classic-history-list .invoice-history-table td input{margin:0;vertical-align:middle}
    #systemInvoiceConsult :is(.classic-history-list,.classic-history-detail) .invoice-history-card button{border-radius:0;background:#eee;color:#000;box-shadow:none}
    .classic-history-list .invoice-history-table td button{min-height:0;padding:0 1px;font:11px/12px Arial}
    #systemInvoiceConsult .classic-history-detail .invoice-history-detail{display:block;overflow:auto;padding:4px 16px}
    #systemInvoiceConsult .classic-history-detail .receipt-layout{width:1300px;min-width:1300px;max-width:none;height:auto;min-height:0;gap:0}
    .classic-history-detail .classic-receipt-heading{display:flex;align-items:center;gap:12px;border-bottom:1px solid #000;padding:0 0 8px;margin-bottom:4px}
    .classic-receipt-navigation{display:inline-flex;align-items:center;gap:6px}
    .classic-receipt-navigation span{min-width:30px;text-align:center;white-space:nowrap;color:#555;font:11px Arial}
    #systemInvoiceConsult .classic-receipt-heading .classic-receipt-navigation button{width:39px;height:38px;min-height:38px;padding:0;border:2px outset #eee;font:bold 18px Arial;color:#00f}
    .classic-receipt-heading output{min-width:240px;text-align:center;border:2px inset white;background:#fff;font-weight:bold}
    .classic-history-detail .receipt-row{margin-bottom:4px;gap:6px}
    .classic-history-detail .receipt-field span{height:19px;border:1px inset #eee;background:#fff;color:#000;border-radius:0}
    .classic-history-detail .receipt-field .receipt-highlight{background:#ffc20a}
    .classic-history-detail .receipt-field .receipt-number{background:#15251b;color:#fff}
    .classic-history-detail .receipt-field .receipt-total{background:#000;color:#fff}
    #systemInvoiceConsult .classic-history-detail .receipt-articles{flex:none;height:180px;min-height:0;width:1105px;margin:4px 0}
    .classic-history-detail .receipt-grid{border:1px solid #000;border-radius:0;background:#fff}
    .classic-history-detail .receipt-grid .invoice-history-table :is(td,th){height:20px;padding:0 3px;border:1px solid #ddd;font:14px/19px Arial}
    .classic-history-detail .receipt-grid .invoice-history-table th{background:#dbe0e5;color:#111}
    .classic-history-detail .receipt-grid tr:not(.receipt-empty):hover td,.classic-history-detail .receipt-grid tbody tr:first-child:not(.receipt-empty) td{background:#a5cde8}
    .classic-history-detail .receipt-records{background:#e5e7ea;padding:1px 4px;border:0}
    .classic-history-detail .receipt-values-area{width:1118px;gap:16px;margin:0 0 4px}
    .classic-history-detail .receipt-values-area .receipt-grid{width:835px}
    #systemInvoiceConsult .classic-history-detail .receipt-values-scroll{height:61px;max-height:61px}
    #systemInvoiceConsult .classic-history-detail :is(.receipt-articles-scroll,.receipt-values-scroll) .invoice-history-table :is(th,td){height:20px;min-height:0;padding:0 3px;line-height:19px;box-sizing:border-box}
    html #systemInvoiceConsult .classic-history-detail .receipt-values-scroll .invoice-history-table[data-edit-values] tbody td :is(input,select){
      height:19px!important;min-height:0!important;padding:0 2px!important;
      appearance:none!important;-webkit-appearance:none!important;
      border:0!important;border-radius:0!important;box-shadow:none!important;
      background:transparent!important;color:inherit!important;font:inherit;vertical-align:top;
      box-sizing:border-box;outline-offset:-1px
    }
    html #systemInvoiceConsult .classic-history-detail .receipt-values-scroll .invoice-history-table[data-edit-values] tbody td select{
      padding-right:14px!important;
      background:linear-gradient(45deg,transparent 50%,#444 50%) right 7px center/4px 4px no-repeat,
                 linear-gradient(135deg,#444 50%,transparent 50%) right 3px center/4px 4px no-repeat!important
    }
    #systemInvoiceConsult .classic-history-detail .receipt-values-scroll tbody tr:first-child>td,
    #systemInvoiceConsult .classic-history-detail .receipt-values-scroll tbody tr:focus-within>td{background:#deedff!important}
    html #systemInvoiceConsult .classic-history-detail .receipt-values-scroll .invoice-history-table[data-edit-values] tbody td button{
      appearance:none;height:18px;min-height:0;line-height:16px;
      border:0!important;box-shadow:none!important;background:transparent!important
    }
    .classic-history-list input[data-unknown-flag]{opacity:.55}
    .classic-history-detail .receipt-tax-summary{width:267px}
    .classic-history-detail .receipt-actions .invoice-history-footer{padding:4px;gap:6px;margin-top:0}
    .classic-history-detail .receipt-actions .invoice-history-footer button{border:2px outset #eee;min-width:88px;font:bold 12px Arial}
    .classic-sale-search[hidden]{display:none!important}
    .classic-sale-search{padding:4px 20px 8px;background:#eaf5f7;color:#000;overflow:auto;font:700 18px/1.05 'Times New Roman',serif;min-height:466px}
    .classic-sale-search *{box-sizing:border-box}
    .classic-sale-search header{display:grid;grid-template-columns:862px 44px;gap:65px;align-items:center;margin-bottom:8px}
    .classic-sale-search h2{margin:0;border:1px groove #fff;text-align:center;font:bold 20px/27px Arial,sans-serif}
    .classic-sale-search-layout{display:flex;gap:38px;align-items:flex-start;min-width:1015px}
    .classic-sale-search form{width:862px;min-height:418px;border:2px groove #fff;position:relative;padding:10px 39px;display:grid;grid-template-columns:454px 309px;gap:16px}
    .classic-sale-search .classic-sale-dates{display:flex;align-items:center;gap:7px;position:absolute;top:10px;left:45px}
    .classic-sale-search label{display:flex;align-items:center;justify-content:flex-end;white-space:nowrap;gap:2px}
    .classic-sale-search input,.classic-sale-search select{height:24px;width:205px;padding:0 4px;border:2px inset #eee;border-radius:0;background:#fff;color:#000;font:16px Arial,sans-serif}
    .classic-sale-search .classic-sale-dates input{width:114px;font:bold 18px 'Times New Roman',serif}
    .classic-sale-search button{font:inherit;color:#000;background:#eee;border:2px outset #eee;border-radius:0;cursor:pointer}
    .classic-sale-search .classic-sale-dates button{height:29px;width:39px;color:blue}
    .classic-sale-search header button{height:29px}
    .classic-sale-search .classic-sale-left{padding:41px 64px 3px 58px;display:grid;align-content:space-between}
    .classic-sale-search .classic-sale-left label{margin-bottom:6px}
    .classic-sale-search [data-classic-branch]{width:268px}
    .classic-sale-search [data-classic-point]{width:235px}
    .classic-sale-search .classic-sale-left select:disabled{width:78px;background:#cff}
    .classic-sale-search .classic-sale-right{display:flex;flex-direction:column;gap:6px;padding-top:3px}
    .classic-sale-search .classic-sale-right>label{margin-bottom:2px}
    .classic-sale-search .classic-sale-right>label:not(:first-child){justify-content:flex-start;margin-top:3px}
    .classic-sale-search .classic-sale-right input{width:156px}
    .classic-sale-search .classic-sale-right select{width:60px}
    .classic-sale-search button[data-criterion]{position:relative;margin-left:33px;width:calc(100% - 33px);height:21px;padding:0;text-align:left;border:1px solid #000;background:#fff}
    .classic-sale-search button[data-criterion]::before{content:'';position:absolute;left:-34px;top:-1px;width:27px;height:21px;background:#eee;border:2px outset #eee;box-sizing:border-box}
    .classic-sale-search button:disabled{cursor:default;color:#555}
    .classic-sale-search button[data-criterion]:disabled{opacity:.5}
    .classic-sale-search aside{width:112px;display:grid;gap:14px;padding-top:4px}
    .classic-sale-search aside button{padding:5px 4px}
    .classic-sale-search [data-classic-status]{margin:4px 0;font:13px Arial,sans-serif}
    html:not([data-corralon-theme="classic"]) #systemInvoiceConsult{
      --consult-bg:#f4f8fd;
      --consult-line:var(--corralon-line,#cadcf0);
      --consult-text:var(--corralon-heading,#173b65);
      --consult-selected:#deedff;
      & :is(.classic-sale-search,.classic-history-list .invoice-history-card,.classic-history-detail .invoice-history-card){
        background:var(--consult-bg);color:var(--consult-text);border:1px solid var(--consult-line);border-radius:9px;font-family:Arial,sans-serif
      }
      & :is(.classic-sale-search header h2,.classic-history-list .invoice-history-head){
        background:linear-gradient(110deg,#2164bd,#25adeb);color:#fff;border:0;border-radius:6px
      }
      & :is(.classic-sale-search form,.classic-history-detail .receipt-grid,.classic-history-detail .receipt-actions .invoice-history-footer){
        background:#fff;border:1px solid var(--consult-line);border-radius:6px
      }
      & :is(.classic-sale-search,.classic-history-list,.classic-history-detail) button{
        color:var(--consult-text);background:linear-gradient(#fff,#eaf3fc);border:1px solid var(--consult-line);border-radius:5px
      }
      & .classic-sale-search{font-size:14px}
      & .classic-sale-search :is(input,select){
        color:var(--consult-text);background:#fff;border:1px solid var(--consult-line);border-radius:4px;font:14px Arial,sans-serif
      }
      & .classic-sale-search button[data-criterion]::before{
        background:#e5f1fc;border:1px solid var(--consult-line);border-radius:4px
      }
      & .classic-sale-search :is(button,input,select):disabled{opacity:.5}
      & :is(.classic-history-list,.classic-history-detail) .invoice-history-table :is(th,td){
        border-color:var(--consult-line);color:var(--consult-text)
      }
      & .classic-history-list .invoice-history-table :is(th,td){font:13px/20px Arial,sans-serif}
      & :is(.classic-history-list,.classic-history-detail) .invoice-history-table th{background:linear-gradient(#e8f2ff,#d9eafa)}
      & :is(.classic-history-list,.classic-history-detail) .invoice-history-table tbody tr:nth-child(even)>td{background:#f4f8fd}
      & :is(.classic-history-list,.classic-history-detail) .invoice-history-table tbody tr:not(.receipt-empty):is(:hover,:focus-within)>td{background:var(--consult-selected)}
      & :is(.invoice-history-status,.invoice-history-footer,.receipt-records){background:var(--consult-bg);color:var(--consult-text)}
      & .classic-receipt-heading{border-color:var(--consult-line)}
      & .classic-history-detail .receipt-row{flex-wrap:nowrap;padding:0}
      & :is(.classic-receipt-heading output,.classic-history-detail .receipt-field>span){
        height:20px;min-height:20px;padding:1px 4px;background:#fff;color:var(--consult-text);border:1px solid var(--consult-line);border-radius:4px
      }
      & .classic-history-detail .receipt-field :is(.receipt-highlight,.receipt-number,.receipt-total){
        background:var(--consult-selected);color:var(--consult-text);font-weight:700
      }
      & .classic-history-detail .receipt-articles-scroll{margin:0;border:0;border-radius:0}
      & .classic-history-detail .receipt-values-area{display:flex;width:1118px}
      & .classic-history-detail .receipt-values-area>.receipt-grid{flex:0 0 835px}
      & .classic-history-detail .receipt-tax-summary{
        flex:0 0 267px;width:267px;display:flex;flex-direction:column;gap:3px;padding:0
      }
      & .classic-history-detail .receipt-tax-summary .receipt-field{
        display:flex;justify-content:space-between;gap:8px;padding:0
      }
      & .classic-history-detail .receipt-tax-summary .receipt-field>span{
        flex:0 0 145px;width:145px!important;height:20px;min-height:20px
      }
    }
  `;styles.textContent+='\n    .invoice-receipt-detail .invoice-history-card{width:min(1330px,100%);font-size:12px;background:#f3f3f3}\n    .invoice-receipt-detail .invoice-history-head{padding:7px 12px;background:white}.invoice-receipt-detail .invoice-history-head h2{font-size:19px}\n    .invoice-receipt-detail .invoice-history-detail{padding:8px 12px;overflow:auto}.receipt-layout{min-width:1080px;max-width:1300px}\n    .receipt-row{display:flex;align-items:center;gap:9px;margin-bottom:5px;white-space:nowrap}.receipt-field{display:flex;align-items:center;gap:3px;font-size:11px;font-weight:700;min-width:0}.receipt-field span{display:block;height:22px;padding:2px 5px;border:1px solid #b9b9b9;background:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;font-weight:600}.receipt-field span.receipt-number{background:#111;color:#ffef66}.receipt-field span.receipt-highlight{background:#fff5ad}.receipt-field input{margin:0;width:14px;height:14px}\n    .receipt-grid{border:1px solid #999;background:#fff;overflow:auto;margin-top:7px;width:1110px;max-width:100%}.receipt-grid .invoice-history-table{font-size:13px;table-layout:fixed}.receipt-grid .invoice-history-table th,.receipt-grid .invoice-history-table td{padding:2px 5px;height:22px;border-right:1px solid #ddd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.receipt-grid .invoice-history-table th{font-weight:600;background:#e5e8eb}.receipt-grid .invoice-history-table tr.receipt-empty td{height:22px;background:#fff}.receipt-records{padding:2px 5px;font-size:11px;border-top:1px solid #bbb;background:#ececec}\n    .receipt-values-area{display:flex;align-items:start;gap:16px;width:1110px;margin:3px 0 7px}.receipt-values-area .receipt-grid{width:835px;margin:0}.receipt-tax-summary{width:265px;display:grid;gap:5px;padding-top:1px}.receipt-tax-summary .receipt-field{justify-content:end}.receipt-tax-summary .receipt-field span{text-align:right;width:115px}\n    .receipt-totals .receipt-field span{text-align:right}.receipt-totals .receipt-field .receipt-total{color:#fff;background:#111;font-weight:800}.receipt-actions .invoice-history-footer{background:transparent;justify-content:start;border:1px solid #bbb;padding:5px;margin-top:8px;gap:8px}.receipt-actions .invoice-history-footer [data-action-status]:empty{display:none}.receipt-actions .invoice-history-footer button{border-radius:3px;height:34px;font-size:12px}\n';styles.textContent+=`
      .invoice-receipt-detail .invoice-history-card{height:calc(100vh - 32px);height:calc(100dvh - 32px);max-height:calc(100dvh - 32px);min-height:0}
      .invoice-receipt-detail .invoice-history-head{flex-shrink:0}
      .invoice-receipt-detail .invoice-history-detail{display:flex;min-height:0;overflow-x:auto;overflow-y:hidden}
      .invoice-receipt-detail .receipt-layout{display:flex;flex-direction:column;flex:1;min-height:0;height:100%}
      .invoice-receipt-detail .receipt-layout>*{flex-shrink:0}
      .invoice-receipt-detail .receipt-articles{display:flex;flex-direction:column;flex:1 1 0;min-height:0;overflow:hidden}
      .receipt-articles-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
      .receipt-articles-scroll thead th{position:sticky;top:0;z-index:1}
      .receipt-articles .receipt-records{flex-shrink:0}
  `;document.head.appendChild(styles);
    // Cargar los ajustes de telefono tambien cuando este modulo se reutiliza en Caja.
    const mobileStyles=document.querySelector('link[data-facturacion-mobile]')||document.createElement('link');
    mobileStyles.rel='stylesheet';mobileStyles.href='facturacion-mobile.css';mobileStyles.setAttribute('data-facturacion-mobile','');
    document.head.appendChild(mobileStyles);
    const overlay=document.createElement('div');overlay.className='invoice-history-overlay';overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Consultar boletas');
    overlay.innerHTML=`<section class="invoice-history-card"><header class="invoice-history-head"><h2>Consultar boletas</h2><button data-close type="button">Cerrar</button></header><form class="invoice-history-filters"><label>Sucursal<select data-branch><option value="0">Todas las sucursales</option></select></label><label>Punto de venta<select data-point><option value="0">Todos los puntos de venta</option></select></label><label>Desde<input class="date" data-from inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" required></label><label>Hasta<input class="date" data-to inputmode="numeric" autocomplete="off" placeholder="dd/mm/aaaa" required></label><label class="search">Cliente o número<input data-search autocomplete="off" placeholder="Buscar cliente o boleta…" maxlength="80"></label><label class="search">Artículo<input data-article autocomplete="off" placeholder="Descripción, IDArt o código de proveedor…" maxlength="100"></label><button class="primary" type="submit">Consultar</button></form><div class="invoice-history-status" data-status role="status" aria-live="polite"></div><div class="invoice-history-scroll"><table class="invoice-history-table"><thead><tr><th aria-sort="none"><button type="button" data-sort="numero">Número <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="tipo">Tipo <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="cliente">Cliente <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="sucursal">Sucursal <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="fecha">Fecha <span data-sort-icon aria-hidden="true">↕</span></button></th><th class="money" aria-sort="none"><button type="button" data-sort="total">Total <span data-sort-icon aria-hidden="true">↕</span></button></th><th aria-sort="none"><button type="button" data-sort="estado">Estado <span data-sort-icon aria-hidden="true">↕</span></button></th><th></th></tr></thead><tbody data-rows></tbody></table></div><footer class="invoice-history-footer"><span data-position></span><span data-more-status role="status" aria-live="polite"></span><button data-retry-more type="button" hidden>Reintentar carga</button></footer></section>`;document.body.appendChild(overlay);
    const get=selector=>overlay.querySelector(selector),status=get('[data-status]');
    status.insertAdjacentHTML('afterend','<div class="invoice-history-loading" role="status" hidden><div><span class="invoice-history-loading-ring" aria-hidden="true"></span>Consultando boletas…</div></div>');
    const loading=get('.invoice-history-loading');

  const classicSearch=document.createElement('section');
  classicSearch.className='classic-sale-search';
  classicSearch.hidden=true;
  const criterion=(mode,label,available=true)=>'<button type="button" data-criterion="'+mode+'"'+(available?'':' disabled title="Filtro no disponible en la consulta web"')+'>'+label+'</button>';
  classicSearch.innerHTML='<header><h2>Consultar Comprobantes de Ventas</h2><button type="button" data-classic-exit aria-label="Cerrar consulta">↦</button></header>'+
    '<div class="classic-sale-search-layout"><form><div class="classic-sale-dates">'+
    '<label>Desde:<input data-classic-from autocomplete="off"></label><label>Hasta:<input data-classic-to autocomplete="off"></label>'+
    '<button type="button" data-shift="-1" aria-label="Día anterior">◂</button><button type="button" data-shift="1" aria-label="Día siguiente">▸</button></div>'+
    '<div class="classic-sale-left">'+
    '<div><label>Sucursal: <select data-classic-branch></select></label>'+criterion('branch','Entre Fecha y Sucursal')+'</div>'+
    '<div><label>Punto de Venta: <select data-classic-point></select></label>'+criterion('point','Entre Fecha y Pto. de Venta')+'</div>'+
    '<div><label>Cliente: <input data-classic-client maxlength="80" autocomplete="off"></label>'+criterion('client','Por Cliente')+'</div>'+
    '<div><label>Cli. Temp.: <input disabled></label>'+criterion('temporary','Por Fechas y Cliente Temp.',false)+'</div>'+
    '<div><label>Tipo de Comprobante: <select disabled aria-label="Tipo de Comprobante"><option></option></select></label>'+criterion('type','Por Comprobante e/Fechas',false)+'</div></div>'+
    '<div class="classic-sale-right"><label>Nº Comprobante:<input data-classic-number maxlength="80" autocomplete="off"></label>'+
    criterion('number','Por Nº de Factura')+criterion('work','Por Nº de O. de Trabajo',false)+criterion('remit','Por Nº de Remito',false)+
    criterion('order','Por Nº de O. de Cpra.',false)+criterion('note','Por Texto en Nota',false)+criterion('cae','Por Nº de CAE',false)+
    '<label>Desc. del Art.:<input data-classic-article maxlength="100" autocomplete="off"></label>'+criterion('article','Por Desc. del Artículo')+
    '<label>Nº de Operador:<select disabled aria-label="Nº de Operador"><option></option></select></label>'+
    criterion('pending','Pendientes p/Comp. e/Fechas',false)+criterion('seller','Por Fechas y Vendedor',false)+criterion('delivery','Por Fechas y Repartidor',false)+'</div>'+
    '</form><aside><button type="button" data-classic-exit>Ir a Facturación</button><button type="button" disabled>Recuperar CAE/Ver Estado WS</button></aside></div>'+
    '<p data-classic-status role="status"></p>';
  const classicField=name=>classicSearch.querySelector('[data-classic-'+name+']');
  const classicStatus=classicField('status');
  function closeClassicSearch(){classicSearch.hidden=true;}
  function showClassicSearch(){
    overlay.hidden=true;classicSearch.hidden=false;classicStatus.textContent='';
    classicField('from').focus();
  }
  function searchClassic(mode){
    if(!historyConfig){classicStatus.textContent='Esperá a que carguen las sucursales.';return;}
    const required={client:'client',number:'number',article:'article'}[mode];
    const value=required?classicField(required).value.trim():'';
    if(required&&!value){classicField(required).focus();return;}
    const fullNumber=mode==='number'&&/^\d{4}-\d{8}$/.test(normalizeReceiptSearch(value));
    if(!fullNumber){
      const from=dateInput(classicField('from')),to=dateInput(classicField('to'));
      if(!from||!to||from>to){classicStatus.textContent='Ingresá un rango de fechas válido.';return;}
    }
    for(const name of ['from','to'])get('[data-'+name+']').value=classicField(name).value;
    get('[data-branch]').value=mode==='branch'?classicField('branch').value:'0';
    get('[data-point]').value=mode==='point'?classicField('point').value:'0';
    get('[data-search]').value=mode==='client'||mode==='number'?value:'';
    get('[data-article]').value=mode==='article'?value:'';
    closeClassicSearch();
    overlay.hidden=false;
    load();
  }
  classicSearch.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(button?.disabled)return;
    if(button?.hasAttribute('data-classic-exit')){close();return;}
    if(button?.dataset.criterion){searchClassic(button.dataset.criterion);return;}
    const shift=Number(button?.dataset.shift);
    if(!shift)return;
    for(const name of ['from','to']){
      const field=classicField(name),value=dateInput(field);
      if(!value)continue;
      const date=new Date(value+'T12:00:00');
      date.setDate(date.getDate()+shift);
      field.value=dateText(date);
    }
  });
  classicSearch.querySelector('form').addEventListener('submit',event=>{
    event.preventDefault();
    const modes=new Map([['number','number'],['client','client'],['article','article'],['point','point']]);
    const mode=[...modes.keys()].find(name=>classicField(name)===document.activeElement);
    searchClassic(modes.get(mode)||'branch');
  });
  bindFlexibleDates({root:classicSearch,selector:'[data-classic-from],[data-classic-to]'});
  for(const name of ['from','to'])classicField(name).addEventListener('input',()=>classicField(name).setCustomValidity(''));

  const detail=document.createElement('div');detail.className='invoice-history-overlay';detail.hidden=true;detail.style.zIndex='96';detail.classList.add('invoice-receipt-detail');detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');detail.setAttribute('aria-label','Detalle de boleta');
    detail.innerHTML=`<section class="invoice-history-card"><header class="invoice-history-head"><h2 data-title>Boleta</h2><button data-detail-prev type="button" aria-label="Boleta anterior">‹</button><span data-detail-position></span><button data-detail-next type="button" aria-label="Boleta siguiente">›</button><button data-detail-close type="button">Cerrar</button></header><div class="invoice-history-scroll invoice-history-detail" data-detail-body></div><footer class="invoice-history-footer"><span data-action-status role="status"></span><div><button data-preview type="button" disabled>Vista previa</button> <button data-reprint type="button" disabled>Reimprimir</button> <button data-recall class="primary" type="button" disabled>Llamar a facturar</button></div></footer></section>`;document.body.appendChild(detail);
    let historyConfig=null,returnFocus=null,directOpenSequence=0,detailOptions={};
    const annulButton=document.createElement('button');annulButton.type='button';annulButton.dataset.annul='';annulButton.textContent='Anular boleta';annulButton.hidden=true;annulButton.disabled=true;annulButton.style.cssText='margin-left:8px;color:#b00020;border-color:#e4aab3;background:#fff3f4';
    detail.querySelector('.invoice-history-footer>div').appendChild(annulButton);
    let rows=[],page=0,hasMore=false,listController=null,sequence=0,detailSequence=0,detailIndex=-1,searchTimer=null,actionBusy=false,detailData=null;
    const invoiceDetails=new Map(),invoiceDetailTtl=30000,invoiceDetailLimit=20;
    let listLoading=false,moreError=false,listQuery='',listSnapshot='',snapshotExpired=false,totalRecords=null;
    let sortField='',sortDirection='';

    function historyDateTime(value){
      if(!value)return '—';
      const text=String(value);
      const parts=text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}:\d{2})/);
      if(parts)return parts[3]+'/'+parts[2]+'/'+parts[1]+' '+parts[4];
      const dotNet=text.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
      const date=new Date(dotNet?Number(dotNet[1]):text);
      return Number.isNaN(date.getTime())?'—':date.toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    }
    const classicHeaders=[['',18],['P. V.',55],['Fecha',112,'fecha'],['TC',176,'tipo'],['Nº',146,'numero'],['Cliente',224,'cliente'],['FechaYHora',188],['Total',130,'total'],['Anul.',60,'estado'],['En Inf. Vtas.',94],['Actualiza Stock',114]];
    const historyTable=get('.invoice-history-table');
    historyTable.insertAdjacentHTML('afterbegin','<thead class="classic-history-head"><tr>'+classicHeaders.map(([label,width,sort])=>'<th style="width:'+width+'px"'+(sort?' aria-sort="none"':'')+'>'+(sort?'<button type="button" data-sort="'+sort+'">'+label+' <span data-sort-icon aria-hidden="true">↕</span></button>':label)+'</th>').join('')+'</tr></thead>');
    function classicHistoryCells(row,index){
      const flag=(value,label)=>'<input type="checkbox" disabled aria-label="'+label+'"'+(value==null?' data-unknown-flag title="Valor no informado por la API" aria-checked="mixed"':Number(value)?' checked':'')+'>';
      return '<td><button type="button" data-invoice="'+index+'" aria-label="Abrir comprobante">⊞</button></td><td>'+escape(row.puntoVenta??'')+'</td><td>'+escape(row.fecha)+'</td><td>'+escape(row.tipo)+'</td><td>'+escape(row.numero)+'</td><td>'+escape(String(row.cliente||'').toUpperCase())+'</td><td>'+escape(historyDateTime(row.fechaHora))+'</td><td class="money">'+escape(money(row.total))+'</td><td>'+flag(row.anulada,'Anulada')+'</td><td>'+flag(row.enInformeVentas,'En informe de ventas')+'</td><td>'+flag(row.actualizaStock,'Actualiza stock')+'</td>';
    }
    function paintSort(){
      overlay.querySelectorAll('[data-sort]').forEach(button=>{
        const active=button.dataset.sort===sortField;
        button.closest('th').setAttribute('aria-sort',active?(sortDirection==='asc'?'ascending':'descending'):'none');
        button.querySelector('[data-sort-icon]').textContent=active?(sortDirection==='asc'?'▲':'▼'):'↕';
        button.title=active?(sortDirection==='asc'?'Ordenar descendente':'Restaurar orden original'):'Ordenar ascendente';
      });
    }
    overlay.querySelector('thead').addEventListener('click',event=>{
      const button=event.target.closest('[data-sort]');if(!button)return;
      if(sortField!==button.dataset.sort){sortField=button.dataset.sort;sortDirection='asc'}
      else if(sortDirection==='asc')sortDirection='desc';else{sortField='';sortDirection=''}
      paintSort();load(0);
    });
    paintSort();
    let cancellationBusy=false;
    function valuesUser(){return window.CorralonFunciones?.menuSessionUser?.()||{}}
    function isAdministrator(){if(detailOptions.readOnly===true)return false;return typeof detailOptions.allowAnnul==='boolean'?detailOptions.allowAnnul:window.CorralonFunciones.menuUserIsAdministrator('facturacion',valuesUser());}
    function historyActions(){return detailOptions.actions||window.CorralonInvoiceHistoryActions||{}}
    function refreshAnnulButton(){
      annulButton.hidden=!isAdministrator();
      annulButton.disabled=actionBusy||!detailData?.versionAnulacion||!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||Boolean(detailData?.bloqueoAnulacionFiscal)||Boolean(detailData?.valuesDirty);
      annulButton.title=detailData?.bloqueoAnulacionFiscal?'Debe hacer una nota de crédito/débito.':detailData?.valuesDirty?'Guardá los valores antes de anular.':'';
    }
    function valueNumber(value){if(typeof value==='number')return value;const text=String(value??'').replace(/[^\d,.-]/g,'');return Number(text.includes(',')?text.replace(/\./g,'').replace(',','.'):text)||0;}
    function receiptValuesBasis(result=detailData){
      if(result.valuesArticleBasis==null){const h=result.comprobante;result.valuesArticleBasis=h.totalArticulos!=null?Math.abs(Number(h.totalArticulos)):result.articulos?.length?Math.abs(result.articulos.reduce((sum,row)=>sum+Number(row.importe||0),0)):Math.abs(Number(h.total))-Number(h.ajusteEmitido??result.valores.reduce((sum,row)=>sum+Number(row.impRec||0),0));}
      return Math.round(result.valuesArticleBasis*100)/100;
    }
    function receiptValuesBalance(values=detailData.valores){
      const round=value=>Math.round(value*100)/100,issued=Math.abs(Number(detailData.comprobante.total)),articles=receiptValuesBasis(),base=values.reduce((sum,row)=>sum+Number(row.importe||0),0),adjustment=values.reduce((sum,row)=>sum+Number(row.impRec||0),0),total=values.reduce((sum,row)=>sum+Number(row.total||0),0),expectedAdjustment=round(issued-articles);
      const cashDifference=round(total-issued),baseDifference=round(articles-base),adjustmentDifference=round(adjustment-expectedAdjustment);
      return {issued,articles,base,adjustment,total,expectedAdjustment,cashDifference,baseDifference,adjustmentDifference,invalid:cashDifference!==0||baseDifference!==0||adjustmentDifference!==0};
    }
    function blankValue(){const type=valueTypes().find(p=>Number(p.clase)===1)||valueTypes()[0],remaining=Math.max(0,Math.round((Math.abs(Number(detailData.comprobante.total))-detailData.valores.reduce((sum,v)=>sum+Number(v.total||0),0))*100)/100);return{orden:null,idTipoPago:type?.id||0,tipo:type?.nombre||'',clase:type?.clase||0,idTarjeta:0,tarjeta:'Ninguna',importe:remaining,coef:0,impRec:0,total:remaining,cuotas:0,descripcion:''};}
    function valueInput(v,i,key,text){return `<input data-value-index="${i}" data-value-key="${key}" ${key==='descripcion'?'maxlength="30"':'inputmode="decimal" class="money"'} value="${escape(text)}" style="width:100%;height:26px;border:0;background:transparent;padding:2px 5px;font:inherit;${key==='descripcion'?'':'text-align:right'}">`;}
    function editableValuesTable(values){return `<div class="receipt-grid" style="width:835px"><div class="receipt-values-scroll"><table class="invoice-history-table" data-edit-values><colgroup>${[15,15,14,7,15,10,10,11,3].map(w=>`<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${['Tipo de valor','Importe','Tarjeta / cuenta','Cuotas','Descripción','% Dto./Rec.','$ Dto./Rec.','Total',''].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${values.map((v,i)=>{const cells=valueCells(v,i);return `<tr data-value-row="${i}"><td>${cells[0]}</td><td>${valueInput(v,i,'importe',money(v.importe))}</td><td>${cells[1]}</td><td>${cells[2]}</td><td>${valueInput(v,i,'descripcion',v.descripcion||'')}</td><td>${valueInput(v,i,'coef',number(Number(v.coef||0)*100)+' %')}</td><td>${valueInput(v,i,'impRec',money(v.impRec))}</td><td>${valueInput(v,i,'total',money(v.total))}</td><td><button type="button" data-remove-value="${i}" aria-label="Quitar valor" style="border:0;padding:0;color:#d00008;background:transparent">×</button></td></tr>`;}).join('')}</tbody></table></div><div class="receipt-records" style="display:flex;justify-content:space-between"><span>${values.length} valores</span><button type="button" data-add-value style="padding:0 5px;font-size:11px">+ Renglón</button></div><div class="receipt-values-difference" style="padding:4px 5px;text-align:right">Diferencia: <strong data-values-difference></strong></div></div>`;}
    function updateValueTotals(){
      const h=detailData.comprobante,sign=Number(h.total)<0?-1:1;h.efectivo=0;h.tarjeta=0;h.cuentaCorriente=0;h.cheque=0;
      for(const v of detailData.valores){const kind=Number((historyConfig.tiposPago||[]).find(p=>Number(p.id)===Number(v.idTipoPago))?.clase||v.clase);const bucket=({1:'efectivo',2:'cheque',3:'cheque',5:'tarjeta',6:'cuentaCorriente'})[kind];if(bucket)h[bucket]+=Number(v.total||0)*sign;}
      detailData.valuesDirty=true;
    }
    function reconcileCashDifference(){
      let keptAutomatic=false;
      detailData.valores=detailData.valores.filter(v=>{if(!v.autoDifference)return true;if(keptAutomatic)return false;keptAutomatic=true;return true;});
      const values=detailData.valores,cash=valueTypes().find(p=>Number(p.clase)===1);if(!cash)return;
      const automatic=values.find(v=>v.autoDifference),manual=values.filter(v=>!v.autoDifference),state=receiptValuesBalance(),round=value=>Math.round(value*100)/100;
      const remainingBase=round(state.articles-manual.reduce((sum,v)=>sum+Number(v.importe||0),0)),remainingAdjustment=round(state.expectedAdjustment-manual.reduce((sum,v)=>sum+Number(v.impRec||0),0)),remaining=round(remainingBase+remainingAdjustment);
      if(remainingBase>0&&remaining>0){const row=automatic||{...blankValue(),idTipoPago:cash.id,tipo:cash.nombre,clase:cash.clase,autoDifference:true};row.importe=remainingBase;row.impRec=remainingAdjustment;row.coef=remainingAdjustment/remainingBase;row.total=remaining;if(!automatic)values.push(row);}
      else if(automatic)values.splice(values.indexOf(automatic),1);
      updateValueTotals();
    }
    function refreshValueOutputs(){
      refreshAnnulButton();
      const values=detailData.valores,total=values.reduce((sum,v)=>sum+Number(v.total||0),0),difference=Math.round((total-Math.abs(Number(detailData.comprobante.total)))*100)/100;
      const state=receiptValuesBalance();let output=detail.querySelector('[data-values-difference]');
      if(!output){const line=document.createElement('div');line.className='receipt-values-difference';line.style.cssText='padding:4px 5px;text-align:right';line.innerHTML='Diferencia: <strong data-values-difference></strong>';detail.querySelector('.receipt-values-area .receipt-grid')?.append(line);output=line.querySelector('strong');}
      if(output){output.textContent=money(state.cashDifference||state.baseDifference||state.adjustmentDifference);output.style.color=state.invalid?'#b00020':'#087a20';output.title='Cobro: '+money(state.cashDifference)+' · Base: '+money(state.baseDifference)+' · Ajuste: '+money(state.adjustmentDifference);
        let info=detail.querySelector('[data-values-adjustment-info]');if(!info){info=document.createElement('div');info.dataset.valuesAdjustmentInfo='';info.style.cssText='padding:4px 5px;font-size:12px;line-height:1.4';output.parentElement.after(info);}info.hidden=!state.invalid&&!state.expectedAdjustment;info.style.color=state.invalid?'#b00020':'#173b65';info.textContent='Artículos: '+money(state.articles)+' · Descuento/recargo emitido: '+money(state.expectedAdjustment)+' · En valores: '+money(state.adjustment)+(state.invalid?' · Revisá la base y el ajuste antes de guardar.':'');
        let restore=detail.querySelector('[data-restore-issued-adjustment]');if(!restore&&canEditValues()){restore=document.createElement('button');restore.type='button';restore.dataset.restoreIssuedAdjustment='';restore.textContent='Reasignar ajuste emitido';restore.style.cssText='margin:4px 5px;padding:5px 9px;font-size:12px';info.after(restore);}if(restore)restore.hidden=!canEditValues()||!state.invalid||state.cashDifference!==0;
      }
      for(const [label,value] of [['Efectivo:',detailData.comprobante.efectivo],['Tarjeta:',detailData.comprobante.tarjeta],['Cta. Cte.:',detailData.comprobante.cuentaCorriente],['Cheque:',detailData.comprobante.cheque],['Total Valores:',total],['Dto./Rec.:',values.reduce((sum,v)=>sum+Number(v.impRec||0),0)]]){
        const field=[...detail.querySelectorAll('.receipt-field')].find(el=>el.firstChild.textContent===label)?.querySelector('span');if(field)field.textContent=money(value);
      }
    }
    function canEditValues(data=detailData){if(data?.valueRulesUnavailable)return false;if(detailOptions.readOnly===true)return false;const user=valuesUser(),allowed=String(user.nivel||'').toLowerCase()==='administrador'||(user.permisos?.includes('facturacion')&&user.permisosEdicion?.includes('facturacion'));return (allowed || detailOptions.allowEditValues===true)&&Number(data?.comprobante?.confirmado)!==0&&!Number(data?.comprobante?.anulada)&&Boolean(data?.versionValores)}
    function canEditHeader(){if(!canEditValues())return false;const user=valuesUser(),isAdministrator=window.CorralonFunciones?.menuUserIsAdministrator;if(typeof isAdministrator==='function')return Boolean(isAdministrator('facturacion',user));return String(user.nivel||'').trim().toLowerCase()==='administrador'||(Array.isArray(user.permisos)&&user.permisos.includes('facturacion')&&Array.isArray(user.permisosEdicion)&&user.permisosEdicion.includes('facturacion'))}
    function headerState(header){return {idCliente:String(header.idCliente??''),completo:Boolean(Number(header.Completo??header.Pagada??0)),actualizaStock:Boolean(Number(header.stockActualizado)),enInformeVentas:Boolean(Number(header.EnInfVtas))}}
    function receiptHeaderChanges(){if(!canEditHeader())return {};const current=headerState(detailData.comprobante),original=detailData.headerOriginal||current,changes={};for(const key of Object.keys(current))if(current[key]!==original[key])changes[key]=current[key];if('idCliente' in changes){if(!/^[1-9]\d*$/.test(changes.idCliente))throw Error('Ingresá un ID de cliente válido.');changes.idCliente=Number(changes.idCliente)}return changes}
    function markHeaderDirty(){detailData.valuesDirty=true;refreshAnnulButton();for(const key of ['preview','reprint','recall'])detail.querySelector('[data-'+key+']').disabled=true;detail.querySelector('[data-action-status]').textContent='Cambios sin guardar.'}
    async function resolveReceiptCustomer(){
      if(!canEditHeader())return false;const data=detailData,id=String(data.comprobante.idCliente??'');
      if(!/^[1-9]\d*$/.test(id)){detail.querySelector('[data-action-status]').textContent='Ingresá un ID de cliente válido.';return false}
      if(data.headerResolvedCustomer===id)return true;
      if(data.headerCustomerPromise&&data.headerCustomerPending===id)return data.headerCustomerPromise;
      data.headerCustomerPending=id;data.headerCustomerController?.abort();const controller=data.headerCustomerController=new AbortController();
      data.headerCustomerPromise=(async()=>{try{detail.querySelector('[data-action-status]').textContent='Consultando cliente…';const result=await sql('clientes?id='+encodeURIComponent(id),controller);if(detailData!==data||String(data.comprobante.idCliente)!==id)return false;const client=result.cliente;if(!client||Number(client.suspendido))throw Error('El cliente no existe o está suspendido.');if(Number(result.unificadoEn)>0)throw Error('La cuenta fue unificada. Usá el cliente principal '+result.unificadoEn+'.');data.headerResolvedCustomer=id;
        if(!/^\d{14}$/.test(String(data.comprobante.cae||'')))Object.assign(data.comprobante,{cliente:client.nombre,documento:client.documento,idTipoDoc:client.idTipoDoc,idTipoIva:client.idTipoIva,direccion:client.direccion,telefono:client.telefono,email:client.email});
        redrawValues();detail.querySelector('[data-action-status]').textContent='Cliente '+id+': '+client.nombre+'. Cambios sin guardar.';return true;
      }catch(error){if(detailData===data&&String(data.comprobante.idCliente)===id)detail.querySelector('[data-action-status]').textContent=controller.signal.aborted?'La consulta del cliente se interrumpió. Volvé a intentar.':error.message;return false}finally{if(data.headerCustomerPending===id){data.headerCustomerPromise=null;data.headerCustomerPending=''}}})();return data.headerCustomerPromise;
    }
    detail.addEventListener('input',event=>{const input=event.target.closest('[data-header-key="idCliente"]');if(!input||!canEditHeader()||actionBusy)return;detailData.comprobante.idCliente=input.value.trim();markHeaderDirty()});
    detail.addEventListener('change',event=>{const input=event.target.closest('[data-header-key]');if(!input||!canEditHeader()||actionBusy)return;const key=input.dataset.headerKey;if(key==='idCliente'){detailData.comprobante.idCliente=input.value.trim();markHeaderDirty();resolveReceiptCustomer();return}const field={completo:'Completo',actualizaStock:'stockActualizado',enInformeVentas:'EnInfVtas'}[key];if(field){detailData.comprobante[field]=input.checked;markHeaderDirty()}});
    detail.addEventListener('keydown',async event=>{const input=event.target.closest('[data-header-key="idCliente"]');if(!input||!canEditHeader()||actionBusy)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();detailData.comprobante.idCliente=input.value.trim();if(await resolveReceiptCustomer())detail.querySelector('[data-header-key="completo"]')?.focus()}});

    function valueRules(){if(detailData?.paymentRules)return detailData.paymentRules;try{return window.CorralonMediosPago?.normalize(JSON.parse(localStorage.getItem('corralon_facturacion_medios_pago_v1')||'null'),historyConfig)}catch{return window.CorralonMediosPago?.normalize(null,historyConfig)}}
    function valueTypes(){const rules=valueRules();return(historyConfig?.tiposPago||[]).filter(p=>[1,3,5,6].includes(Number(p.clase))&&Number(p.id)!==14&&(!window.CorralonMediosPago||window.CorralonMediosPago.allowsVoucher(rules,p.id,detailData.comprobante.idComprobante)))}
    function valueCards(value){const rules=valueRules();return(historyConfig?.tarjetas||[]).filter(c=>!window.CorralonMediosPago||window.CorralonMediosPago.allowsCard(rules,value.idTipoPago,c.id))}
    function valueSelect(value,index,key,choices){return `<select data-value-index="${index}" data-value-key="${key}" aria-label="${key==='idTipoPago'?'Tipo de valor':key==='idTarjeta'?'Tarjeta o cuenta':'Cuotas'}" style="width:100%;font:inherit;border:1px solid #bbb;background:white">${choices.map(c=>`<option value="${Number(c.id)}" ${Number(c.id)===Number(value[key])?'selected':''} ${c.disabled?'disabled':''}>${escape(c.nombre)}</option>`).join('')}</select>`}
    function valueCells(value,index){
      if(!canEditValues())return [escape(value.tipo||value.idTipoPago),escape(value.tarjeta||'Ninguna'),escape(value.cuotas??0)];
      const types=valueTypes();if(!types.some(p=>Number(p.id)===Number(value.idTipoPago)))types.push({id:value.idTipoPago,nombre:value.tipo,disabled:true});
      const cls=Number((historyConfig?.tiposPago||[]).find(p=>Number(p.id)===Number(value.idTipoPago))?.clase||value.clase),cards=[{id:0,nombre:'Ninguna'},...valueCards(value)],plans=[{id:0,nombre:'0'},...(historyConfig?.tarjetasCuotas||[]).filter(p=>Number(p.idTarjeta)===Number(value.idTarjeta)).map(p=>({id:p.cuotas,nombre:p.cuotas}))];
      if(value.idTarjeta&&!cards.some(c=>Number(c.id)===Number(value.idTarjeta)))cards.push({id:value.idTarjeta,nombre:value.tarjeta,disabled:true});
      return [valueSelect(value,index,'idTipoPago',types),[3,5].includes(cls)?valueSelect(value,index,'idTarjeta',cards):escape(value.tarjeta||'Ninguna'),cls===5?valueSelect(value,index,'cuotas',plans):escape(value.cuotas??0)];
    }
    function fitReceiptDetail(){
      if(sectionActive&&detail.parentElement===sectionHost){detail.classList.remove('receipt-fit-section','receipt-scaled-desktop');return;}
      detail.classList.remove('receipt-fit-section');
      const card=detail.querySelector('.invoice-history-card');
      const desktop=window.innerWidth>700;detail.classList.toggle('receipt-scaled-desktop',desktop);
      if(!desktop){card.style.removeProperty('--receipt-scale');return;}
      const width=detail.clientWidth||window.innerWidth,height=detail.clientHeight||window.innerHeight;
      card.style.setProperty('--receipt-scale',String(Math.max(.01,Math.min((width-28)/1450,(height-28)/850))));
    }
    window.addEventListener('resize',()=>{if(!detail.hidden)fitReceiptDetail();});
    function decorateReceiptDetail(body){
      const layout=body.querySelector('.receipt-layout');if(!layout)return;fitReceiptDetail();
      const footerButtons=detail.querySelector('.invoice-history-footer>div');
      footerButtons.querySelector('[data-save-values]')?.remove();
      const save=layout.querySelector('[data-save-values]');if(save)footerButtons.prepend(save);
      if(sectionActive)return;
      const heading=(label)=>{const h=document.createElement('h3');h.className='receipt-section-title';h.textContent=label;return h;};
      const card=(label)=>{const section=document.createElement('section');section.className='receipt-section';section.append(heading(label));return section;};
      const main=card('Datos principales');main.classList.add('receipt-main-data');
      const mainRows=[...layout.children].filter(el=>el.classList.contains('receipt-row')&&!el.classList.contains('receipt-totals'));
      if(mainRows.length){layout.insertBefore(main,mainRows[0]);main.append(...mainRows);}
      const articles=layout.querySelector('.receipt-articles');articles.classList.add('receipt-section');
      const articleTitle=heading('Detalle de artículos'),search=document.createElement('input');search.type='search';search.dataset.receiptArticleSearch='';search.placeholder='Buscar artículo…';search.setAttribute('aria-label','Buscar en los artículos del comprobante');articleTitle.append(search);articles.prepend(articleTitle);
      const area=layout.querySelector('.receipt-values-area'),values=area?.querySelector('.receipt-grid'),tax=area?.querySelector('.receipt-tax-summary');
      if(values){values.classList.add('receipt-section','receipt-values-card');values.prepend(heading('Valores recibidos'));}
      if(tax){tax.classList.add('receipt-section');tax.prepend(heading('Resumen de totales'));}
      const totals=card('Totales y otros datos');totals.classList.add('receipt-other-data');
      const totalsRows=[...layout.children].filter(el=>el.classList.contains('receipt-totals'));
      if(totalsRows.length){layout.insertBefore(totals,totalsRows[0]);totals.append(...totalsRows);}
    }
    detail.addEventListener('input',event=>{
      if(!event.target.matches('[data-receipt-article-search]'))return;
      const query=event.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
      const panel=event.target.closest('.receipt-articles');let visible=0;
      panel.querySelectorAll('tbody tr[data-warranty-article]').forEach(row=>{row.hidden=!row.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query);if(!row.hidden)visible++;});
      panel.querySelectorAll('tr.receipt-empty').forEach(row=>row.hidden=Boolean(query));
      panel.querySelector('.receipt-records').textContent=query?`${visible} de ${detailData?.articulos?.length||0} artículos`: `Registro: ${visible?'1':'0'} de ${visible}`;
    });
    function redrawValues(){const body=detail.querySelector('[data-detail-body]'),footer=detail.querySelector('.invoice-history-footer');if(footer&&body.contains(footer))detail.querySelector('.invoice-history-card').appendChild(footer);body.innerHTML=receiptLayout(detailData,rows[detailIndex]);decorateReceiptDetail(body);body.querySelector('.receipt-actions').appendChild(footer);footer.style.display='';refreshValueOutputs();}
    detail.addEventListener('input',event=>{
      const input=event.target.closest('input[data-value-key]');if(!input||!canEditValues()||actionBusy)return;
      const row=detailData.valores[Number(input.dataset.valueIndex)],key=input.dataset.valueKey;
      if(key!=='descripcion')row.autoDifference=false;
      row[key]=key==='descripcion'?input.value:valueNumber(input.value)/(key==='coef'?100:1);
      if(key==='total'&&Number(row.coef)>-1){const target=Math.round(Number(row.total)*100)/100,base=Math.round(target/(1+Number(row.coef||0))*100)/100;row.importe=base;row.impRec=Math.round((target-base)*100)/100;row.coef=base?row.impRec/base:0;row.total=target;}
      else if(key!=='descripcion')window.CorralonMediosPago.adjustValue(row,key,valueNumber);
      updateValueTotals();
      for(const field of input.closest('tr').querySelectorAll('input[data-value-key]')){if(field===input)continue;const k=field.dataset.valueKey;field.value=k==='descripcion'?row[k]:k==='coef'?number(row.coef*100)+' %':money(row[k]);}
      refreshValueOutputs();detail.querySelector('[data-action-status]').textContent='Cambios sin guardar.';
      if(key!=='descripcion'){
        const raw=input.value,start=input.selectionStart,end=input.selectionEnd;reconcileCashDifference();redrawValues();
        const replacement=detail.querySelector(`[data-value-index="${detailData.valores.indexOf(row)}"][data-value-key="${key}"]`);if(replacement){replacement.value=raw;replacement.focus();replacement.setSelectionRange(start,end);}
      }
    });
    detail.addEventListener('keydown',event=>{
      const input=event.target.closest('[data-value-key]');if(!input||!canEditValues()||actionBusy||event.defaultPrevented)return;
      if(event.key==='F2'&&input.select){event.preventDefault();input.select();return;}
      if(event.key==='Enter'){event.preventDefault();const controls=[...detail.querySelectorAll('[data-edit-values] [data-value-key]:not([disabled])')],index=controls.indexOf(input),row=Number(input.dataset.valueIndex),key=input.dataset.valueKey;input.dispatchEvent(new Event('change',{bubbles:true}));const target=detail.querySelector(`[data-value-index="${row}"][data-value-key="${key}"]`),next=[...detail.querySelectorAll('[data-edit-values] [data-value-key]:not([disabled])')];(next[next.indexOf(target)+1]||detail.querySelector('[data-add-value]'))?.focus();}
    });
    detail.addEventListener('change',event=>{
      const input=event.target.closest('[data-value-key]');if(!input||!canEditValues()||actionBusy)return;
      if(input.tagName==='INPUT'){const key=input.dataset.valueKey,row=detailData.valores[Number(input.dataset.valueIndex)];input.value=key==='descripcion'?row[key]:key==='coef'?number(row.coef*100)+' %':money(row[key]);return;}
      const value=detailData.valores[Number(input.dataset.valueIndex)],key=input.dataset.valueKey;value[key]=Number(input.value);
      value.autoDifference=false;
      const type=(historyConfig.tiposPago||[]).find(p=>Number(p.id)===Number(value.idTipoPago)),cls=Number(type?.clase||value.clase);
      if(key==='idTipoPago'){value.tipo=type.nombre;value.clase=cls;value.idTarjeta=0;value.tarjeta='Ninguna';value.cuotas=0;}
      if(key==='idTarjeta'){value.tarjeta=(historyConfig.tarjetas||[]).find(c=>Number(c.id)===value.idTarjeta)?.nombre||'Ninguna';value.cuotas=cls===5?Number((historyConfig.tarjetasCuotas||[]).find(p=>Number(p.idTarjeta)===value.idTarjeta)?.cuotas)||0:0;}
      // Cambiar la clasificacion del pago conserva el descuento/recargo y total emitidos.
      reconcileCashDifference();redrawValues();detail.querySelector('[data-action-status]').textContent='Cambios sin guardar.';
      const index=detailData.valores.indexOf(value),account=detail.querySelector('[data-value-index="'+index+'"][data-value-key="idTarjeta"]');
      if(key==='idTipoPago'&&[3,5].includes(cls)&&account)window.CorralonFunciones.focusField(account,{openDropdown:true});
      else if(key==='idTarjeta'&&account){const controls=[...detail.querySelectorAll('[data-edit-values] [data-value-key]:not([disabled])')],next=controls[controls.indexOf(account)+1];if(next)window.CorralonFunciones.focusField(next,{openDropdown:next.tagName==='SELECT'});}
    });
    detail.addEventListener('click',async event=>{
      if(canEditValues()&&!actionBusy&&event.target.closest('[data-restore-issued-adjustment]')){
        const state=receiptValuesBalance(),active=detailData.valores.filter(row=>Number(row.total)>0),totalCents=Math.round(state.total*100),baseCents=Math.round(state.articles*100);let allocated=0;
        if(state.cashDifference!==0||!active.length||baseCents<=0)return;
        const prepared=active.map((row,index)=>{const base=index===active.length-1?baseCents-allocated:Math.round(baseCents*Math.round(Number(row.total)*100)/totalCents);allocated+=base;const amount=Math.round(Number(row.total)*100),fee=amount-base;return {row,importe:base/100,impRec:fee/100,coef:base?fee/base:0};});
        if(prepared.some(value=>value.importe<=0||value.coef< -1||value.coef>5)){detail.querySelector('[data-action-status]').textContent='No se puede repartir este ajuste automáticamente. Revisá los importes de cada valor.';return;}
        detailData.valores=active;for(const value of prepared)Object.assign(value.row,{importe:value.importe,impRec:value.impRec,coef:value.coef,autoDifference:false});updateValueTotals();redrawValues();detail.querySelector('[data-action-status]').textContent='Ajuste emitido reasignado. Revisá los valores y pulsá Guardar valores.';return;
      }
      if(canEditValues()&&!actionBusy){if(event.target.closest('[data-add-value]')){detailData.valores.push(blankValue());updateValueTotals();redrawValues();detail.querySelector(`[data-value-row="${detailData.valores.length-1}"] input`)?.focus();return;}const remove=event.target.closest('[data-remove-value]');if(remove){detailData.valores.splice(Number(remove.dataset.removeValue),1);reconcileCashDifference();redrawValues();detail.querySelector('[data-action-status]').textContent='Cambios sin guardar.';return;}}
      if(!event.target.closest('[data-save-values]')||!canEditValues()||actionBusy)return;
      let headerEdits={};try{headerEdits=receiptHeaderChanges()}catch(error){detail.querySelector('[data-action-status]').textContent=error.message;return}
      if('idCliente' in headerEdits&&!await resolveReceiptCustomer())return;if(actionBusy)return;
      const pending=detailData.valores.filter(v=>Number(v.importe)!==0||Number(v.impRec)!==0||String(v.descripcion||'').trim()),difference=Math.round((pending.reduce((sum,v)=>sum+Number(v.total||0),0)-Math.abs(Number(detailData.comprobante.total)))*100)/100;
      if(!pending.length||pending.some(v=>Number(v.importe)<=0)){detail.querySelector('[data-action-status]').textContent='Cada valor cargado debe tener un importe mayor que cero.';return;}
      const balance=receiptValuesBalance(pending);
      if(balance.invalid){detail.querySelector('[data-action-status]').textContent=balance.cashDifference!==0?'Los valores deben coincidir con el total de la boleta. La diferencia debe ser cero.':'Los valores no conservan la base de artículos y el descuento/recargo emitido. Reasigná el ajuste antes de guardar.';return;}
      actionBusy=true;detail.querySelectorAll('button,select,input[data-value-key],input[data-header-key]').forEach(c=>c.disabled=true);const status=detail.querySelector('[data-action-status]');status.textContent=Object.keys(headerEdits).length?'Guardando cambios…':'Guardando valores…';
      try{const payload={...(Object.keys(headerEdits).length?{cabecera:headerEdits}:{}),usuarioId:valuesUser().id,idRecibo:rows[detailIndex].idRecibo,version:detailData.versionValores,valores:pending.map(v=>({orden:v.orden??null,idTipoPago:v.idTipoPago,idTarjeta:v.idTarjeta||0,cuotas:v.cuotas||0,importe:v.importe,impRec:v.impRec||0,coef:v.coef||0,descripcion:v.descripcion||''}))};
        if(detailOptions.saveValues)await detailOptions.saveValues(payload);
        else {const response=await fetch('/api/facturacion/comprobante-valores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudieron guardar los valores.');}
        actionBusy=false;await openDetail(detailIndex,{refresh:true});detail.querySelector('[data-action-status]').textContent=Object.keys(headerEdits).length?'Datos y valores actualizados.':'Valores actualizados.';if(Object.keys(headerEdits).length)Promise.resolve(window.CorralonInvoiceHistoryActions?.refreshAfterAnnul?.(rows[detailIndex]?.idRecibo)).catch(console.warn);}
      catch(error){status.textContent=error.message;detail.querySelectorAll('button,select,input[data-value-key],input[data-header-key]').forEach(c=>c.disabled=false);}
      finally{actionBusy=false;detail.querySelector('[data-detail-close]').disabled=false;detail.querySelector('[data-detail-prev]').disabled=detailIndex===0;detail.querySelector('[data-detail-next]').disabled=detailIndex===rows.length-1;detail.querySelector('[data-preview]').disabled=!historyActions().preview||detailData?.valuesDirty;detail.querySelector('[data-reprint]').disabled=!historyActions().reprint||detailData?.valuesDirty;detail.querySelector('[data-recall]').disabled=!historyActions().recall||detailData?.valuesDirty;}
    });
    const warrantyMenu=document.createElement('div');warrantyMenu.hidden=true;
    warrantyMenu.style.cssText='position:fixed;z-index:98;padding:4px;background:var(--corralon-white,#fff);border:1px solid var(--corralon-line-strong,#bbb);border-radius:7px;box-shadow:0 5px 18px #0003';
    warrantyMenu.innerHTML='<button type="button" style="padding:9px 14px;border:0;background:var(--corralon-white,#fff);color:var(--corralon-text,#222);font:700 14px Barlow,Arial;cursor:pointer">Generar garantía</button>';
    document.body.appendChild(warrantyMenu);
    let warrantyArticleIndex=-1,warrantyBridge=null;
    function loadWarrantyBridge(){
      if(warrantyBridge)return warrantyBridge;
      const frame=document.createElement('iframe');frame.hidden=true;frame.title='Generador de garantías';
      warrantyBridge=new Promise((resolve,reject)=>{
        let observer;
        const timer=setTimeout(()=>{observer?.disconnect();reject(new Error('No se pudo cargar Garantías. Revisá la conexión y los permisos de usuario.'));},20000);
        const ready=()=>{
          try{
            const generator=frame.contentWindow.CorralonGarantiaDesdeFacturacion;
            if(typeof generator!=='function'||frame.contentDocument.documentElement.style.visibility==='hidden')return;
            clearTimeout(timer);observer?.disconnect();resolve(generator);
          }catch(error){clearTimeout(timer);reject(error);}
        };
        frame.onload=()=>{
          try{
            observer=new MutationObserver(ready);
            observer.observe(frame.contentDocument.documentElement,{attributes:true,attributeFilter:['style']});
            frame.contentWindow.addEventListener('menu-user-validated',ready);ready();
          }
          catch(error){clearTimeout(timer);reject(error);}
        };
        frame.onerror=()=>{clearTimeout(timer);reject(new Error('No se pudo cargar el generador de garantías.'));};
        frame.src='garant%C3%ADas.html?desdeFacturacion=1';document.body.appendChild(frame);
      }).catch(error=>{frame.remove();warrantyBridge=null;throw error;});
      return warrantyBridge;
    }
    detail.addEventListener('contextmenu',event=>{
      const line=event.target.closest('[data-warranty-article]');
      if(!line||!detailData||actionBusy)return;
      event.preventDefault();warrantyArticleIndex=Number(line.dataset.warrantyArticle);
      const allowed=window.CorralonFunciones?.menuUserHasAccess('garantias');
      const confirmed=Number(detailData.comprobante.confirmado)&&!Number(detailData.comprobante.anulada);
      const action=warrantyMenu.querySelector('button');action.disabled=!allowed||!confirmed;
      action.title=!allowed?'Tu usuario no tiene permiso para Garantías':!confirmed?'La boleta debe estar confirmada y sin anular':'';
      warrantyMenu.hidden=false;
      warrantyMenu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-warrantyMenu.offsetWidth-8))+'px';
      warrantyMenu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-warrantyMenu.offsetHeight-8))+'px';
      action.focus();
    });
    warrantyMenu.querySelector('button').addEventListener('click',async()=>{
      const article=detailData?.articulos?.[warrantyArticleIndex],header=detailData?.comprobante,invoice=rows[detailIndex];
      warrantyMenu.hidden=true;
      if(!article||!header||!invoice||actionBusy||!window.CorralonFunciones?.menuUserHasAccess('garantias'))return;
      const payload={codigo:String(article.idart||''),descripcion:article.descripcion,cliente:String(header.cliente||invoice.cliente||'').toUpperCase(),boleta:invoice.numero,fechaIso:String(header.fechaComprobante||'').slice(0,10)};
      const pdfWindow=window.open('about:blank','_blank');
      if(pdfWindow){pdfWindow.document.title='Garantía';pdfWindow.document.body.textContent='Generando garantía…';pdfWindow.document.body.style.cssText='font:18px Arial;padding:24px';pdfWindow.opener=null;}
      let pdfShown=false,generationTimer;
      const showPdf=blob=>{
        if(pdfShown)return;
        const pdfUrl=URL.createObjectURL(blob);
        if(pdfWindow&&!pdfWindow.closed)pdfWindow.location.replace(pdfUrl);
        else{const link=document.createElement('a');link.href=pdfUrl;link.download=`Garantia-${payload.boleta}-${payload.codigo}.pdf`;document.body.appendChild(link);link.click();link.remove();}
        pdfShown=true;setTimeout(()=>URL.revokeObjectURL(pdfUrl),300000);
      };
      actionBusy=true;const notice=detail.querySelector('[data-action-status]');notice.textContent='Generando garantía y notificación…';
      detail.querySelectorAll('[data-preview],[data-reprint],[data-recall],[data-detail-prev],[data-detail-next]').forEach(control=>control.disabled=true);
      try{
        const generator=await loadWarrantyBridge();
        const result=await Promise.race([
          generator(payload,showPdf),
          new Promise((_,reject)=>{generationTimer=setTimeout(()=>reject(new Error(pdfShown?'El PDF está generado, pero el historial y la notificación siguen pendientes de respuesta.':'La generación del PDF no respondió. Reintentá desde Facturación.')),35000);})
        ]);
        if(!result?.blob)throw new Error('Garantías no devolvió el PDF.');
        showPdf(result.blob);
        notice.textContent=result.historial.existente?'PDF generado. La garantía ya estaba registrada; se conservó su notificación.':'Garantía generada y registrada en Notificaciones.';
      }catch(error){if(!pdfShown&&pdfWindow&&!pdfWindow.closed){pdfWindow.document.body.textContent=error.message;}notice.textContent=error.message;}
      finally{
        clearTimeout(generationTimer);
        actionBusy=false;
        if(!detail.hidden){const unavailable=!Number(header.confirmado)||Boolean(Number(header.anulada));detail.querySelector('[data-preview]').disabled=unavailable||!historyActions().preview;detail.querySelector('[data-reprint]').disabled=unavailable;detail.querySelector('[data-recall]').disabled=!Number((detailData?.comprobante)?.confirmado);detail.querySelector('[data-detail-prev]').disabled=detailIndex===0;detail.querySelector('[data-detail-next]').disabled=detailIndex===rows.length-1;}
      }
    });
    document.addEventListener('pointerdown',event=>{if(!warrantyMenu.contains(event.target))warrantyMenu.hidden=true;});
    function dateText(date){return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()}`}
    function dateInput(field){
      const parsed=window.CorralonFunciones?.parseFechaFlexible(field.value);if(!parsed){field.setCustomValidity('Ingresá una fecha válida.');field.reportValidity();return null}
      field.setCustomValidity('');field.value=parsed.text;const d=parsed.date;return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    async function sql(path,controller){
      const timeout=setTimeout(()=>controller.abort(),15000);
      try{
        const response=await fetch('/api/facturacion/'+path,{cache:'no-store',signal:controller.signal});
        const result=await response.json();
        if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'No se pudo consultar SQL.'),{code:result.code});
        return result;
      }finally{clearTimeout(timeout)}
    }
    function forgetInvoiceDetail(id){
      invoiceDetails.get(id)?.controller.abort();
      invoiceDetails.delete(id);
    }
    function clearInvoiceDetails(){
      for(const id of invoiceDetails.keys())forgetInvoiceDetail(id);
    }
    function readInvoiceDetail(id){
      const cached=invoiceDetails.get(id);
      if(cached&&(!cached.data||cached.expires>Date.now())){
        invoiceDetails.delete(id);
        invoiceDetails.set(id,cached);
        return cached;
      }
      const controller=new AbortController();
      const entry={controller,data:null,expires:0,pending:null};
      entry.pending=sql('comprobante?id='+encodeURIComponent(id),controller).then(data=>{
        entry.data=data;
        entry.expires=Date.now()+invoiceDetailTtl;
        return data;
      },error=>{
        if(invoiceDetails.get(id)===entry)invoiceDetails.delete(id);
        throw error;
      });
      invoiceDetails.delete(id);
      invoiceDetails.set(id,entry);
      if(invoiceDetails.size>invoiceDetailLimit)forgetInvoiceDetail(invoiceDetails.keys().next().value);
      return entry;
    }
    function message(text,error=false){status.textContent=text;status.classList.toggle('error',error)}
    function pager(){
      const loadingInCenter=sectionActive&&listLoading&&totalRecords===null;
      loading.hidden=!loadingInCenter;
      get('[data-position]').textContent=`${rows.length} boletas cargadas de ${totalRecords===null?'…':totalRecords}`;
      get('[data-more-status]').textContent=loadingInCenter?'':listLoading?'Cargando boletas…':snapshotExpired?'La consulta venció.':moreError?'No se pudieron cargar más boletas.':hasMore?'Deslizá hacia abajo para cargar más.':rows.length?'No hay más boletas.':'';
      get('[data-retry-more]').hidden=!moreError;
      get('[data-retry-more]').textContent=snapshotExpired?'Volver a consultar':'Reintentar';
    }
    function loadMore(){if(!overlay.hidden&&detail.hidden&&!listLoading&&!moreError&&hasMore)load(page+1)}
    get('.invoice-history-scroll').addEventListener('scroll',event=>{
      const panel=event.currentTarget;
      if(panel.scrollHeight-panel.scrollTop-panel.clientHeight<=80)loadMore();
    },{passive:true});
    get('[data-retry-more]').addEventListener('click',()=>{
      if(snapshotExpired){load();return;}
      moreError=false;loadMore();
    });
    function normalizeReceiptSearch(value){
      const text=String(value??'').trim();
      const parts=text.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,8})$/);
      return parts?parts[1].padStart(4,'0')+'-'+parts[2].padStart(8,'0'):text;
    }
    function completeReceiptSearch(){const field=get('[data-search]');field.value=normalizeReceiptSearch(field.value)}
    get('[data-search]').addEventListener('blur',completeReceiptSearch);
    get('[data-search]').addEventListener('keydown',event=>{if(event.key==='Enter')completeReceiptSearch()});
    async function load(targetPage=0){
      const append=targetPage>0;
      if(append&&(listLoading||!hasMore||!listQuery))return;
      overlay.classList.toggle('classic-history-list',sectionActive);
      let params;
      if(append){params=new URLSearchParams(listSnapshot?{snapshot:listSnapshot}:listQuery);params.set('pagina',String(targetPage))}
      else{
        clearTimeout(searchTimer);
        const search=normalizeReceiptSearch(get('[data-search]').value);
        const specificReceipt=/^\d{4}-\d{8}$/.test(search);
        // Una boleta completa se busca en todas las fechas y sucursales sin alterar los filtros visibles.
        const from=specificReceipt?'1753-01-01':dateInput(get('[data-from]'));
        const to=specificReceipt?'9998-12-31':dateInput(get('[data-to]'));
        if(!from||!to)return;
        if(from>to){message('La fecha Desde debe ser anterior o igual a Hasta.',true);return}
        if(specificReceipt)for(const selector of ['[data-from]','[data-to]'])get(selector).setCustomValidity('');
        params=new URLSearchParams({desde:from,hasta:to,sucursal:specificReceipt?'0':get('[data-branch]').value,puntoVenta:specificReceipt?'0':get('[data-point]').value,buscar:search,articulo:specificReceipt?'':get('[data-article]').value.trim(),pagina:'0',orden:sortField,direccion:sortDirection});
        params.set('paginacion','ids');
        if(sectionActive&&params.get('articulo'))params.set('articuloModo','descripcion');
        listQuery=params.toString();listSnapshot='';snapshotExpired=false;rows=[];page=0;hasMore=false;totalRecords=null;get('[data-rows]').innerHTML='';get('.invoice-history-scroll').scrollTop=0;
      }
      listController?.abort();const controller=listController=new AbortController(),request=++sequence;
      listLoading=true;moreError=false;pager();if(!append)message(sectionActive?'':'Consultando boletas…');
      try{
        const result=await sql('consultar-comprobantes?'+params,controller);if(request!==sequence||overlay.hidden)return;
        if(!append)listSnapshot=result.snapshot||'';
        page=result.pagina;hasMore=Boolean(result.hayMas);totalRecords=Number(result.totalComprobantes)||0;
        const seen=new Set(rows.map(row=>Number(row.idRecibo))),added=result.comprobantes.filter(row=>!seen.has(Number(row.idRecibo))),offset=rows.length;
        rows.push(...added);
        get('[data-rows]').insertAdjacentHTML('beforeend',added.map((r,index)=>{const i=offset+index;return `<tr data-invoice="${i}" tabindex="0" aria-label="Abrir boleta ${escape(r.numero)}">${sectionActive?classicHistoryCells(r,i):`<td>${escape(r.numero)}</td><td>${escape(r.tipo)}</td><td>${escape(String(r.cliente||'').toUpperCase())}</td><td>${escape(r.sucursal||'Sin sucursal')}</td><td>${escape(r.fecha)}</td><td class="money">${escape(money(r.total))}</td><td class="${Number(r.anulada)?'cancelled':''}">${Number(r.anulada)?'Anulada':'Confirmada'}</td><td><button data-invoice="${i}" type="button">Abrir</button></td>`}</tr>`}).join(''));
        if(sectionActive)for(const check of get('[data-rows]').querySelectorAll('[data-unknown-flag]'))check.indeterminate=true;
      message(rows.length?(sectionActive?'':'Boletas consultadas en SQL.'): 'No hay boletas para esos filtros.');
      }catch(error){if(request===sequence&&!overlay.hidden){moreError=append;snapshotExpired=append&&error.code==='invoice_history_expired';message(controller.signal.aborted?'La consulta no respondió a tiempo. Volvé a consultar.':error.message,true)}}
      finally{if(request===sequence){listLoading=false;pager()}}
    }
    function receiptLayout(result,row){
      const h=result.comprobante,items=result.articulos||[],values=result.valores||[];
      const field=(label,value,width=90,style='')=>`<label class="receipt-field">${escape(label)}<span style="width:${width}px" class="${style}" title="${escape(value??'—')}">${escape(value??'—')}</span></label>`;
      const check=(label,value,key='')=>`<label class="receipt-field">${escape(label)}${key?`<input type="checkbox" data-header-key="${key}" aria-label="${escape(label)}" ${canEditHeader()?'':'disabled'} ${Number(value)?'checked':''}>`:value==null?'—':`<input type="checkbox" disabled ${Number(value)?'checked':''}>`}</label>`;
      const customerId=canEditHeader()?`<label class="receipt-field">Cliente:<input data-header-key="idCliente" aria-label="ID del cliente" inputmode="numeric" maxlength="10" value="${escape(h.idCliente)}" style="width:55px;height:24px;padding:2px 5px;border:1px solid #b9cde5;border-radius:4px;background:#fff;font:inherit"></label>`:field('Cliente:',h.idCliente,55);
      const dateTime=value=>{
        if(!value)return '—';
        const text=String(value),dotNet=text.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
        const parsed=new Date(dotNet?Number(dotNet[1]):text);
        if(Number.isNaN(parsed.getTime()))return '—';
        return parsed.toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
      };
      const date=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
      const point=(historyConfig?.puntosVenta||[]).find(p=>Number(p.id)===Number(h.idPuntoVenta));
      const seller=(historyConfig?.vendedores||[]).find(v=>Number(v.id)===Number(h.vendedor));
      const type=(historyConfig?.comprobantes||[]).find(t=>Number(t.id)===Number(h.idComprobante));
      const taxName=({1:'Resp. inscripto',2:'Resp. no inscripto',3:'No responsable',4:'Exento',5:'Consumidor final',6:'Monotributista'})[Number(h.idTipoIva)]||'—';
      const taxReady=items.every(a=>a.iva!=null),net={21:0,10.5:0},vat={21:0,10.5:0};let allNet=0,allVat=0,untaxed=0;
      items.forEach(a=>{const rate=Number(a.iva)||0,amount=Number(a.importe)||0,base=amount/(1+rate/100),tax=amount-base;allNet+=base;allVat+=tax;if(!rate)untaxed+=amount;if(rate in net){net[rate]+=base;vat[rate]+=tax}});
      const taxMoney=value=>taxReady?money(value):'—';
      const totalValues=values.reduce((sum,v)=>sum+Number(v.total||0),0),adjustment=values.reduce((sum,v)=>sum+Number(v.impRec||0),0);
      const paidCash=()=>money(values.filter(v=>/^efectivo$/i.test(v.tipo||'')).reduce((sum,v)=>sum+Number(v.total||0),0));
      const blank=(count,cols)=>Array.from({length:Math.max(0,count)},()=>`<tr class="receipt-empty">${'<td></td>'.repeat(cols)}</tr>`).join('');
      return `<div class="receipt-layout">
        <div class="classic-receipt-heading"><output>${escape(type?.nombre||row.tipo||h.tipo||'Comprobante')}</output>${field('Suc.:',(historyConfig?.sucursales||[]).find(s=>Number(s.id)===Number(h.sucursal))?.nombre||row.sucursal,186)}<button type="button" data-classic-receipt-search>Buscar...</button><button type="button" data-classic-receipt-list>Listado</button>
          <nav class="classic-receipt-navigation" aria-label="Boletas de la consulta">
            <button type="button" data-classic-receipt-step="-1" aria-label="Boleta anterior" ${detailIndex<=0?'disabled':''}>&lsaquo;</button>
            <span aria-live="polite">${detailIndex+1}/${rows.length}</span>
            <button type="button" data-classic-receipt-step="1" aria-label="Boleta siguiente" ${detailIndex>=rows.length-1?'disabled':''}>&rsaquo;</button>
          </nav>
        </div>
        <div class="receipt-row">${field('P. Vta.:',point?.nombre||h.idPuntoVenta,130)}${field('P.V.:',h.idPuntoVenta,32)}${field('Tipo Comp.:',type?.codigo||row.tipo,65)}${field('Nº:',h.numero,115,'receipt-number')}${field('Fecha:',date(h.fechaComprobante),86)}${field('Vend.:',seller?.nombre||h.vendedor,105)}${field('IDOper:',h.operador,40)}${field('IDCaja:',h.IDCaja,55)}${check('Completo:',h.Completo??h.Pagada??0,'completo')}</div>
        <div class="receipt-row">${customerId}${field('',String(h.cliente||'').toUpperCase(),245,'receipt-highlight')}${field('Tel.:',h.telefono||'',95)}${field('IVA:',taxName,120)}${field('Email:',h.email||h.Email||'',160)}${check('Anulada:',h.anulada)}${check('Actualiza Stock:',h.stockActualizado,'actualizaStock')}${check('En Inf. Vtas.:',h.EnInfVtas??0,'enInformeVentas')}</div>
        <div class="receipt-row">${field('Tipo Doc.:',Number(h.idTipoDoc)===80?'CUIT':Number(h.idTipoDoc)===96?'DNI':h.idTipoDoc,50)}${field('Nº:',h.documento||'',120)}${field('Moneda:',Number(h.IDMoneda)===1?'Pesos':h.IDMoneda,75)}${field('Cotización:',h.ImpCotiz==null?'—':money(h.ImpCotiz),70)}${field('Nº Fac. N.C.:',h.facturaAsociada||'',105)}${field('Nº Ord. Cpra.:',h.NroOrdCpra||'',90)}${field('Nº Rem./Fac.:',h.IDRemito||'',90)}${field('1er. Vto.:',date(h.vencimiento),86)}</div>
        <div class="receipt-grid receipt-articles"><div class="receipt-articles-scroll"><table class="invoice-history-table"><colgroup><col style="width:38%"><col style="width:7%"><col style="width:7%"><col style="width:10%"><col style="width:10%"><col style="width:7%"><col style="width:7%"><col style="width:14%"></colgroup><thead><tr><th>Descripción</th><th>IDArt</th><th class="money">Cantidad</th><th class="money">PrecioUni</th><th class="money">ImpIVA1</th><th class="money">% IVA</th><th class="money">% Dto.</th><th class="money">Importe</th></tr></thead><tbody>${items.map((a,i)=>`<tr data-warranty-article="${i}"><td title="${escape(a.descripcion)}">${escape(a.descripcion)}</td><td>${escape(a.idart)}</td><td class="money">${number(a.cantidad)}</td><td class="money">${money(a.precio)}</td><td class="money">${a.iva==null?'—':money(Number(a.importe)-Number(a.importe)/(1+Number(a.iva)/100))}</td><td class="money">${a.iva==null?'—':number(a.iva)+'%'}</td><td class="money">${a.descuento==null?'—':number(a.descuento)+'%'}</td><td class="money">${money(a.importe)}</td></tr>`).join('')}${blank(7-items.length,8)}</tbody></table></div><div class="receipt-records">Registro: ${items.length?'1':'0'} de ${items.length}</div></div>
        <div class="receipt-values-area">${canEditValues()?editableValuesTable(values):`<div class="receipt-grid"><div class="receipt-values-scroll"><table class="invoice-history-table"><colgroup><col style="width:15%"><col style="width:15%"><col style="width:14%"><col style="width:7%"><col style="width:10%"><col style="width:12%"><col style="width:15%"><col style="width:12%"></colgroup><thead><tr><th>Tipo de Valor</th><th class="money">Importe</th><th>Tarjeta</th><th>Cuotas</th><th class="money">% D/R</th><th class="money">$ Rec/Dto</th><th class="money">ImpEnt</th><th>Fecha Vto.</th></tr></thead><tbody>${values.map((v,i)=>`<tr><td>${valueCells(v,i)[0]}</td><td class="money">${money(v.importe)}</td><td title="${escape(v.descripcion||'')}">${valueCells(v,i)[1]}</td><td>${valueCells(v,i)[2]}</td><td class="money">${number(Number(v.coef||0)*100)}%</td><td class="money">${money(v.impRec)}</td><td class="money">${money(v.total)}</td><td>${date(v.fechaVto||h.vencimiento)}</td></tr>`).join('')}${blank(2-values.length,8)}</tbody></table></div><div class="receipt-records">Registro: ${values.length?'1':'0'} de ${values.length}</div></div>`}<div class="receipt-tax-summary">${field('Neto 21%:',h.neto21==null?taxMoney(net[21]):money(h.neto21),115)}${field('IVA 21%:',h.iva21==null?taxMoney(vat[21]):money(h.iva21),115)}${field('Neto 10,5%:',h.neto105==null?taxMoney(net[10.5]):money(h.neto105),115)}${field('IVA 10,5%:',h.iva105==null?taxMoney(vat[10.5]):money(h.iva105),115)}</div></div>
        <div class="receipt-row receipt-totals">${field('Dto./Rec.:',money(adjustment),90)}${field('Total Valores:',money(totalValues),105,'receipt-total')}${field('CAE:',h.cae||'',105)}${field('Fecha y Hora:',dateTime(h.fechaHora),160)}${field('Tickets:',h.Tikets??h.Tickets,40)}${field('ID Rem./Fac.:',h.IDRemito,80)}</div>
        <div class="receipt-row receipt-totals">${field('S.T. s/Dto:',h.subtotalSinDto==null?taxMoney(allNet):money(h.subtotalSinDto),100)}${field('Gravado:',h.gravado==null?taxMoney(allNet-untaxed):money(h.gravado),100)}${field('$ IVA:',h.importeIva==null?taxMoney(allVat):money(h.importeIva),95)}${field('Imp. Int.:',h.ImpInt==null?'—':money(h.ImpInt),70)}${field('No Grav.:',taxMoney(untaxed),80)}${field('Total:',money(h.total),110,'receipt-total')}${field('Total ME:',money(h.totalAbsoluto),110,'receipt-total')}</div>
        <div class="receipt-row receipt-totals">${field('Formato impresión:',h.FormatoImp||'Ticket',150)}${field('Nota:',h.nota||'',300)}${field('Efectivo:',h.efectivo==null?paidCash():money(h.efectivo),80)}${field('Tarjeta:',money(h.tarjeta??values.filter(v=>Number(v.clase)===5).reduce((sum,v)=>sum+Number(v.total||0),0)),80)}${field('Cta. Cte.:',money(h.cuentaCorriente??values.filter(v=>/cta|cuenta corriente/i.test(v.tipo||'')).reduce((sum,v)=>sum+Number(v.total||0),0)),80)}${field('Cheque:',money(h.cheque??values.filter(v=>[2,3].includes(Number(v.clase))).reduce((sum,v)=>sum+Number(v.total||0),0)),80)}</div>
        <div class="receipt-actions">${canEditValues()?'<button type="button" data-save-values>Guardar cambios</button>':''}</div></div>`;
    }
    async function openDetail(index,{refresh=false}={}){
      const row=rows[index];if(!row||actionBusy)return;
      const request=++detailSequence;
      const body=detail.querySelector('[data-detail-body]'),footer=detail.querySelector('.invoice-history-footer');
      const hadDetail=!detail.hidden&&Boolean(body.querySelector('.receipt-layout'));
      if(refresh)forgetInvoiceDetail(row.idRecibo);
      annulButton.hidden=!isAdministrator();annulButton.disabled=true;
      detail.classList.toggle('classic-history-detail',sectionActive);
      warrantyMenu.hidden=true;detailData=null;detailIndex=index;
      for(const action of ['preview','reprint','recall'])detail.querySelector('[data-'+action+']').disabled=true;
      detail.querySelector('[data-action-status]').textContent='';detail.hidden=false;
      if(!hadDetail)detail.querySelector('[data-title]').textContent='Boleta '+row.numero+(row.tipo?' · '+row.tipo:'');
      if(sectionActive&&sectionHost.dataset.detailOpen!=='true'){
        if(detail.parentNode!==sectionHost)sectionHost.appendChild(detail);
        detail.removeAttribute('aria-modal');detail.setAttribute('role','region');
        detail.querySelector('[data-detail-close]').textContent='Volver a consultar';
        notifyDetailSection(true);
      }
      const entry=readInvoiceDetail(row.idRecibo);
      if(sectionActive&&!overlay.hidden)for(const neighbor of [rows[index+1],rows[index-1]]){
        if(neighbor)readInvoiceDetail(neighbor.idRecibo).pending.catch(()=>{});
      }
      if(!entry.data){
        body.inert=true;
        body.setAttribute('aria-busy','true');
        if(!hadDetail)body.textContent='Consultando detalle…';
      }
      try{
        const data=entry.data??await entry.pending;
        if(request!==detailSequence||detail.hidden)return;
        // Los controles editan una copia y el detalle precargado conserva los datos de SQL.
        const result=JSON.parse(JSON.stringify(data));
        if(canEditValues(result)&&window.CorralonMediosPago?.refreshSharedRules){
          try{result.paymentRules=await window.CorralonMediosPago.refreshSharedRules(historyConfig);}
          catch{result.valueRulesUnavailable=true;}
          if(request!==detailSequence||detail.hidden)return;
          if(result.valueRulesUnavailable)detail.querySelector('[data-action-status]').textContent='No se pudieron cargar las reglas de medios de pago. Volvé a abrir la boleta para editar.';
        }
        const h=result.comprobante;detailData=result;detailData.headerOriginal=headerState(h);detailData.headerResolvedCustomer=String(h.idCliente??'');receiptValuesBasis(result);const unavailable=!Number(h.confirmado)||Number(h.anulada)!==0;const adapters=historyActions();detail.querySelector('[data-preview]').disabled=unavailable||!adapters.preview;detail.querySelector('[data-reprint]').disabled=unavailable||!adapters.reprint;detail.querySelector('[data-recall]').disabled=!Number(h.confirmado)||!adapters.recall;
        const typeName=h.tipo||(historyConfig?.comprobantes||[]).find(t=>Number(t.id)===Number(h.idComprobante))?.nombre||row.tipo;
        detail.querySelector('[data-title]').textContent='Boleta '+h.numero+(typeName?' · '+typeName:'');
        detail.querySelector('[data-preview]').hidden=!adapters.preview;detail.querySelector('[data-reprint]').hidden=!adapters.reprint;detail.querySelector('[data-recall]').hidden=!adapters.recall;
        footer.style.display=adapters.preview||adapters.reprint||adapters.recall||canEditValues()||isAdministrator()?'':'none';
        if(body.contains(footer))detail.querySelector('.invoice-history-card').appendChild(footer);
        body.innerHTML=receiptLayout(result,row);decorateReceiptDetail(body);
        body.querySelector('.receipt-actions').appendChild(footer);refreshValueOutputs();
      }catch(error){
        if(request!==detailSequence||detail.hidden)return;
        if(body.contains(footer))detail.querySelector('.invoice-history-card').appendChild(footer);
        body.textContent=entry.controller.signal.aborted?'La consulta no respondió a tiempo. Volvé a abrir la boleta.':error.message;
        detail.querySelector('[data-title]').textContent='Boleta '+row.numero+(row.tipo?' · '+row.tipo:'');
      }finally{
        if(request===detailSequence&&!detail.hidden){
          body.inert=false;
          body.removeAttribute('aria-busy');
          detail.querySelector('[data-detail-position]').textContent=`${index+1} de ${rows.length}`;
          detail.querySelector('[data-detail-prev]').disabled=index===0;
          detail.querySelector('[data-detail-next]').disabled=index===rows.length-1;
          if(sectionActive)notifyDetailSection(true);
        }
      }
    }
    detail.addEventListener('click',event=>{
      const step=event.target.closest('[data-classic-receipt-step]');
      if(step){
        navigateDetail(Number(step.dataset.classicReceiptStep));
        return;
      }
      const control=event.target.closest('[data-classic-receipt-search],[data-classic-receipt-list]');
      if(!control||actionBusy||cancellationBusy||detailData?.valuesDirty)return;
      closeDetail();
      if(control.hasAttribute('data-classic-receipt-search'))get('[data-close]').click();
    });
    async function detailAction(action){
      const row=rows[detailIndex];if(!row||!detailData||actionBusy)return;const adapter=historyActions()[action],status=detail.querySelector('[data-action-status]');
      if(detailData?.valuesDirty){status.textContent='Guardá los valores antes de ver, reimprimir o llamar la boleta.';return;}
      if(!adapter){status.textContent='Facturación todavía está cargando. Reintentá en unos segundos.';return}
      actionBusy=true;detail.querySelector('[data-preview]').disabled=true;detail.querySelector('[data-reprint]').disabled=true;detail.querySelector('[data-recall]').disabled=true;status.textContent=action==='preview'?'Preparando vista previa…':action==='reprint'?'Preparando reimpresión…':'Cargando boleta en Facturación…';
      let closeAfterAction=false;
      try{const result=await adapter(Number(row.idRecibo));if(result?.cancelled){status.textContent='Carga cancelada.';}else if(action==='recall'||result?.preview)closeAfterAction=true;else status.textContent='Ticket enviado a la impresora.'}
      catch(error){status.textContent=error.message}
      finally{actionBusy=false;if(!detail.hidden){detail.querySelector('[data-preview]').disabled=!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||!historyActions().preview;detail.querySelector('[data-reprint]').disabled=!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||!historyActions().reprint;detail.querySelector('[data-recall]').disabled=!Number(detailData?.comprobante?.confirmado)||!historyActions().recall}if(closeAfterAction)close();}
    }
    detail.querySelector('[data-preview]').addEventListener('click',()=>detailAction('preview'));
    detail.querySelector('[data-reprint]').addEventListener('click',()=>detailAction('reprint'));
    detail.querySelector('[data-recall]').addEventListener('click',()=>detailAction('recall'));
    annulButton.addEventListener('click',async()=>{
      if(actionBusy||!isAdministrator()||annulButton.disabled||!detailData)return;
      const row=rows[detailIndex],index=detailIndex,version=detailData.versionAnulacion;
      if(!confirm(`¿Estás seguro de anular el comprobante ${row.numero}? Se revertirá el stock y se pondrán en cero sus totales, igual que en Access.`))return;
      if(!confirm(`Confirmación final: ANULAR ${row.numero}\nCliente: ${detailData.comprobante.cliente||row.cliente||'—'}\nTotal: ${money(detailData.comprobante.total)}\n\n¿Confirmás la anulación?`))return;
      actionBusy=true;cancellationBusy=true;refreshAnnulButton();
      const states=[...detail.querySelectorAll('button,input,select')].map(control=>[control,control.disabled]);
      states.forEach(([control])=>control.disabled=true);
      const notice=detail.querySelector('[data-action-status]');notice.textContent='Anulando boleta y revirtiendo el stock…';
      window.CorralonSystem?.articleSync?.set('syncing','Anulando boleta y revirtiendo el stock…');
      try{
        const payload={usuarioId:valuesUser().id,idRecibo:row.idRecibo,version};
        if(detailOptions.cancelInvoice)await detailOptions.cancelInvoice(payload);
        else {
          const response=await fetch('/api/facturacion/comprobante-anular',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo confirmar la anulación. Volvé a consultar la boleta antes de reintentar.');
        }
        row.anulada=-1;row.total=0;
        const listRow=get('[data-rows]').querySelector(`[data-invoice="${index}"]`);
        if(listRow){listRow.children[5].textContent=money(0);listRow.children[6].textContent='Anulada';listRow.children[6].classList.add('cancelled');}
        actionBusy=false;await openDetail(index,{refresh:true});
        detail.querySelector('[data-action-status]').textContent='Boleta anulada en SQL.';
        window.CorralonSystem?.articleSync?.set('success','Boleta anulada en SQL');
        window.CorralonInvoiceHistoryActions?.refreshAfterAnnul?.(row.idRecibo)?.catch(console.warn);
      }catch(error){notice.textContent=error.message;window.CorralonSystem?.articleSync?.set('error',error.message);}
      finally{
        actionBusy=false;cancellationBusy=false;states.forEach(([control,disabled])=>control.disabled=disabled);refreshAnnulButton();
        const unavailable=!Number(detailData?.comprobante?.confirmado)||Boolean(Number(detailData?.comprobante?.anulada))||Boolean(detailData?.valuesDirty);
        detail.querySelector('[data-preview]').disabled=unavailable||!historyActions().preview;
        detail.querySelector('[data-reprint]').disabled=unavailable||!historyActions().reprint;
      }
    });
    function closeDetail(){if(cancellationBusy)return;const wasOpen=!detail.hidden;if(sectionHost?.dataset.detailOpen==='true')notifyDetailSection(false);warrantyMenu.hidden=true;detailData=null;detail.hidden=true;detailSequence++;clearInvoiceDetails();const body=detail.querySelector('[data-detail-body]'),footer=detail.querySelector('.invoice-history-footer');if(footer&&body.contains(footer))detail.querySelector('.invoice-history-card').appendChild(footer);body.inert=false;body.removeAttribute('aria-busy');body.textContent='';if(overlay.hidden)returnFocus?.focus();else get('[data-rows]').querySelector(`[data-invoice="${detailIndex}"]`)?.focus();if(wasOpen)detailOptions.onClose?.();}
    let sectionActive=false,sectionExit=null,sectionHost=null;
    function notifyDetailSection(active){
      if(!sectionHost)return;
      sectionHost.dataset.detailOpen=String(active);
      window.dispatchEvent(new CustomEvent('invoice-detail-section',{detail:{active,title:detail.querySelector('[data-title]').textContent,
        controls:[...detail.querySelector('.invoice-history-head').children].filter(node=>!node.matches('h2'))}}));
    }
    function close(){if(sectionActive){if(actionBusy||cancellationBusy||detailData?.valuesDirty){message('Guardá los cambios antes de salir.',true);return;}sectionExit?.();return;}clearTimeout(searchTimer);closeDetail();overlay.hidden=true;sequence++;listController?.abort();rows=[];listLoading=false;hasMore=false;moreError=false;listQuery='';get('[data-rows]').textContent='';button?.focus()}
    window.CorralonInvoiceHistory={
      openSection(host,onExit){
        sectionActive=true;sectionExit=onExit;sectionHost=host;
        host.append(classicSearch,overlay);overlay.removeAttribute('aria-modal');overlay.setAttribute('role','region');
        get('[data-close]').textContent='Volver a Facturación';
        return openList();
      },
      canLeaveSection(){return !actionBusy&&!cancellationBusy&&!detailData?.valuesDirty;},
      suspendSection(){
        sectionActive=false;closeClassicSearch();clearTimeout(searchTimer);closeDetail();overlay.hidden=true;
        sequence++;listController?.abort();listLoading=false;
      },
      async openInvoice(id,context=[],options={}){
        id=Number(id);if(!Number.isInteger(id)||id<=0)throw new Error('Seleccioná una factura válida.');
        if(actionBusy)throw new Error('Esperá a que termine la operación actual.');
        detailOptions=options;
        const host=options.host || document.body;
        detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');detail.querySelector('[data-detail-close]').textContent='Cerrar';
      if(host.tagName==='DIALOG'){detail.removeAttribute('aria-modal');detail.setAttribute('role','region');}
        if(detail.parentElement!==host)host.appendChild(detail);
        if(warrantyMenu.parentElement!==host)host.appendChild(warrantyMenu);
        const request=++directOpenSequence;returnFocus=document.activeElement;
        if(!historyConfig)historyConfig=await sql('bootstrap',new AbortController());
        if(request!==directOpenSequence)return;
        listController?.abort();sequence++;overlay.hidden=true;closeClassicSearch();clearInvoiceDetails();
        rows=context.map(row=>({...row,idRecibo:Number(row.idRecibo??row.id)}));
        let index=rows.findIndex(row=>row.idRecibo===id);
        if(index<0){rows=[{idRecibo:id,numero:''}];index=0;}
        const opening=openDetail(index);options.onOpen?.();
        detail.querySelector('[data-detail-close]').focus();await opening;
      },
      close:closeDetail
    };
    async function openList(){
      if(!overlay.hidden||!classicSearch.hidden)return;const sectionLayout=sectionActive;detailOptions={};overlay.hidden=false;get('[data-search]').value='';get('[data-article]').value='';sortField='';sortDirection='';paintSort();page=0;const current=dateText(new Date());get('[data-from]').value=current;get('[data-to]').value=current;get('[data-branch]').innerHTML='<option value="0">Todas las sucursales</option>';
      const selectedPoint=Number(document.getElementById('pos')?.value)||0;
      if(sectionLayout){
      historyConfig=null;
      for(const name of ['from','to'])classicField(name).value=current;
      for(const name of ['client','number','article'])classicField(name).value='';
      showClassicSearch();
    }else{message('Consultando la sucursal del punto de venta…');get('[data-search]').focus();}
    overlay.dataset.classicSearch=String(sectionLayout);
      get('[data-close]').textContent=sectionLayout?'Volver a búsqueda':'Volver a Facturación';
      const controller=new AbortController(),request=++sequence;
      try{const config=await sql('bootstrap',controller);if(request!==sequence||overlay.hidden&&classicSearch.hidden)return;historyConfig=config;get('[data-branch]').innerHTML='<option value="0">Todas las sucursales</option>'+config.sucursales.map(s=>`<option value="${Number(s.id)}">${escape(s.nombre)}</option>`).join('');
        const branch=Number((config.puntosVenta||[]).find(p=>Number(p.id)===selectedPoint)?.idSucursal)||0;
        get('[data-branch]').value=String(branch);get('[data-point]').innerHTML='<option value="0">Todos los puntos de venta</option>'+(config.puntosVenta||[]).map(p=>`<option value="${Number(p.id)}">${escape(p.id)} · ${escape(p.nombre)}</option>`).join('');
        if(sectionLayout){
          for(const name of ['branch','point'])classicField(name).innerHTML=get('[data-'+name+']').innerHTML;
          classicField('branch').value=String(branch);
          classicField('point').value=String(selectedPoint);
        }else await load();
      }catch(error){if(request!==sequence)return;if(!classicSearch.hidden)classicStatus.textContent=error.message;else if(!overlay.hidden)message('No se pudieron cargar las sucursales: '+error.message,true)}
    }
    button?.addEventListener('click',()=>window.CorralonInvoiceSections?window.CorralonInvoiceSections.show('invoice-consult'):openList());
    get('form').addEventListener('submit',event=>{event.preventDefault();completeReceiptSearch();load()});get('[data-close]').addEventListener('click',()=>{if(overlay.dataset.classicSearch==='true'){sequence++;listController?.abort();showClassicSearch();}else close();});get('[data-branch]').addEventListener('change',()=>load());get('[data-point]').addEventListener('change',()=>load());
    for(const selector of ['[data-from]','[data-to]']){const field=get(selector);field.addEventListener('input',()=>field.setCustomValidity(''));field.addEventListener('change',()=>load())}
    for(const selector of ['[data-search]','[data-article]'])get(selector).addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(),350)});
    get('[data-rows]').addEventListener('click',event=>{const row=event.target.closest('[data-invoice]');if(row)openDetail(Number(row.dataset.invoice))});get('[data-rows]').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('tr[data-invoice]')){event.preventDefault();openDetail(Number(event.target.dataset.invoice))}});
    get('form').addEventListener('keydown',event=>{if(event.defaultPrevented)return;const controls=[get('[data-branch]'),get('[data-point]'),get('[data-from]'),get('[data-to]'),get('[data-search]'),get('[data-article]')],index=controls.indexOf(event.target);if(index<0)return;
      if(event.key==='F2'&&event.target.select){event.preventDefault();event.target.select();return}
      if(event.key==='Enter'){event.preventDefault();if(index<controls.length-1){if(event.target.classList.contains('date')&&!dateInput(event.target))return;controls[index+1].focus();controls[index+1].select?.()}else load()}
    });
    function navigateDetail(direction){
      if(detail.hidden||actionBusy||cancellationBusy||!detailData)return;
      const nextIndex=detailIndex+direction;
      if(nextIndex<0||nextIndex>=rows.length)return;
      if(detailData.valuesDirty){detail.querySelector('[data-action-status]').textContent='Guardá los valores antes de cambiar de comprobante.';return;}
      openDetail(nextIndex);
    }
    detail.querySelector('[data-detail-close]').addEventListener('click',closeDetail);
    const previousDetail=detail.querySelector('[data-detail-prev]'),nextDetail=detail.querySelector('[data-detail-next]');
    previousDetail.title='Comprobante anterior (RePág)';previousDetail.setAttribute('aria-keyshortcuts','PageUp');
    nextDetail.title='Comprobante siguiente (AvPág)';nextDetail.setAttribute('aria-keyshortcuts','PageDown');
    previousDetail.addEventListener('click',()=>navigateDetail(-1));nextDetail.addEventListener('click',()=>navigateDetail(1));
    document.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||!['PageDown','PageUp'].includes(event.key)||detail.hidden)return;
      if(!warrantyMenu.hidden||[...document.querySelectorAll('dialog[open],.modal-wrap.open')].some(modal=>!detail.contains(modal)))return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.repeat)return;
      navigateDetail(event.key==='PageDown'?1:-1);
    },true);
    document.addEventListener('keydown',event=>{if(event.defaultPrevented||event.target.closest?.('dialog[open]'))return;if(event.key==='Escape'&&!warrantyMenu.hidden){event.preventDefault();warrantyMenu.hidden=true;}else if(event.key==='Escape'&&!detail.hidden){event.preventDefault();closeDetail()}else if(event.key==='Escape'&&!overlay.hidden){event.preventDefault();get('[data-close]').click()}else if(event.key==='Escape'&&!classicSearch.hidden){event.preventDefault();close()}});
    return window.CorralonInvoiceHistory;
  }

  function createReceiptDialog(){
    const template=document.createElement('template');
    template.innerHTML=`<dialog id="rc-receiptModal" aria-labelledby="rc-receiptTitle"><div class="dialog-header"><h2 id="rc-receiptTitle">Recibo de Cobro</h2><button type="button" data-close="receiptModal">Cerrar</button></div><div id="rc-receiptBody"></div><section id="rc-receiptPrint" aria-label="Recibo para imprimir"></section><p id="rc-receiptStatus" role="status"></p><div id="rc-receiptActions"><button type="button" id="rc-voidReceipt" style="color:#b00020;margin-right:8px" hidden="">Anular recibo</button><button type="button" id="rc-printReceipt">Imprimir</button></div></dialog>`;
    return template.content.firstElementChild;
  }

  function renderReceiptDialogBody(result){
    const receipt=result.recibo, invoices=result.facturas, values=result.valores;
    const applied=invoices.reduce((sum,row)=>sum+(Number(row.importe)||0),0);
    const difference=Math.round(((Number(receipt.total)||0)-applied)*100)/100;
    const concept=String(receipt.concepto||'').replace(/\[(?:WEBRECIBO|HASH):[^\]]*\]/g,'').trim();
    const field=(label,value)=>`<div><span>${label}</span><strong>${esc(value??'')}</strong></div>`;
    const records=rows=>`<div class="receipt-dialog-records receipt-dialog-classic">Registro: ${rows.length?1:0} de ${rows.length}</div>`;
    return `
      <div class="receipt-summary"><div>Cliente<strong>${esc(receipt.cliente)}</strong></div><div>Fecha<strong>${esc(receipt.fecha)}</strong></div><div>Punto de venta<strong>${esc(receipt.nombrePuntoVenta)}</strong></div></div>
      <div class="receipt-dialog-fields receipt-dialog-classic">
        <div>${field('P.V.',receipt.puntoVenta)}${field('N.º',receipt.numero)}${field('Fecha',receipt.fecha)}${field('IDOper.',receipt.idOperador??receipt.operador)}${field('Anulado',receipt.anulado?'Sí':'No')}</div>
        <div>${field('Cliente',receipt.cliente)}${field('ID',receipt.idCliente)}${field('IDCaja',receipt.idCaja)}</div>
        <div>${field('Concepto',concept)}</div>
      </div>
      <h2>Facturas cobradas</h2>
      <div class="receipt-dialog-grid"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Factura</th><th class="receipt-dialog-money">A Cobrar</th><th class="receipt-dialog-classic receipt-dialog-money">Total factura</th></tr></thead><tbody>${invoices.map(row=>`<tr><td>${esc(row.fecha)}</td><td>${esc(row.tipo)}</td><td>${esc(row.numero)}</td><td class="receipt-dialog-money">${money(row.importe)}</td><td class="receipt-dialog-classic receipt-dialog-money">${row.importeFactura==null?'':money(row.importeFactura)}</td></tr>`).join('')}</tbody></table>${records(invoices)}</div>
      ${invoices.length?'':receipt.anulado?'<p>Sin boletas vinculadas.</p>':'<p>Pago a cuenta.</p>'}
      <div class="receipt-dialog-subtotal receipt-dialog-classic">Total Cobros <output>${money(applied)}</output> Diferencia <output>${money(difference)}</output></div>
      <h2>Valores recibidos</h2>
      <div class="receipt-dialog-grid"><table><thead><tr><th>Tipo</th><th>Valor Nº</th><th>Tarjeta</th><th>Cuotas</th><th>Vencimiento</th><th class="receipt-dialog-money">Importe</th><th>Descripción</th></tr></thead><tbody>${values.map(row=>`<tr><td>${esc(row.tipo)}</td><td>${esc(row.numero||'')}</td><td>${esc(row.tarjeta||'Ninguna')}</td><td>${Number(row.cuotas)||0}</td><td>${esc(row.vencimiento)}</td><td class="receipt-dialog-money">${money(row.importe)}</td><td>${esc(row.descripcion)}</td></tr>`).join('')}</tbody></table>${records(values)}</div>
      <p class="receipt-note">${esc(receipt.nota)}</p><div class="invoice-total" style="width:100%">Total<span class="receipt-dialog-classic"> Valores</span>: <output class="total">${money(receipt.total)}</output></div>`;
  }

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => new Intl.NumberFormat('es-AR', {style:'currency',currency:'ARS'}).format(Number(value)||0);

  function receiptAmountWords(amount) {
    const small=['CERO','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE','VEINTIUNO','VEINTIDÓS','VEINTITRÉS','VEINTICUATRO','VEINTICINCO','VEINTISÉIS','VEINTISIETE','VEINTIOCHO','VEINTINUEVE'];
    const tens=['','','','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
    const hundreds=['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
    const apocope=text=>text.replace(/VEINTIUNO$/,'VEINTIÚN').replace(/UNO$/,'UN');
    function words(n) {
      if(n<30)return small[n];
      if(n<100)return tens[Math.floor(n/10)]+(n%10?' Y '+small[n%10]:'');
      if(n===100)return 'CIEN';
      if(n<1000)return hundreds[Math.floor(n/100)]+(n%100?' '+words(n%100):'');
      if(n<1000000)return (n<2000?'MIL':apocope(words(Math.floor(n/1000)))+' MIL')+(n%1000?' '+words(n%1000):'');
      return (n<2000000?'UN MILLÓN':apocope(words(Math.floor(n/1000000)))+' MILLONES')+(n%1000000?' '+words(n%1000000):'');
    }
    const cents=Math.round(Math.abs(Number(amount)||0)*100);
    return (Number(amount)<0?'MENOS ':'')+words(Math.floor(cents/100))+(cents%100?' CON '+String(cents%100).padStart(2,'0')+'/100':'');
  }
  function renderReceiptPrint(result) {
    const receipt=result.recibo;
    const concept=String(receipt.concepto||'').replace(/\[(?:WEBRECIBO|HASH):[^\]]*\]/g,'').trim();
    return `<div class="receipt-brand"><img src="logo-corralon.png" alt="Corralón Progreso"><div class="receipt-contact">Tel.: 264-5802404<br>Email: corralonprogreso3@gmail.com</div></div>
      <div class="receipt-number"><span><span class="receipt-label">RECIBO Nº</span>${esc(receipt.numero)}${receipt.anulado?' · ANULADO':''}</span><span><span class="receipt-label">Fecha</span>${esc(receipt.fecha)}</span></div>
      <div class="receipt-data"><div class="receipt-wide"><span class="receipt-label">Razón Social</span>${esc(receipt.idCliente)} &nbsp; <strong>${esc(receipt.cliente)}</strong></div>
      <div><span class="receipt-label">CUIT/DNI:</span>${esc(receipt.documento||'—')}</div><div class="receipt-balance"><span class="receipt-label">Saldo Act.:</span><strong>${receipt.saldo==null?'—':money(receipt.saldo)}</strong></div>
      <div class="receipt-wide"><span class="receipt-label">Concepto:</span>${esc(concept)}</div></div>
      ${(result.facturas||[]).length?`<table class="receipt-applied"><colgroup><col style="width:26%"><col style="width:19%"><col style="width:9%"><col style="width:23%"><col style="width:23%"></colgroup><thead><tr><th>Nº Factura</th><th>Fecha</th><th>Cuota</th><th>Importe Fac.</th><th>Importe Pagado</th></tr></thead><tbody>${result.facturas.map(row=>`<tr><td>${esc(row.numero)}</td><td>${esc(row.fecha)}</td><td>${esc(row.cuota??0)}</td><td>${row.importeFactura==null?'—':money(row.importeFactura)}</td><td>${money(row.importe)}</td></tr>`).join('')}</tbody></table>`:''}
      <table><colgroup><col style="width:24%"><col style="width:19%"><col style="width:32%"><col style="width:25%"></colgroup><thead><tr><th>Tipo Pago</th><th>Fecha Vto.</th><th>Banco</th><th>Importe</th></tr></thead><tbody>${(result.valores||[]).map(row=>`<tr><td>${esc(row.tipo)}</td><td>${esc(row.vencimiento)}</td><td>${esc(row.banco||'')}</td><td>${money(row.importe)}</td></tr>`).join('')}</tbody></table>
      <div class="receipt-grand-total"><span class="receipt-label">Total:</span><span>${money(receipt.total)}</span></div>
      <div class="receipt-words"><span class="receipt-label">Son $:</span>${esc(receiptAmountWords(receipt.total))}</div>
      <div><span class="receipt-label">Nota</span><div class="receipt-print-note">${esc(receipt.nota||'')}</div></div>
      <div class="receipt-signatures"><span>Firma Cliente</span><span>Firma Cobrador</span></div>`;
  }

  let invoiceDialog=null, receiptDialog=null;
  function openInvoiceDialog(id){
    if(invoiceDialog||!menuUserHasAccess('facturacion'))return;
    const history=ensureInvoiceHistory();
    const dialog=document.createElement('dialog'),trigger=document.activeElement;
    dialog.className='shared-invoice-dialog';
    dialog.setAttribute('aria-label','Detalle de boleta');
    dialog.style.cssText='padding:0;border:0;width:100%;height:100%;max-width:none;max-height:none;background:transparent';
    document.body.append(dialog);
    invoiceDialog=dialog;
    function release(){
      if(invoiceDialog!==dialog)return;
      invoiceDialog=null;
      dialog.close();
      dialog.remove();
      trigger?.focus();
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();history.close();});
    return history.openInvoice(id,[],{readOnly:true,host:dialog,onOpen:()=>dialog.showModal(),onClose:release})
      .catch(error=>{history.close();release();throw error;});
  }

  async function openReceiptDialog(id){
    if(receiptDialog||!menuUserHasAccess('recibos_cobro'))return;
    if(!Number.isInteger(Number(id))||Number(id)<=0)throw new Error('Seleccioná un recibo válido.');
    const dialog=createReceiptDialog(),trigger=document.activeElement,controller=new AbortController();
    const get=suffix=>dialog.querySelector('#rc-'+suffix);
    dialog.classList.add('shared-receipt-dialog');
    const status=get('receiptStatus'),printButton=get('printReceipt');
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    printButton.onclick=()=>window.print();
    printButton.disabled=true;
    status.textContent='Consultando recibo…';
    dialog.addEventListener('close',()=>{
      controller.abort();
      dialog.remove();
      receiptDialog=null;
      trigger?.focus();
    },{once:true});
    if(!document.getElementById('shared-voucher-styles')){
      const styles=document.createElement('style');
      styles.id='shared-voucher-styles';
      styles.textContent=`
        .shared-receipt-dialog{width:min(1000px,95vw);max-height:90dvh;border:1px solid #aaa;border-radius:8px;padding:16px;overflow:auto;background:white;color:#151515;font:14px Arial,sans-serif;box-sizing:border-box}
        .shared-receipt-dialog::backdrop{background:#0006}
        .shared-receipt-dialog .dialog-header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}
        .shared-receipt-dialog h2{margin:12px 0 6px;font-size:20px}
        .shared-receipt-dialog .dialog-header h2{margin:0}
        .shared-receipt-dialog .receipt-summary{display:flex;gap:30px;flex-wrap:wrap;padding:10px 0}
        .shared-receipt-dialog .receipt-summary strong{display:block}
        .shared-receipt-dialog .receipt-note{white-space:pre-wrap}
        .shared-receipt-dialog table{width:100%;border-collapse:collapse}
        .shared-receipt-dialog :is(td,th){padding:5px;border-bottom:1px solid #d5dfe9;text-align:left}
        .shared-receipt-dialog th{background:#e7eff8}
        .shared-receipt-dialog :is(.invoice-total,#rc-receiptActions){text-align:right;font-weight:bold;margin-top:14px}
        .shared-receipt-dialog #rc-receiptPrint{display:none}
        @media print{
          body:has(>.shared-receipt-dialog[open])>*:not(.shared-receipt-dialog){display:none!important}
          .shared-receipt-dialog[open]{position:static!important;inset:auto!important;margin:0!important;padding:0!important;width:100%!important;max-height:none!important;overflow:visible!important;border:0!important}
          .shared-receipt-dialog::backdrop,.shared-receipt-dialog>:not(#rc-receiptPrint){display:none!important}
.shared-receipt-dialog #rc-receiptPrint{display: block !important; width: 124mm; max-width: 100%; margin: 0px auto; color: rgb(0, 0, 0); font: 8pt Arial, sans-serif;}
.shared-receipt-dialog #rc-receiptPrint .receipt-brand{display: flex; align-items: center; gap: 8mm; border-bottom: 1px solid black; padding: 0px 0px 2mm;}
.shared-receipt-dialog #rc-receiptPrint .receipt-brand img{width: 56mm; height: 16mm; object-fit: contain;}
.shared-receipt-dialog #rc-receiptPrint .receipt-contact{font-size: 7pt; line-height: 2; overflow-wrap: anywhere;}
.shared-receipt-dialog #rc-receiptPrint .receipt-number{display: flex; justify-content: space-between; margin: 1mm 0px 5mm;}
.shared-receipt-dialog #rc-receiptPrint .receipt-data{display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 5mm; margin-bottom: 5mm;}
.shared-receipt-dialog #rc-receiptPrint .receipt-wide{grid-column: 1/-1; overflow-wrap: anywhere;}
.shared-receipt-dialog #rc-receiptPrint .receipt-label{font-weight: bold; text-decoration: underline; margin-right: 2mm;}
.shared-receipt-dialog #rc-receiptPrint .receipt-balance{display: flex; justify-content: space-between;}
.shared-receipt-dialog #rc-receiptPrint table{width: 100%; table-layout: fixed; border-collapse: collapse; font: 8pt Arial, sans-serif;}
.shared-receipt-dialog #rc-receiptPrint th,.shared-receipt-dialog #rc-receiptPrint td{position: static; background: white !important; border: 0px; padding: 1mm 0px; height: auto; overflow-wrap: anywhere; text-align: left;}
.shared-receipt-dialog #rc-receiptPrint th{font-weight: bold; text-decoration: underline;}
.shared-receipt-dialog #rc-receiptPrint th:last-child,.shared-receipt-dialog #rc-receiptPrint td:last-child{text-align: right;}
.shared-receipt-dialog #rc-receiptPrint .receipt-applied{margin-bottom: 3mm; border-bottom: 1px dotted black;}
.shared-receipt-dialog #rc-receiptPrint .receipt-applied th:nth-child(3),.shared-receipt-dialog #rc-receiptPrint .receipt-applied td:nth-child(3){text-align: center;}
.shared-receipt-dialog #rc-receiptPrint .receipt-applied th:nth-child(4),.shared-receipt-dialog #rc-receiptPrint .receipt-applied td:nth-child(4){text-align: right;}
.shared-receipt-dialog #rc-receiptPrint .receipt-grand-total{border-top: 1px dotted black; display: flex; justify-content: flex-end; gap: 12mm; padding-top: 1mm; font-weight: bold; font-size: 10pt;}
.shared-receipt-dialog #rc-receiptPrint .receipt-words{margin: 4mm 0px 2mm;}
.shared-receipt-dialog #rc-receiptPrint .receipt-print-note{white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 1mm;}
.shared-receipt-dialog #rc-receiptPrint .receipt-signatures{display: flex; justify-content: space-around; gap: 20mm; margin-top: 10mm; font-size: 8pt; text-align: center; break-inside: avoid;}
.shared-receipt-dialog #rc-receiptPrint .receipt-signatures span{width: 55mm; border-top: 1px dotted black; padding-top: 1mm;}
.shared-receipt-dialog #rc-receiptPrint tr{break-inside: avoid;}
        }
      `;
      document.head.append(styles);
    }
    document.body.append(dialog);
    receiptDialog=dialog;
    dialog.showModal();
    try{
      const query=new URLSearchParams({consulta:'detalle',id,usuarioId:menuSessionUser()?.id});
      const response=await fetch('/api/facturacion/recibos-cobro?'+query,{cache:'no-store',signal:controller.signal});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'No se pudo consultar el recibo.');
      const receipt=result.recibo;
      if(!dialog.open)return;
      get('receiptTitle').textContent='Recibo de Cobro '+receipt.numero+(receipt.anulado?' · ANULADO':'');
      get('receiptBody').innerHTML=renderReceiptDialogBody(result);
      get('receiptPrint').innerHTML=renderReceiptPrint(result);
      status.textContent='';
      printButton.disabled=false;
    }catch(error){
      if(!controller.signal.aborted)status.textContent=error.message;
    }
  }

  window.CorralonFunciones = {
    ensureInvoiceHistory,
    openInvoiceDialog,
    createReceiptDialog,
    renderReceiptDialogBody,
    renderReceiptPrint,
    openReceiptDialog,
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
    whatsappNumber,
    collectionReminderDates,
    collectionWhatsAppReminder,
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
