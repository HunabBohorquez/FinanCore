/* =====================================================================
   FinanCore — app.js
   Módulos: LedgerStore · FinancialHealthEngine · FinanceCharts · UIController
   Sin dependencias externas.
   ===================================================================== */
'use strict';

/* ======================= 1. CONSTANTES Y UTILIDADES ======================= */

const TYPES = Object.freeze({ INCOME: 'Ingreso', EXPENSE: 'Gasto' });
const INCOME_CATEGORY = 'Ingresos/Beca/Salario';
const EXPENSE_CATEGORIES = Object.freeze([
  'Alimentación', 'Transporte', 'Vivienda/Servicios', 'Educación', 'Ocio', 'Salud', 'Ahorro'
]);
const ALL_CATEGORIES = Object.freeze([...EXPENSE_CATEGORIES, INCOME_CATEGORY]);

const STORAGE_KEYS = Object.freeze({
  transactions: 'financore.v1.transactions',
  budgets: 'financore.v1.budgets'
});

const HEALTH_CONFIG = Object.freeze({
  SAVINGS_TARGET_PCT: 20,   // tasa de ahorro que otorga el máximo de puntos
  MAX_SAVINGS_POINTS: 60,
  MAX_DISCIPLINE_POINTS: 40,
  WARN_THRESHOLD: 75,       // % a partir del cual el semáforo pasa a amarillo
  OVER_THRESHOLD: 100       // % a partir del cual el presupuesto está excedido
});

const CATEGORY_COLORS = Object.freeze({
  'Alimentación': '#ff8a5c',
  'Transporte': '#4cc9f0',
  'Vivienda/Servicios': '#7b8cff',
  'Educación': '#b57bff',
  'Ocio': '#ff5d9e',
  'Salud': '#2ecc8f',
  'Ahorro': '#f5c542'
});

