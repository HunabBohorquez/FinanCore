# FinanCore — Dashboard Integral de Finanzas y Presupuestos

> **Enlaces del proyecto**

**Link:** `https://hunabbohorquez.github.io/FinanCore/`

**Repositorio en GitHub:** `https://github.com/HunabBohorquez/FinanCore`

> 📝 **Nota:** este proyecto tiene los **mismos archivos** que el repositorio de GitLab
> (`index.html`, `styles.css`, `app.js`, `README.md`). Solo cambia la plataforma de alojamiento.

---

## Descripción

**FinanCore** es una aplicación web de finanzas personales que funciona 100 % en el navegador, escrita únicamente con **HTML5, CSS3 y JavaScript ES6+ Vanilla** (sin frameworks ni librerías externas). Reúne en un solo tablero:

- **Libro mayor de transacciones** con alta, edición y eliminación de movimientos (fecha, tipo, categoría, descripción y monto) y filtros en tiempo real por mes (`YYYY-MM`), tipo, categoría y búsqueda por texto (sin distinguir acentos).
- **Presupuestos mensuales por categoría** con barras de progreso y semáforo automático: verde (< 75 %), amarillo (75 % – 99 %) y rojo con la alerta "⚠️ Presupuesto excedido" (≥ 100 %).
- **Motor de diagnóstico de salud financiera** con puntaje de 0 a 100, nivel y recomendación automática.
- **Dos gráficos nativos en `<canvas>`**: barras de Ingresos vs. Gastos vs. Balance neto, y dona con la distribución porcentual de gastos por categoría.
- **Persistencia en `localStorage`**, exportación a **CSV** y **JSON**, y un botón **"Cargar Mes Demo (18 movimientos)"** para verificar todo rápidamente.

Categorías disponibles: Alimentación, Transporte, Vivienda/Servicios, Educación, Ocio, Salud, Ahorro (tipo *Gasto*) e Ingresos/Beca/Salario (tipo *Ingreso*). La categoría **Ahorro** se registra como gasto: el dinero apartado cuenta como salida del flujo y puede presupuestarse como cualquier otra categoría.

### Arquitectura de `app.js`

| Módulo | Responsabilidad |
|---|---|
| `LedgerStore` | Validación, CRUD, consultas con filtros, presupuestos, `localStorage` y exportación CSV/JSON. |
| `FinancialHealthEngine` | Totales, tasa de ahorro, estados del semáforo, índice de cumplimiento, puntaje, nivel y recomendación. |
| `FinanceCharts` | Dibujo de ambos gráficos en `<canvas>` con soporte de pantallas de alta densidad y redimensionado. |
| `UIController` | Eventos, formularios, filtros, renderizado seguro del DOM y acciones globales. |

## Métricas de salud financiera

El dashboard analiza el **mes seleccionado en el filtro** (si eliges "Todos los meses" en la tabla, el dashboard usa el mes actual).

1. **Tasa de Ahorro Neto**

   ```
   Tasa = ((Ingresos − Gastos) / Ingresos) × 100
   ```

   Si `Ingresos == 0` la tasa se considera **0 %** (no hay división entre cero).

2. **Índice de Cumplimiento Presupuestario**

   ```
   Índice = (categorías activas dentro de su límite / categorías activas) × 100
   ```

   Una categoría es *activa* si tiene un tope mayor que 0. Está *dentro de su límite* cuando gastó **menos del 100 %** de su tope. Si no hay presupuestos definidos, el índice no aplica y la disciplina aporta 0 puntos.

3. **Puntaje Global (0 – 100)**

   ```
   Puntos de ahorro     = min(max(Tasa / 20, 0), 1) × 60      → hasta 60 pts (20 % de ahorro = máximo)
   Puntos de disciplina = (Índice / 100) × 40                 → hasta 40 pts
   Puntaje              = redondeo(Puntos de ahorro + Puntos de disciplina)
   ```

   | Puntaje | Nivel |
   |---|---|
   | 85 – 100 | Excelente |
   | 65 – 84 | Saludable |
   | 40 – 64 | Precaución |
   | 0 – 39 | Crítico |

   La recomendación se genera según el nivel, la tasa de ahorro y las categorías excedidas.

## Instrucciones de ejecución

1. Descarga o copia los cuatro archivos en una misma carpeta: `index.html`, `styles.css`, `app.js` y `README.md`.
2. Abre `index.html` con doble clic en cualquier navegador moderno (Chrome, Edge, Firefox, Safari). No requiere servidor ni instalación.
3. Pulsa **"Cargar Mes Demo (18 movimientos)"** para ver el tablero con datos de ejemplo, o registra tus propios movimientos.
4. Tus datos se guardan en el `localStorage` del navegador. Usa **Exportar JSON** para respaldarlos y **Exportar CSV** para abrirlos en una hoja de cálculo.

## Pruebas Verificables

Al pulsar **"Cargar Mes Demo (18 movimientos)"** se cargan 3 ingresos, 15 gastos y 7 presupuestos en el **mes actual**. Los resultados deben ser exactamente estos:

| Indicador | Valor esperado |
|---|---|
| Movimientos cargados | 18 (3 ingresos + 15 gastos) |
| **Ingresos totales** | **$12,000.00** |
| **Gastos totales** | **$11,470.00** |
| **Balance neto** | **$530.00** |
| Tasa de ahorro neto | 4.42 % |
| Cumplimiento presupuestario | 85.71 % (6 de 7 categorías) |
| **Categoría excedida** | **Ocio: $1,950.00 de $1,500.00 (130.0 %) → "⚠️ Presupuesto excedido"** |
| Puntos de ahorro | 13.25 / 60 |
| Puntos de disciplina | 34.29 / 40 |
| **Puntaje de salud financiera** | **48 / 100 → nivel "Precaución"** |

Detalle por categoría:

| Categoría | Gastado | Límite | Avance | Semáforo | % del gasto total |
|---|---|---|---|---|---|
| Alimentación | $1,650.00 | $2,000.00 | 82.5 % | Amarillo | 14.4 % |
| Transporte | $720.00 | $1,000.00 | 72.0 % | Verde | 6.3 % |
| Vivienda/Servicios | $3,850.00 | $4,000.00 | 96.3 % | Amarillo | 33.6 % |
| Educación | $1,050.00 | $1,200.00 | 87.5 % | Amarillo | 9.2 % |
| Ocio | $1,950.00 | $1,500.00 | 130.0 % | **Rojo (excedido)** | 17.0 % |
| Salud | $750.00 | $1,200.00 | 62.5 % | Verde | 6.5 % |
| Ahorro | $1,500.00 | $2,500.00 | 60.0 % | Verde | 13.1 % |

Otras comprobaciones sugeridas:

- Edita un movimiento de Ocio reduciéndolo (por ejemplo, el videojuego de $900 a $500): Ocio baja a 90 % (amarillo), el cumplimiento sube a 100 % y el puntaje cambia a 53.
- Borra todos los datos con **Borrar todo**: el tablero muestra "Sin datos" y los gráficos indican que no hay información.
- Registra solo un gasto sin ingresos: la tasa de ahorro se muestra como 0 % sin errores de división entre cero.
- Filtra por mes, tipo, categoría y texto: la tabla se actualiza al instante.

## Notas

- Los montos se muestran en pesos mexicanos (formato `es-MX`).
- Los presupuestos son topes mensuales que se aplican a cada mes consultado.
- La exportación CSV incluye todos los movimientos (no solo los filtrados) y usa UTF-8 con BOM para conservar acentos en Excel.
