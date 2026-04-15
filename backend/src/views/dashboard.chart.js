/**
 * Monthly P&L trend chart for the Closings section.
 * Renders a 12-month bar chart of sale volume + net profit using Chart.js.
 */
(function(){
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    injectChartCanvas();
    // Render after the first daily-brief load + on every subsequent reload
    const origLoad = window.load;
    if (typeof origLoad === 'function') {
      window.load = async function() {
        await origLoad.apply(this, arguments);
        renderPnlChart();
      };
    } else {
      setTimeout(renderPnlChart, 1200);
    }
  });

  function injectChartCanvas() {
    const kpis = document.getElementById('pnl-kpis');
    if (!kpis) return;
    if (document.getElementById('pnl-chart-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'pnl-chart-wrap';
    wrap.style.marginTop = '1rem';
    wrap.style.marginBottom = '1rem';
    wrap.style.padding = '1rem';
    wrap.style.background = '#fafafa';
    wrap.style.border = '1px solid var(--border)';
    wrap.style.borderRadius = '10px';
    wrap.innerHTML = `
      <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.5rem">
        12-Month P&amp;L Trend
      </div>
      <div style="position:relative;height:220px">
        <canvas id="pnl-chart"></canvas>
      </div>
    `;
    kpis.parentNode.insertBefore(wrap, kpis.nextSibling);
  }

  let chartInstance = null;

  async function renderPnlChart() {
    if (typeof Chart === 'undefined') {
      // Lazy-load Chart.js only when the user actually views the dashboard
      try { await loadChartJs(); }
      catch (e) { return; }
    }
    const canvas = document.getElementById('pnl-chart');
    if (!canvas) return;
    try {
      const year = new Date().getFullYear();
      const data = await window.DB.api('/api/closings/pnl?year=' + year);
      const months = Array.from({length: 12}, (_, i) => {
        const key = `${year}-${String(i+1).padStart(2,'0')}`;
        const row = (data.monthly || []).find(m => m.month === key);
        return {
          label: new Date(year, i, 1).toLocaleString('en-CA', { month: 'short' }),
          volume: row ? Number(row.sale_volume) || 0 : 0,
          net: row ? Number(row.net_profit) || 0 : 0
        };
      });
      const ctx = canvas.getContext('2d');
      const config = {
        type: 'bar',
        data: {
          labels: months.map(m => m.label),
          datasets: [
            {
              label: 'Sale Volume',
              data: months.map(m => m.volume),
              backgroundColor: 'rgba(201, 169, 110, 0.6)',
              borderColor: 'rgba(201, 169, 110, 1)',
              borderWidth: 1,
              yAxisID: 'y'
            },
            {
              label: 'Net Profit',
              data: months.map(m => m.net),
              backgroundColor: 'rgba(16, 185, 129, 0.7)',
              borderColor: 'rgba(16, 185, 129, 1)',
              borderWidth: 1,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}`
              }
            }
          },
          scales: {
            y:  { type: 'linear', position: 'left',  ticks: { callback: (v) => fmtShort(v), font: { size: 10 } } },
            y1: { type: 'linear', position: 'right', ticks: { callback: (v) => fmtShort(v), font: { size: 10 } }, grid: { drawOnChartArea: false } }
          }
        }
      };
      if (chartInstance) chartInstance.destroy();
      chartInstance = new Chart(ctx, config);
    } catch (e) {
      console.warn('pnl chart:', e.message);
    }
  }

  function loadChartJs() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function fmtMoney(n) {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
  }
  function fmtShort(n) {
    if (Math.abs(n) >= 1000000) return '$' + (n/1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1000) return '$' + Math.round(n/1000) + 'k';
    return '$' + n;
  }
})();