const Utils = {
  currency: new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }),

  formatMoney(n) {
    return Utils.currency.format(Number.isFinite(n) ? n : 0);
  },

  round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  },

  clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  },

  pad(n) {
    return String(n).padStart(2, '0');
  },

  todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${Utils.pad(d.getMonth() + 1)}-${Utils.pad(d.getDate())}`;
  },

  currentMonth() {
    return Utils.todayISO().slice(0, 7);
  },

  isValidISODate(str) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const [y, m, d] = str.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  },

  formatDate(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  },

  formatMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const name = new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  },

  uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  },

  normalize(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  },

  csvCell(value) {
    let s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita inyección de fórmulas en hojas de cálculo
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  },

  debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  },

  /** Devuelve localStorage o un almacenamiento en memoria si el navegador lo bloquea. */
  getStorage() {
    try {
      const probe = '__financore_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      const mem = new Map();
      return {
        getItem: k => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: k => mem.delete(k)
      };
    }
  }
};

/** Crea elementos DOM de forma segura (sin innerHTML con datos del usuario). */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'type' || key === 'role' || key === 'title') {
      node.setAttribute(key, value);
    } else node[key] = value;
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

/* ======================= 2. LEDGER STORE ======================= */

class LedgerStore {
  constructor(storage) {
    this.storage = storage;
    this.transactions = [];
    this.budgets = {};
    this.load();
  }

  /* ---------- Reglas de dominio ---------- */

  static categoriesFor(type) {
    if (type === TYPES.INCOME) return [INCOME_CATEGORY];
    if (type === TYPES.EXPENSE) return [...EXPENSE_CATEGORIES];
    return [];
  }

  static validate(raw) {
    const errors = [];
    const type = raw && raw.type;
    const date = String((raw && raw.date) || '');
    const category = raw && raw.category;
    const description = String((raw && raw.description) || '').trim();
    const amount = Number(raw && raw.amount);

    if (!Object.values(TYPES).includes(type)) errors.push('Selecciona un tipo válido (Ingreso o Gasto).');
    if (!Utils.isValidISODate(date)) errors.push('La fecha no es válida.');
    if (!LedgerStore.categoriesFor(type).includes(category)) errors.push('La categoría no corresponde al tipo de movimiento.');
    if (!description) errors.push('La descripción es obligatoria.');
    if (description.length > 80) errors.push('La descripción no puede superar 80 caracteres.');
    if (!Number.isFinite(amount) || amount <= 0) errors.push('El monto debe ser un número mayor que 0.');
    else if (amount > 1e9) errors.push('El monto es demasiado grande.');

    return {
      ok: errors.length === 0,
      errors,
      clean: { date, type, category, description, amount: Number.isFinite(amount) ? Utils.round2(amount) : 0 }
    };
  }

  static sanitizeTransactions(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list) {
      const result = LedgerStore.validate(item);
      if (result.ok) out.push({ id: (item && item.id) || Utils.uid(), ...result.clean });
    }
    return out;
  }

  static sanitizeBudgets(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const category of EXPENSE_CATEGORIES) {
      const value = Number(obj[category]);
      if (Number.isFinite(value) && value > 0) out[category] = Utils.round2(value);
    }
    return out;
  }

  /* ---------- Persistencia ---------- */

  load() {
    try {
      this.transactions = LedgerStore.sanitizeTransactions(JSON.parse(this.storage.getItem(STORAGE_KEYS.transactions) || '[]'));
      this.budgets = LedgerStore.sanitizeBudgets(JSON.parse(this.storage.getItem(STORAGE_KEYS.budgets) || '{}'));
    } catch (err) {
      this.transactions = [];
      this.budgets = {};
    }
  }

  persist() {
    try {
      this.storage.setItem(STORAGE_KEYS.transactions, JSON.stringify(this.transactions));
      this.storage.setItem(STORAGE_KEYS.budgets, JSON.stringify(this.budgets));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- CRUD de movimientos ---------- */

  add(data) {
    const tx = { id: Utils.uid(), ...data };
    this.transactions.push(tx);
    this.persist();
    return tx;
  }

  update(id, data) {
    const index = this.transactions.findIndex(t => t.id === id);
    if (index === -1) return null;
    this.transactions[index] = { id, ...data };
    this.persist();
    return this.transactions[index];
  }

  remove(id) {
    const before = this.transactions.length;
    this.transactions = this.transactions.filter(t => t.id !== id);
    this.persist();
    return this.transactions.length < before;
  }

  getById(id) {
    return this.transactions.find(t => t.id === id) || null;
  }

  /** Filtra por mes (YYYY-MM), tipo, categoría y texto. Ordena por fecha descendente. */
  query({ month = '', type = '', category = '', text = '' } = {}) {
    const needle = Utils.normalize(text.trim());
    return this.transactions
      .filter(t => (!month || t.date.startsWith(month)))
      .filter(t => (!type || t.type === type))
      .filter(t => (!category || t.category === category))
      .filter(t => !needle || Utils.normalize(`${t.description} ${t.category}`).includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
  }

  /* ---------- Presupuestos ---------- */

  setBudget(category, value) {
    if (!EXPENSE_CATEGORIES.includes(category)) return;
    const limit = Number(value);
    if (Number.isFinite(limit) && limit > 0) this.budgets[category] = Utils.round2(limit);
    else delete this.budgets[category];
    this.persist();
  }

  /* ---------- Operaciones masivas ---------- */

  replaceAll(transactions, budgets) {
    this.transactions = LedgerStore.sanitizeTransactions(transactions);
    this.budgets = LedgerStore.sanitizeBudgets(budgets);
    this.persist();
  }

  clear() {
    this.replaceAll([], {});
  }

  /* ---------- Exportación ---------- */

  toCSV() {
    const header = ['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Monto'];
    const rows = [...this.transactions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(t => [t.date, t.type, t.category, t.description, t.amount.toFixed(2)].map(Utils.csvCell).join(','));
    return [header.join(','), ...rows].join('\r\n');
  }

  toJSON() {
    return JSON.stringify({
      app: 'FinanCore',
      version: 1,
      exportedAt: new Date().toISOString(),
      budgets: this.budgets,
      transactions: this.transactions
    }, null, 2);
  }
}

/* ======================= 3. FINANCIAL HEALTH ENGINE ======================= */

class FinancialHealthEngine {
  /** Totales de ingresos, gastos y balance neto. */
  static summarize(transactions) {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (t.type === TYPES.INCOME) income += t.amount;
      else expense += t.amount;
    }
    income = Utils.round2(income);
    expense = Utils.round2(expense);
    return { income, expense, balance: Utils.round2(income - expense), count: transactions.length };
  }

  /** Tasa de Ahorro Neto = ((Ingresos - Gastos) / Ingresos) * 100. Si Ingresos == 0 devuelve 0. */
  static savingsRate(income, expense) {
    if (!(income > 0)) return 0;
    return ((income - expense) / income) * 100;
  }

  static spendingByCategory(transactions) {
    const totals = {};
    for (const t of transactions) {
      if (t.type !== TYPES.EXPENSE) continue;
      totals[t.category] = Utils.round2((totals[t.category] || 0) + t.amount);
    }
    return totals;
  }

  /** Estado de cada categoría activa (con tope definido): ok / warn / over. */
  static budgetStatuses(spending, budgets) {
    const { WARN_THRESHOLD, OVER_THRESHOLD } = HEALTH_CONFIG;
    return EXPENSE_CATEGORIES
      .filter(category => budgets[category] > 0)
      .map(category => {
        const limit = budgets[category];
        const spent = spending[category] || 0;
        const pct = (spent / limit) * 100;
        const status = pct >= OVER_THRESHOLD ? 'over' : pct >= WARN_THRESHOLD ? 'warn' : 'ok';
        return { category, limit, spent, pct, status };
      });
  }

  /** % de categorías activas dentro de su límite (< 100 %). null si no hay presupuestos. */
  static complianceIndex(statuses) {
    if (!statuses.length) return null;
    const within = statuses.filter(s => s.status !== 'over').length;
    return (within / statuses.length) * 100;
  }

  static levelFor(total) {
    if (total >= 85) return { key: 'excellent', label: 'Excelente' };
    if (total >= 65) return { key: 'healthy', label: 'Saludable' };
    if (total >= 40) return { key: 'caution', label: 'Precaución' };
    return { key: 'critical', label: 'Crítico' };
  }

  /** Puntaje global 0–100: ahorro (hasta 60) + disciplina presupuestaria (hasta 40). */
  static evaluate({ summary, statuses }) {
    if (summary.count === 0) return null;
    const { SAVINGS_TARGET_PCT, MAX_SAVINGS_POINTS, MAX_DISCIPLINE_POINTS } = HEALTH_CONFIG;

    const rate = FinancialHealthEngine.savingsRate(summary.income, summary.expense);
    const compliance = FinancialHealthEngine.complianceIndex(statuses);

    const savingsPoints = Utils.clamp(rate / SAVINGS_TARGET_PCT, 0, 1) * MAX_SAVINGS_POINTS;
    const disciplinePoints = compliance === null ? 0 : (compliance / 100) * MAX_DISCIPLINE_POINTS;
    const total = Utils.clamp(Math.round(savingsPoints + disciplinePoints), 0, 100);
    const level = FinancialHealthEngine.levelFor(total);
    const overCategories = statuses.filter(s => s.status === 'over').map(s => s.category);

    return {
      rate,
      compliance,
      savingsPoints,
      disciplinePoints,
      total,
      level,
      overCategories,
      recommendation: FinancialHealthEngine.recommend(level, { summary, rate, compliance, overCategories })
    };
  }

  static recommend(level, { summary, rate, compliance, overCategories }) {
    const base = {
      excellent: 'Excelente manejo: ahorras con holgura y respetas tus topes. Considera reforzar tu fondo de emergencia o empezar a invertir.',
      healthy: 'Vas por buen camino. Afina los últimos detalles para acercarte a ahorrar al menos el 20 % de tus ingresos.',
      caution: 'Tu situación requiere atención. Recorta gastos discrecionales (por ejemplo Ocio) y fija una meta de ahorro mensual.',
      critical: 'Alerta: tus finanzas están en riesgo. Prioriza lo esencial, reduce gastos variables y define un ahorro mínimo cuanto antes.'
    }[level.key];

    const notes = [base];
    if (summary.income === 0) {
      notes.push('No hay ingresos registrados en este periodo: añádelos para medir tu capacidad real de ahorro.');
    } else if (rate < 0) {
      notes.push(`Gastaste ${Utils.formatMoney(-summary.balance)} más de lo que ingresaste.`);
    } else if (rate < HEALTH_CONFIG.SAVINGS_TARGET_PCT) {
      notes.push(`Tu tasa de ahorro (${rate.toFixed(1)} %) está por debajo de la meta del ${HEALTH_CONFIG.SAVINGS_TARGET_PCT} %.`);
    }
    if (overCategories.length) {
      notes.push(`Revisa ${overCategories.join(', ')}: ${overCategories.length === 1 ? 'superó su límite' : 'superaron sus límites'}.`);
    }
    if (compliance === null) {
      notes.push('Define presupuestos por categoría para activar la medición de disciplina (hasta 40 pts).');
    }
    return notes.join(' ');
  }
}

/* ======================= 4. FINANCE CHARTS (canvas) ======================= */

class FinanceCharts {
  constructor(barsCanvas, donutCanvas) {
    this.barsCanvas = barsCanvas;
    this.donutCanvas = donutCanvas;
  }

  static theme() {
    const styles = getComputedStyle(document.documentElement);
    const read = name => styles.getPropertyValue(name).trim();
    return {
      text: read('--text'),
      muted: read('--muted'),
      grid: read('--border'),
      green: read('--green'),
      red: read('--red'),
      yellow: read('--yellow'),
      accent: read('--accent')
    };
  }

  static compact(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
    return `${sign}$${Math.round(abs)}`;
  }

  /** Ajusta el canvas a su tamaño CSS y a la densidad de píxeles del dispositivo. */
  prepare(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 200);
    const h = Math.max(rect.height, 200);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  drawEmpty(ctx, w, h, message, theme) {
    ctx.fillStyle = theme.muted;
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, w / 2, h / 2);
  }

  drawBars({ income, expense, balance }) {
    const theme = FinanceCharts.theme();
    const { ctx, w, h } = this.prepare(this.barsCanvas);
    const values = [income, expense, balance];
    if (values.every(v => v === 0)) return this.drawEmpty(ctx, w, h, 'Sin datos en este periodo', theme);

    const pad = { l: 58, r: 16, t: 28, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    let max = Math.max(...values, 0);
    let min = Math.min(...values, 0);
    const span = (max - min) || 1;
    max += span * 0.08;
    if (min < 0) min -= span * 0.08;
    const y = v => pad.t + ((max - v) / (max - min)) * plotH;

    // Rejilla y etiquetas del eje Y
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const value = min + ((max - min) * i) / 4;
      const yy = y(value);
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(FinanceCharts.compact(value), pad.l - 8, yy);
    }

    // Línea de cero
    ctx.strokeStyle = theme.muted;
    ctx.beginPath();
    ctx.moveTo(pad.l, y(0));
    ctx.lineTo(w - pad.r, y(0));
    ctx.stroke();

    // Barras
    const labels = ['Ingresos', 'Gastos', 'Balance neto'];
    const colors = [theme.green, theme.red, balance >= 0 ? theme.accent : theme.yellow];
    const slot = plotW / 3;
    const barW = Math.min(slot * 0.5, 90);

    values.forEach((value, i) => {
      const x = pad.l + slot * i + (slot - barW) / 2;
      const y0 = y(0);
      const yv = y(value);
      const top = Math.min(y0, yv);
      const height = Math.max(Math.abs(yv - y0), 1);

      ctx.fillStyle = colors[i];
      ctx.fillRect(x, top, barW, height);

      ctx.fillStyle = theme.text;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (value >= 0) {
        ctx.textBaseline = 'bottom';
        ctx.fillText(Utils.formatMoney(value), x + barW / 2, top - 6);
      } else {
        ctx.textBaseline = 'top';
        ctx.fillText(Utils.formatMoney(value), x + barW / 2, top + height + 6);
      }

      ctx.fillStyle = theme.muted;
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(labels[i], x + barW / 2, h - 12);
    });
  }

  drawDonut(spending) {
    const theme = FinanceCharts.theme();
    const { ctx, w, h } = this.prepare(this.donutCanvas);
    const entries = Object.entries(spending).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    if (!total) return this.drawEmpty(ctx, w, h, 'Sin gastos en este periodo', theme);

    const narrow = w < 480;
    let cx, cy, radius, legendX, legendY, rowH;
    if (narrow) {
      radius = Math.min(w / 2 - 24, 70);
      cx = w / 2;
      cy = radius + 16;
      legendX = 16;
      legendY = cy + radius + 22;
      rowH = 18;
    } else {
      radius = Math.min(h / 2 - 20, w * 0.28);
      cx = radius + 24;
      cy = h / 2;
      legendX = cx + radius + 32;
      rowH = 24;
      legendY = Math.max(16, h / 2 - (entries.length * rowH) / 2);
    }

    // Anillo: cada porción es un arco con trazo grueso
    const thickness = radius * 0.42;
    const arcRadius = radius - thickness / 2;
    let angle = -Math.PI / 2;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'butt';
    entries.forEach(([category, value]) => {
      const sweep = (value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.strokeStyle = CATEGORY_COLORS[category] || theme.accent;
      ctx.arc(cx, cy, arcRadius, angle, angle + sweep);
      ctx.stroke();
      angle += sweep;
    });

    // Texto central
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('Gastos', cx, cy - 10);
    ctx.fillStyle = theme.text;
    ctx.font = `bold ${narrow ? 12 : 14}px system-ui, sans-serif`;
    ctx.fillText(Utils.formatMoney(total), cx, cy + 10);

    // Leyenda etiquetada
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    entries.forEach(([category, value], i) => {
      const yy = legendY + i * rowH;
      const pct = (value / total) * 100;
      ctx.fillStyle = CATEGORY_COLORS[category] || theme.accent;
      ctx.fillRect(legendX, yy - 5, 11, 11);
      ctx.fillStyle = theme.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${category} · ${pct.toFixed(1)} % (${Utils.formatMoney(value)})`, legendX + 18, yy + 1);
    });
  }
}

