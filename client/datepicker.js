// Standalone range date picker — no external dependencies
// Usage: new RangeDatePicker({ container, onChange, getMarkedDates, getMinDate, getMaxDate })
(function (global) {
  'use strict';

  const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
    'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
  const MONTHS_SHORT = ['січ.','лют.','бер.','квіт.','трав.','черв.',
    'лип.','серп.','вер.','жовт.','лист.','груд.'];
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

  function todayStr() {
    const d = new Date();
    return p4(d.getFullYear()) + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function p2(n) { return String(n).padStart(2, '0'); }
  function p4(n) { return String(n).padStart(4, '0'); }
  function fmt(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return parseInt(d) + ' ' + MONTHS_SHORT[parseInt(m) - 1] + ' ' + y;
  }

  const CSS_VER = '6';
  const CSS = `
.rdp{position:relative;display:inline-flex;align-items:center;gap:6px;width:100%}
.rdp-bar{
  display:flex;align-items:center;gap:8px;flex:1;
  background:var(--surface,#1e2535);
  border:1px solid var(--border,#2d3748);
  border-radius:10px;padding:7px 12px;cursor:pointer;
  transition:border-color .2s;
}
.rdp-bar:hover{border-color:var(--accent,#3b82f6)}
.rdp-field{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.rdp-label{font-size:10px;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.5px}
.rdp-val{font-size:13px;color:var(--muted,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rdp-val.rdp-filled{color:var(--text,#e5e7eb)}
.rdp-arrow{font-size:12px;color:var(--muted,#6b7280);flex-shrink:0}
.rdp-clear{
  background:none;border:1px solid var(--border,#2d3748);
  border-radius:8px;color:var(--muted,#6b7280);
  cursor:pointer;font-size:13px;padding:5px 9px;
  transition:color .15s,border-color .15s;flex-shrink:0;line-height:1
}
.rdp-clear:hover{color:var(--text,#e5e7eb);border-color:var(--text,#e5e7eb)}
.rdp-overlay{
  position:fixed;inset:0;z-index:9999;
  display:none;align-items:center;justify-content:center;
  padding:16px;box-sizing:border-box;
  /* Stay interactive even when opened over a modal whose backdrop sets
     body{pointer-events:none} to disable the UI behind it. */
  pointer-events:auto;
}
.rdp-overlay.rdp-mobile{background:rgba(0,0,0,.55)}
.rdp-overlay.rdp-mobile .rdp-cell{padding:12px 2px 11px;font-size:16px}
.rdp-overlay.rdp-mobile .rdp-wdays span{padding:6px 0;font-size:11px}
.rdp-overlay.rdp-mobile .rdp-mth{font-size:16px}
.rdp-overlay.rdp-mobile .rdp-nav{font-size:26px;padding:0 12px}
.rdp-overlay.rdp-mobile .rdp-pop{padding:18px 18px 16px}
.rdp-overlay.rdp-desktop{background:transparent;padding:0;align-items:flex-start;justify-content:flex-start}
.rdp-pop{
  background:var(--card,#161f35);
  border:1px solid var(--border,#2d3748);
  border-radius:14px;padding:14px 14px 12px;
  box-shadow:0 8px 40px rgba(0,0,0,.65);
  user-select:none;box-sizing:border-box;
  width:100%;
}
.rdp-overlay.rdp-desktop .rdp-pop{
  position:absolute;width:auto;min-width:280px;
}
.rdp-pop-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.rdp-nav{
  background:none;border:none;color:var(--text,#e5e7eb);
  cursor:pointer;font-size:20px;padding:0 8px;border-radius:6px;
  line-height:1.4;transition:background .15s;
}
.rdp-nav:hover:not(:disabled){background:rgba(255,255,255,.08)}
.rdp-nav:disabled{opacity:.25;cursor:default}
.rdp-mth{font-size:14px;font-weight:600;color:var(--text,#e5e7eb)}
.rdp-wdays{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px}
.rdp-wdays span{
  text-align:center;font-size:10px;color:var(--muted,#6b7280);
  padding:3px 0;text-transform:uppercase;
}
.rdp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px}
.rdp-cell{
  position:relative;text-align:center;font-size:13px;
  padding:5px 2px 4px;border-radius:6px;cursor:pointer;
  color:var(--text,#e5e7eb);transition:background .1s;line-height:1.2;
}
.rdp-cell:hover:not(.rdp-empty){background:rgba(255,255,255,.08)}
.rdp-empty{cursor:default}
.rdp-today{font-weight:700}
.rdp-today-dot::after{
  content:'';display:block;width:4px;height:4px;border-radius:50%;
  background:var(--accent,#3b82f6);margin:1px auto 0;
}
.rdp-dot{
  display:block;width:4px;height:4px;border-radius:50%;
  background:#22c55e;margin:1px auto 0;
}
.rdp-range{background:rgba(59,130,246,.13);border-radius:0}
.rdp-sel{background:var(--accent,#3b82f6)!important;color:#fff!important;border-radius:6px!important}
.rdp-hint{
  font-size:11px;color:var(--muted,#6b7280);
  text-align:center;margin-top:10px;padding-top:8px;
  border-top:1px solid var(--border,#2d3748);
}
`;

  function injectCSS() {
    const existing = document.getElementById('rdp-css');
    if (existing && existing.dataset.ver === CSS_VER) return;
    if (existing) existing.remove();
    const s = document.createElement('style');
    s.id = 'rdp-css';
    s.dataset.ver = CSS_VER;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  class RangeDatePicker {
    constructor(opts) {
      this._onChange  = opts.onChange       || (() => {});
      this._getMarked = opts.getMarkedDates || (() => new Set());
      this._getMin    = opts.getMinDate     || (() => null);
      this._getMax    = opts.getMaxDate     || (() => todayStr());
      this._single    = !!opts.single;      // single-date mode (no range)
      this._label     = opts.label || null;

      this._from = null;
      this._to   = null;
      this._sel  = 'from';
      this._vy   = new Date().getFullYear();
      this._vm   = new Date().getMonth();
      this._open = false;

      injectCSS();

      const el = typeof opts.container === 'string'
        ? document.getElementById(opts.container)
        : opts.container;
      this._root = el;
      this._build();
    }

    _build() {
      this._root.className = 'rdp';
      this._root.innerHTML = this._single
        ? `
        <div class="rdp-bar">
          <div class="rdp-field rdp-f-from">
            <span class="rdp-label">${this._label || 'дата'}</span>
            <span class="rdp-val">—</span>
          </div>
          <span class="rdp-arrow">📅</span>
        </div>`
        : `
        <div class="rdp-bar">
          <div class="rdp-field rdp-f-from">
            <span class="rdp-label">від</span>
            <span class="rdp-val">—</span>
          </div>
          <span class="rdp-arrow">→</span>
          <div class="rdp-field rdp-f-to">
            <span class="rdp-label">до</span>
            <span class="rdp-val">—</span>
          </div>
        </div>
        <button class="rdp-clear" title="Скинути фільтр">✕</button>`;

      this._fromVal = this._root.querySelector('.rdp-f-from .rdp-val');
      this._toVal   = this._root.querySelector('.rdp-f-to .rdp-val');

      // Overlay + popup appended to <body> — escapes all overflow:hidden/auto ancestors
      this._overlay = document.createElement('div');
      this._overlay.className = 'rdp-overlay';

      this._pop = document.createElement('div');
      this._pop.className = 'rdp-pop';
      this._pop.innerHTML = `
        <div class="rdp-pop-head">
          <button class="rdp-nav rdp-prev">‹</button>
          <span class="rdp-mth"></span>
          <button class="rdp-nav rdp-next">›</button>
        </div>
        <div class="rdp-wdays">${DAYS.map(d => `<span>${d}</span>`).join('')}</div>
        <div class="rdp-grid"></div>
        <div class="rdp-hint"></div>`;

      this._overlay.appendChild(this._pop);
      document.body.appendChild(this._overlay);

      this._grid   = this._pop.querySelector('.rdp-grid');
      this._mthEl  = this._pop.querySelector('.rdp-mth');
      this._hintEl = this._pop.querySelector('.rdp-hint');

      this._root.querySelector('.rdp-bar').addEventListener('click', e => {
        if (this._single) {
          if (this._open) this._close(); else this._openFor('from');
          return;
        }
        const field  = e.target.closest('.rdp-field');
        const target = field
          ? (field.classList.contains('rdp-f-from') ? 'from' : 'to')
          : this._sel;
        if (this._open && this._sel === target) this._close();
        else this._openFor(target);
      });

      const clearBtn = this._root.querySelector('.rdp-clear');
      if (clearBtn) clearBtn.addEventListener('click', e => {
        e.stopPropagation();
        this._clear();
      });

      this._pop.querySelector('.rdp-prev').addEventListener('click', e => {
        e.stopPropagation();
        if (--this._vm < 0) { this._vm = 11; this._vy--; }
        this._renderGrid();
      });

      this._pop.querySelector('.rdp-next').addEventListener('click', e => {
        e.stopPropagation();
        if (++this._vm > 11) { this._vm = 0; this._vy++; }
        this._renderGrid();
      });

      this._grid.addEventListener('click', e => {
        const cell = e.target.closest('[data-d]');
        if (!cell) return;
        e.stopPropagation();
        this._pick(cell.dataset.d);
      });

      // Click the overlay backdrop (not the popup) → close
      this._overlay.addEventListener('click', e => {
        if (e.target === this._overlay) this._close();
      });

      document.addEventListener('keydown', e => {
        if (this._open && e.key === 'Escape') this._close();
      });

      window.addEventListener('resize', () => {
        if (this._open) this._positionPopup();
      });
    }

    _positionPopup() {
      const vw = window.innerWidth;

      if (vw <= 600) {
        // Mobile: full-screen backdrop, popup fills it via CSS padding + width:100%
        // Zero JavaScript positioning — CSS handles everything
        this._overlay.className = 'rdp-overlay rdp-mobile';
        this._pop.style.cssText = '';  // clear any desktop inline styles
      } else {
        // Desktop: transparent overlay, popup positioned absolutely
        // position:absolute inside position:fixed inset:0 → coords = viewport coords
        this._overlay.className = 'rdp-overlay rdp-desktop';
        const bar  = this._root.querySelector('.rdp-bar');
        const rect = bar.getBoundingClientRect();
        const vh   = window.innerHeight;
        const popW = Math.max(rect.width, 280);

        let left = rect.left;
        if (left + popW > vw - 8) left = vw - popW - 8;
        if (left < 8) left = 8;

        this._pop.style.width  = popW + 'px';
        this._pop.style.left   = left + 'px';
        this._pop.style.right  = 'auto';

        if (vh - rect.bottom - 8 >= 300) {
          this._pop.style.top    = (rect.bottom + 6) + 'px';
          this._pop.style.bottom = 'auto';
        } else {
          this._pop.style.bottom = (vh - rect.top + 6) + 'px';
          this._pop.style.top    = 'auto';
        }
      }

      this._overlay.style.display = 'flex';
    }

    _openFor(target) {
      this._sel = target;
      const ref = target === 'from' ? this._from : (this._to || this._from);
      if (ref) {
        this._vy = parseInt(ref.slice(0, 4));
        this._vm = parseInt(ref.slice(5, 7)) - 1;
      } else {
        const t = todayStr();
        this._vy = parseInt(t.slice(0, 4));
        this._vm = parseInt(t.slice(5, 7)) - 1;
      }
      this._renderGrid();
      this._open = true;
      this._positionPopup();
    }

    _close() {
      this._overlay.style.display = 'none';
      this._open = false;
    }

    _pick(d) {
      if (this._single) {
        this._from = d;
        this._updateDisplay();
        this._close();
        this._onChange(d);
        return;
      }
      if (this._sel === 'from') {
        this._from = d;
        if (this._to && this._to < this._from) this._to = null;
        this._sel = 'to';
        this._updateDisplay();
        this._renderGrid();
      } else {
        if (this._from && d < this._from) {
          this._to   = this._from;
          this._from = d;
        } else {
          this._to = d;
        }
        this._sel = 'from';
        this._updateDisplay();
        this._close();
        this._onChange(this._from, this._to);
      }
    }

    _clear() {
      this._from = null;
      this._to   = null;
      this._sel  = 'from';
      this._updateDisplay();
      this._onChange(null, null);
    }

    _updateDisplay() {
      this._fromVal.textContent = fmt(this._from);
      this._fromVal.classList.toggle('rdp-filled', !!this._from);
      if (this._toVal) {
        this._toVal.textContent = fmt(this._to);
        this._toVal.classList.toggle('rdp-filled', !!this._to);
      }
    }

    _renderGrid() {
      const marked = this._getMarked();
      const min    = this._getMin();
      const max    = this._getMax();
      const t      = todayStr();

      this._mthEl.textContent = MONTHS[this._vm] + ' ' + this._vy;

      const prev = this._pop.querySelector('.rdp-prev');
      const next = this._pop.querySelector('.rdp-next');
      if (min) {
        const my = parseInt(min.slice(0, 4)), mm = parseInt(min.slice(5, 7)) - 1;
        prev.disabled = this._vy < my || (this._vy === my && this._vm <= mm);
      } else prev.disabled = false;
      if (max) {
        const xy = parseInt(max.slice(0, 4)), xm = parseInt(max.slice(5, 7)) - 1;
        next.disabled = this._vy > xy || (this._vy === xy && this._vm >= xm);
      } else next.disabled = false;

      const first  = new Date(this._vy, this._vm, 1);
      const last   = new Date(this._vy, this._vm + 1, 0);
      let   offset = first.getDay() - 1;
      if (offset < 0) offset = 6;

      const cells = [];
      for (let i = 0; i < offset; i++)
        cells.push('<span class="rdp-cell rdp-empty"></span>');

      for (let day = 1; day <= last.getDate(); day++) {
        const ds  = p4(this._vy) + '-' + p2(this._vm + 1) + '-' + p2(day);
        const cls = ['rdp-cell'];
        if (ds === t)                                                    cls.push('rdp-today');
        if (this._from && this._to && ds > this._from && ds < this._to) cls.push('rdp-range');
        if (ds === this._from || ds === this._to)                        cls.push('rdp-sel');

        const isSel = ds === this._from || ds === this._to;
        let dot = '';
        if (ds === t && !isSel)            dot = '<span class="rdp-today-dot"></span>';
        else if (marked.has(ds) && !isSel) dot = '<span class="rdp-dot"></span>';

        cells.push(`<span class="${cls.join(' ')}" data-d="${ds}">${day}${dot}</span>`);
      }

      this._grid.innerHTML     = cells.join('');
      this._hintEl.textContent = this._single ? 'Оберіть дату'
        : (this._sel === 'from' ? 'Оберіть початкову дату' : 'Оберіть кінцеву дату');
    }

    // Public API
    setRange(from, to) {
      this._from = from || null;
      this._to   = to   || null;
      this._updateDisplay();
    }
    getFrom()  { return this._from; }
    getTo()    { return this._to; }
    // Single-date convenience API
    setDate(d) { this._from = d || null; this._updateDisplay(); }
    getDate()  { return this._from; }
    refresh()  { if (this._open) this._renderGrid(); }
  }

  global.RangeDatePicker = RangeDatePicker;
})(window);