/* ======================= 5. DATOS DEMO ======================= */

const DemoData = {
  budgets: {
    'Alimentación': 2000,
    'Transporte': 1000,
    'Vivienda/Servicios': 4000,
    'Educación': 1200,
    'Ocio': 1500,       // se excede a propósito: gasto demo = 1,950
    'Salud': 1200,
    'Ahorro': 2500
  },

  // [día, tipo, categoría, descripción, monto] — 3 ingresos + 15 gastos
  rows: [
    [1, TYPES.INCOME, INCOME_CATEGORY, 'Beca mensual', 4000],
    [5, TYPES.INCOME, INCOME_CATEGORY, 'Salario proyecto freelance', 6500],
    [20, TYPES.INCOME, INCOME_CATEGORY, 'Ingreso extra por venta', 1500],

    [2, TYPES.EXPENSE, 'Alimentación', 'Despensa semanal', 850],
    [9, TYPES.EXPENSE, 'Alimentación', 'Comida en la facultad', 420],
    [16, TYPES.EXPENSE, 'Alimentación', 'Cena con tacos', 380],

    [3, TYPES.EXPENSE, 'Transporte', 'Recarga de tarjeta de transporte', 500],
    [18, TYPES.EXPENSE, 'Transporte', 'Viaje en app de transporte', 220],

    [1, TYPES.EXPENSE, 'Vivienda/Servicios', 'Renta del cuarto', 3200],
    [10, TYPES.EXPENSE, 'Vivienda/Servicios', 'Luz e internet', 650],

    [6, TYPES.EXPENSE, 'Educación', 'Copias y libros', 600],
    [14, TYPES.EXPENSE, 'Educación', 'Curso en línea', 450],

    [8, TYPES.EXPENSE, 'Ocio', 'Cine y snacks', 350],
    [15, TYPES.EXPENSE, 'Ocio', 'Videojuego nuevo', 900],
    [22, TYPES.EXPENSE, 'Ocio', 'Salida con amigos', 700],

    [12, TYPES.EXPENSE, 'Salud', 'Consulta médica', 500],
    [13, TYPES.EXPENSE, 'Salud', 'Medicamentos', 250],

    [25, TYPES.EXPENSE, 'Ahorro', 'Aportación al fondo de ahorro', 1500]
  ],

  build(month) {
    const transactions = this.rows.map(([day, type, category, description, amount]) => ({
      date: `${month}-${Utils.pad(day)}`, type, category, description, amount
    }));
    return { transactions, budgets: { ...this.budgets } };
  }
};

/* ======================= 6. UI CONTROLLER ======================= */

class UIController {
  constructor(store, charts) {
    this.store = store;
    this.charts = charts;
    this.filters = UIController.defaultFilters();
    this.editingId = null;
    this.lastChartData = null;
    this.statusTimer = null;
    this.dom = this.cacheDom();
  }

  static defaultFilters() {
    return { month: Utils.currentMonth(), type: '', category: '', text: '' };
  }

  cacheDom() {
    const $ = id => document.getElementById(id);
    return {
      status: $('status'),
      btnDemo: $('btn-demo'), btnCsv: $('btn-csv'), btnJson: $('btn-json'), btnClear: $('btn-clear'),
      periodLabel: $('period-label'),
      scoreNumber: $('score-number'), scoreLevel: $('score-level'), scoreFill: $('score-fill'), scoreReco: $('score-reco'),
      mIncome: $('m-income'), mExpense: $('m-expense'), mBalance: $('m-balance'),
      mRate: $('m-rate'), mCompliance: $('m-compliance'), mPoints: $('m-points'),
      budgetInputs: $('budget-inputs'), budgetList: $('budget-list'),
      form: $('tx-form'), formTitle: $('form-title'), formErrors: $('form-errors'),
      fDate: $('f-date'), fType: $('f-type'), fCategory: $('f-category'), fDesc: $('f-desc'), fAmount: $('f-amount'),
      btnSubmit: $('btn-submit'), btnCancel: $('btn-cancel'),
      flMonth: $('fl-month'), flType: $('fl-type'), flCategory: $('fl-category'), flText: $('fl-text'),
      btnAllMonths: $('btn-all-months'), btnResetFilters: $('btn-reset-filters'),
      txBody: $('tx-body'), txFooter: $('tx-footer')
    };
  }

  init() {
    this.fillSelect(this.dom.flCategory, ALL_CATEGORIES, 'Todas');
    this.buildBudgetInputs();
    this.resetForm();
    this.syncFilterControls();
    this.syncBudgetInputs();
    this.bindEvents();
    this.render();
  }

  /* ---------- Utilidades de UI ---------- */

  fillSelect(select, options, allLabel = null) {
    select.replaceChildren();
    if (allLabel !== null) select.append(h('option', { value: '', text: allLabel }));
    options.forEach(opt => select.append(h('option', { value: opt, text: opt })));
  }

  notify(message, isError = false) {
    const el = this.dom.status;
    el.textContent = message;
    el.classList.toggle('error', isError);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => { el.textContent = ''; }, 4500);
  }

  download(filename, content, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- Eventos ---------- */

  bindEvents() {
    const d = this.dom;

    d.btnDemo.addEventListener('click', () => this.loadDemo());
    d.btnCsv.addEventListener('click', () => this.exportCSV());
    d.btnJson.addEventListener('click', () => this.exportJSON());
    d.btnClear.addEventListener('click', () => this.clearAll());

    d.form.addEventListener('submit', e => this.onSubmit(e));
    d.fType.addEventListener('change', () => this.refreshFormCategories());
    d.btnCancel.addEventListener('click', () => this.resetForm());

    d.txBody.addEventListener('click', e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit') this.startEdit(btn.dataset.id);
      if (btn.dataset.action === 'delete') this.onDelete(btn.dataset.id);
    });

    [d.flMonth, d.flType, d.flCategory].forEach(el => el.addEventListener('change', () => this.onFilterChange()));
    d.flText.addEventListener('input', () => this.onFilterChange());

    d.btnAllMonths.addEventListener('click', () => {
      this.filters.month = '';
      this.syncFilterControls();
      this.render();
    });
    d.btnResetFilters.addEventListener('click', () => {
      this.filters = UIController.defaultFilters();
      this.syncFilterControls();
      this.render();
    });

    d.budgetInputs.addEventListener('change', e => {
      const input = e.target.closest('input[data-category]');
      if (!input) return;
      this.store.setBudget(input.dataset.category, input.value);
      input.value = this.store.budgets[input.dataset.category] ?? '';
      this.renderDashboard();
    });

    window.addEventListener('resize', Utils.debounce(() => this.redrawCharts(), 150));
  }

  onFilterChange() {
    const d = this.dom;
    this.filters = { month: d.flMonth.value, type: d.flType.value, category: d.flCategory.value, text: d.flText.value };
    this.render();
  }

  syncFilterControls() {
    const d = this.dom;
    d.flMonth.value = this.filters.month;
    d.flType.value = this.filters.type;
    d.flCategory.value = this.filters.category;
    d.flText.value = this.filters.text;
  }

  /* ---------- Formulario CRUD ---------- */

  refreshFormCategories(selected = null) {
    const options = LedgerStore.categoriesFor(this.dom.fType.value);
    this.fillSelect(this.dom.fCategory, options);
    if (selected && options.includes(selected)) this.dom.fCategory.value = selected;
  }

  resetForm() {
    const d = this.dom;
    this.editingId = null;
    d.form.reset();
    d.fDate.value = Utils.todayISO();
    d.fType.value = TYPES.EXPENSE;
    this.refreshFormCategories();
    d.formTitle.textContent = 'Nuevo movimiento';
    d.btnSubmit.textContent = 'Registrar movimiento';
    d.btnCancel.hidden = true;
    d.formErrors.textContent = '';
  }

  onSubmit(event) {
    event.preventDefault();
    const d = this.dom;
    const result = LedgerStore.validate({
      date: d.fDate.value,
      type: d.fType.value,
      category: d.fCategory.value,
      description: d.fDesc.value,
      amount: d.fAmount.value
    });

    if (!result.ok) {
      d.formErrors.textContent = result.errors.join(' ');
      return;
    }

    if (this.editingId) {
      this.store.update(this.editingId, result.clean);
      this.notify('Movimiento actualizado.');
    } else {
      this.store.add(result.clean);
      this.notify('Movimiento registrado.');
    }

    // Si el movimiento cae en otro mes, se mueve el filtro para que sea visible.
    const month = result.clean.date.slice(0, 7);
    if (this.filters.month && this.filters.month !== month) {
      this.filters.month = month;
      this.syncFilterControls();
    }

    this.resetForm();
    this.render();
  }

  startEdit(id) {
    const tx = this.store.getById(id);
    if (!tx) return;
    const d = this.dom;
    this.editingId = id;
    d.fDate.value = tx.date;
    d.fType.value = tx.type;
    this.refreshFormCategories(tx.category);
    d.fDesc.value = tx.description;
    d.fAmount.value = tx.amount;
    d.formTitle.textContent = 'Editar movimiento';
    d.btnSubmit.textContent = 'Guardar cambios';
    d.btnCancel.hidden = false;
    d.formErrors.textContent = '';
    d.form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    d.fDesc.focus();
  }

  onDelete(id) {
    const tx = this.store.getById(id);
    if (!tx) return;
    if (!window.confirm(`¿Eliminar "${tx.description}" por ${Utils.formatMoney(tx.amount)}?`)) return;
    this.store.remove(id);
    if (this.editingId === id) this.resetForm();
    this.notify('Movimiento eliminado.');
    this.render();
  }

  /* ---------- Acciones globales ---------- */

  loadDemo() {
    if (this.store.transactions.length &&
        !window.confirm('Se reemplazarán tus datos actuales por el mes demo. ¿Continuar?')) return;
    const month = Utils.currentMonth();
    const { transactions, budgets } = DemoData.build(month);
    this.store.replaceAll(transactions, budgets);
    this.filters = { month, type: '', category: '', text: '' };
    this.syncFilterControls();
    this.syncBudgetInputs();
    this.resetForm();
    this.render();
    this.notify('Mes demo cargado: 18 movimientos (3 ingresos y 15 gastos).');
  }

  clearAll() {
    if (!window.confirm('Se borrarán todos los movimientos y presupuestos. ¿Continuar?')) return;
    this.store.clear();
    this.syncBudgetInputs();
    this.resetForm();
    this.render();
    this.notify('Datos borrados.');
  }

  exportCSV() {
    if (!this.store.transactions.length) return this.notify('No hay movimientos para exportar.', true);
    // BOM UTF-8 para que Excel muestre bien los acentos
    this.download(`financore-movimientos-${Utils.todayISO()}.csv`, `\uFEFF${this.store.toCSV()}`, 'text/csv');
    this.notify('CSV exportado.');
  }

  exportJSON() {
    this.download(`financore-respaldo-${Utils.todayISO()}.json`, this.store.toJSON(), 'application/json');
    this.notify('JSON exportado.');
  }

  /* ---------- Presupuestos (entradas) ---------- */

  buildBudgetInputs() {
    const box = this.dom.budgetInputs;
    box.replaceChildren();
    EXPENSE_CATEGORIES.forEach(category => {
      const input = h('input', {
        type: 'number', min: '0', step: '50', placeholder: 'Sin límite', inputMode: 'decimal',
        'data-category': category, 'aria-label': `Tope mensual de ${category}`
      });
      box.append(h('label', { class: 'budget-field' }, category, input));
    });
  }

  syncBudgetInputs() {
    this.dom.budgetInputs.querySelectorAll('input[data-category]').forEach(input => {
      input.value = this.store.budgets[input.dataset.category] ?? '';
    });
  }

  /* ---------- Renderizado ---------- */

  render() {
    this.renderTable();
    this.renderDashboard();
  }

  renderTable() {
    const rows = this.store.query(this.filters);
    const body = this.dom.txBody;
    body.replaceChildren();

    if (!rows.length) {
      body.append(h('tr', {}, h('td', { colSpan: 6, class: 'empty', text: 'No hay movimientos con los filtros actuales.' })));
    }

    rows.forEach(t => {
      const isIncome = t.type === TYPES.INCOME;
      body.append(h('tr', {},
        h('td', { text: Utils.formatDate(t.date) }),
        h('td', {}, h('span', { class: `tag ${isIncome ? 'tag-income' : 'tag-expense'}`, text: t.type })),
        h('td', { text: t.category }),
        h('td', { text: t.description }),
        h('td', { class: `num ${isIncome ? 'pos' : 'neg'}`, text: `${isIncome ? '+' : '−'}${Utils.formatMoney(t.amount)}` }),
        h('td', { class: 'num' },
          h('button', { class: 'btn btn-sm', type: 'button', text: 'Editar', 'data-action': 'edit', 'data-id': t.id }),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Eliminar', 'data-action': 'delete', 'data-id': t.id })
        )
      ));
    });

    const net = FinancialHealthEngine.summarize(rows);
    this.dom.txFooter.textContent =
      `${rows.length} movimiento(s) mostrados · Neto de la selección: ${Utils.formatMoney(net.balance)} ` +
      `(ingresos ${Utils.formatMoney(net.income)} − gastos ${Utils.formatMoney(net.expense)})`;
  }

  renderDashboard() {
    const d = this.dom;
    // El dashboard analiza el mes del filtro; si el filtro está en "todos los meses", usa el mes actual.
    const period = this.filters.month || Utils.currentMonth();
    const txs = this.store.query({ month: period });
    const summary = FinancialHealthEngine.summarize(txs);
    const spending = FinancialHealthEngine.spendingByCategory(txs);
    const statuses = FinancialHealthEngine.budgetStatuses(spending, this.store.budgets);
    const health = FinancialHealthEngine.evaluate({ summary, statuses });

    d.periodLabel.textContent = `· ${Utils.formatMonth(period)}`;
    d.mIncome.textContent = Utils.formatMoney(summary.income);
    d.mExpense.textContent = Utils.formatMoney(summary.expense);
    d.mBalance.textContent = Utils.formatMoney(summary.balance);
    d.mBalance.className = `metric-value ${summary.balance >= 0 ? 'pos' : 'neg'}`;

    if (health) {
      d.mRate.textContent = summary.income > 0 ? `${health.rate.toFixed(2)} %` : '0.00 % (sin ingresos)';
      d.mRate.className = `metric-value ${health.rate >= 0 ? 'pos' : 'neg'}`;
      d.mCompliance.textContent = health.compliance === null
        ? 'Sin presupuestos'
        : `${health.compliance.toFixed(2)} % (${statuses.filter(s => s.status !== 'over').length}/${statuses.length})`;
      d.mPoints.textContent =
        `Ahorro ${health.savingsPoints.toFixed(2)}/${HEALTH_CONFIG.MAX_SAVINGS_POINTS} · ` +
        `Disciplina ${health.disciplinePoints.toFixed(2)}/${HEALTH_CONFIG.MAX_DISCIPLINE_POINTS}`;
      d.scoreNumber.textContent = String(health.total);
      d.scoreLevel.textContent = health.level.label;
      d.scoreLevel.className = `badge level-${health.level.key}`;
      d.scoreFill.className = `score-fill level-${health.level.key}`;
      d.scoreFill.style.width = `${health.total}%`;
      d.scoreReco.textContent = health.recommendation;
    } else {
      d.mRate.textContent = '—';
      d.mRate.className = 'metric-value';
      d.mCompliance.textContent = statuses.length ? '—' : 'Sin presupuestos';
      d.mPoints.textContent = '—';
      d.scoreNumber.textContent = '—';
      d.scoreLevel.textContent = 'Sin datos';
      d.scoreLevel.className = 'badge level-none';
      d.scoreFill.className = 'score-fill';
      d.scoreFill.style.width = '0%';
      d.scoreReco.textContent = 'Sin movimientos en este periodo. Registra uno o carga el mes demo para ver tu diagnóstico.';
    }

    this.renderBudgets(statuses);
    this.lastChartData = { summary, spending };
    this.redrawCharts();
  }

  renderBudgets(statuses) {
    const list = this.dom.budgetList;
    list.replaceChildren();

    if (!statuses.length) {
      list.append(h('p', { class: 'empty', text: 'Define un tope en alguna categoría para ver tus barras de progreso.' }));
      return;
    }

    statuses.forEach(s => {
      const fill = h('div', { class: `bar-fill ${s.status}` });
      fill.style.width = `${Math.min(s.pct, 100)}%`;

      let flag = null;
      if (s.status === 'over') flag = h('span', { class: 'alert', text: '⚠️ Presupuesto excedido' });
      else if (s.status === 'warn') flag = h('span', { class: 'hint', text: 'Cerca del límite' });

      list.append(h('div', { class: `budget-item ${s.status}` },
        h('div', { class: 'budget-head' },
          h('strong', { text: s.category }),
          h('span', { text: `${s.pct.toFixed(1)} %` })
        ),
        h('div', {
          class: 'bar', role: 'progressbar',
          'aria-label': `Avance del presupuesto de ${s.category}`,
          'aria-valuemin': '0', 'aria-valuemax': '100',
          'aria-valuenow': String(Math.min(Math.round(s.pct), 100))
        }, fill),
        h('div', { class: 'budget-meta' },
          h('span', { text: `Gastado ${Utils.formatMoney(s.spent)} de ${Utils.formatMoney(s.limit)}` }),
          flag
        )
      ));
    });
  }

  redrawCharts() {
    if (!this.lastChartData) return;
    this.charts.drawBars(this.lastChartData.summary);
    this.charts.drawDonut(this.lastChartData.spending);
  }
}

/* ======================= 7. ARRANQUE ======================= */

document.addEventListener('DOMContentLoaded', () => {
  const store = new LedgerStore(Utils.getStorage());
  const charts = new FinanceCharts(
    document.getElementById('chart-bars'),
    document.getElementById('chart-donut')
  );
  new UIController(store, charts).init();
});
