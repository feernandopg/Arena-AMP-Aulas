'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Data local YYYY-MM-DD (não usar toISOString — é UTC e vira o dia seguinte à noite)
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let toastT;
function toast(msg, type = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', 2600);
}
async function apiPOST(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || 'Erro ao gerar relatório.');
  return d;
}

// ── navegação entre relatórios ──
$$('.nav button').forEach(b => b.addEventListener('click', () => {
  $$('.nav button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.page').forEach(p => p.classList.add('hidden'));
  $('#view-' + b.dataset.view).classList.remove('hidden');
}));

// ── gráficos SVG (identidade QUADRA: navy + laranja) ──
const PAL = ['#FF7A1A', '#132539', '#1E7FB8', '#1F9E6E', '#C25B12', '#7A4FC0', '#8E9198'];

function donutChart(items, fmtVal, centerTop, centerBottom) {
  const data = (items || []).filter(x => (x.value || 0) > 0);
  const total = data.reduce((a, x) => a + x.value, 0);
  if (!total) return '<p class="muted" style="font-size:13px">Sem dados.</p>';
  // anel mais fino (furo maior) para o texto central respirar
  const R = 45, SW = 14;
  const C = 2 * Math.PI * R; let acc = 0;
  const segs = data.map((x, i) => {
    const f = x.value / total, dash = f * C, off = acc * C; acc += f;
    return `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${PAL[i % PAL.length]}" stroke-width="${SW}"
      stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"
      transform="rotate(-90 60 60)"/>`;
  }).join('');
  const leg = data.map((x, i) => `<div class="lg"><span class="sw" style="background:${PAL[i % PAL.length]}"></span>
    <span class="ln2">${esc(x.label)}</span><span class="lv">${fmtVal ? fmtVal(x.value) : x.value} · ${(x.value / total * 100).toFixed(0)}%</span></div>`).join('');
  // fonte central se adapta ao comprimento do texto (furo tem ~76 de largura útil)
  const cTop = String(centerTop != null ? centerTop : data.length);
  const fs = Math.max(9, Math.min(16, 66 / Math.max(1, cTop.length) * 1.7)).toFixed(1);
  return `<div class="donut"><svg viewBox="0 0 120 120">${segs}
    <text x="60" y="${centerBottom ? 59 : 64}" text-anchor="middle" class="dc1" style="font-size:${fs}px">${esc(cTop)}</text>
    ${centerBottom ? `<text x="60" y="73" text-anchor="middle" class="dc2">${esc(centerBottom)}</text>` : ''}</svg>
    <div class="legend">${leg}</div></div>`;
}

function areaChart(pts, fmtVal) {
  if (!pts || !pts.length) return '<p class="muted" style="font-size:13px">Sem dados.</p>';
  const W = 520, H = 172, L = 12, R = 12, T = 20, B = 26;
  const max = Math.max(...pts.map(p => p.value)) || 1;
  const iw = pts.length > 1 ? (W - L - R) / (pts.length - 1) : 0;
  const xy = pts.map((p, i) => [pts.length > 1 ? L + i * iw : W / 2, T + (H - T - B) * (1 - p.value / max)]);
  const line = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = pts.length > 1 ? `${line} L${(W - R)} ${H - B} L${L} ${H - B} Z` : '';
  const dots = xy.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" fill="#132539" stroke="#fff" stroke-width="1.6"/>`).join('');
  const step = Math.ceil(pts.length / 8);
  const labs = pts.map((p, i) => (i % step) ? '' :
    `<text x="${xy[i][0].toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(p.label)}</text>`).join('');
  const vals = pts.length <= 8 ? pts.map((p, i) =>
    `<text x="${xy[i][0].toFixed(1)}" y="${(xy[i][1] - 9).toFixed(1)}" text-anchor="middle" class="vx">${fmtVal ? fmtVal(p.value) : p.value}</text>`).join('') : '';
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">
    ${area ? `<path d="${area}" fill="rgba(255,122,26,.12)"/>` : ''}
    <path d="${line}" fill="none" stroke="#FF7A1A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labs}${vals}</svg></div>`;
}

function colChart(pts, fmtVal) {
  if (!pts || !pts.length) return '<p class="muted" style="font-size:13px">Sem dados.</p>';
  const W = 520, H = 172, T = 20, B = 26, P = 10;
  const max = Math.max(...pts.map(p => p.value)) || 1;
  const slot = (W - P * 2) / pts.length;
  const bw = Math.min(36, slot * 0.64);
  const step = Math.ceil(pts.length / 10);
  const bars = pts.map((p, i) => {
    const h = Math.max(2, (H - T - B) * (p.value / max));
    const x = P + i * slot + (slot - bw) / 2;
    const y = H - B - h;
    const destaque = p.value === max && max > 0;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4"
        fill="${destaque ? '#FF7A1A' : '#132539'}"/>` +
      ((i % step) ? '' : `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${esc(p.label)}</text>`) +
      (pts.length <= 10 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="vx">${fmtVal ? fmtVal(p.value) : p.value}</text>` : '');
  }).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${bars}</svg></div>`;
}

// ── blocos visuais compartilhados ──
const kpi = (l, v, s, cls = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const barRow = (label, val, max, valTxt) => `<div class="bar-row"><span class="muted">${esc(label)}</span>
  <div class="bar-track"><div class="bar-fill" style="width:${max > 0 ? (val / max * 100) : 0}%"></div></div><span>${valTxt}</span></div>`;
const rankRow = (i, nome, sub, val, valCls = '') => `<div class="rank-row">
  <div class="n"><span class="pos">${i}</span><div><div style="font-weight:600">${esc(nome)}</div>${sub ? `<div class="muted" style="font-size:11.5px">${sub}</div>` : ''}</div></div>
  <span style="font-weight:700" class="${valCls}">${val}</span></div>`;

// ══════════════════════════════ RELATÓRIO AULAS ══════════════════════════════
(function initAulas() {
  const hoje = localDate();
  const d = new Date(); d.setDate(d.getDate() - 29);
  $('#au-di').value = localDate(d);
  $('#au-df').value = hoje;
  $('#au-go').addEventListener('click', gerarAulas);
  gerarAulas();
})();

async function gerarAulas() {
  $('#au-result').innerHTML = `<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Gerando...</div>`;
  let d;
  try { d = await apiPOST('/api/relatorios/aulas', { data_inicio: $('#au-di').value, data_fim: $('#au-df').value }); }
  catch (e) { $('#au-result').innerHTML = `<div class="empty"><i class="fa-solid fa-circle-info"></i>${esc(e.message)}</div>`; return; }

  const mv = d.movimento || {};
  const maxTurma = Math.max(1, ...(d.turmas || []).map(t => t.capacidade));

  const listaPend = (arr, vazio) => arr.length
    ? arr.slice(0, 8).map((s, i) => rankRow(i + 1, s.nome, 'vence ' + (s.vencimento ? s.vencimento.split('-').reverse().join('/') : '—'), fmt(s.valor), 'low-txt')).join('')
    : `<p class="muted" style="font-size:13px">${vazio}</p>`;

  $('#au-result').innerHTML = `
    <div class="kpis">
      ${kpi('Alunos ativos', d.alunos_ativos, d.alunos_inativos + ' inativo(s)')}
      ${kpi('Receita mensal', fmt(d.receita_mensal_estimada), 'estimada (planos ativos)', 'ok-txt')}
      ${kpi('Ticket médio', fmt(d.ticket_medio), 'por aluno')}
      ${kpi('Ocupação', d.ocupacao_pct + '%', 'das vagas das turmas')}
      ${kpi('Presenças', mv.presencas, 'no período')}
      ${kpi('Pagamentos', mv.pagamentos, 'registrados no período')}
    </div>
    <div class="rel-grid">
      <div class="card"><div class="sec-title">Ocupação por turma</div><div class="bars">
        ${(d.turmas || []).map(t => barRow(t.turma, t.alunos, maxTurma, `${t.alunos}/${t.capacidade}`)).join('') || '<p class="muted" style="font-size:13px">Nenhuma turma cadastrada.</p>'}
      </div></div>
      <div class="card"><div class="sec-title">Alunos por plano</div>
        ${donutChart((d.planos || []).map(p => ({ label: p.plano, value: p.alunos })), v => v + ' aluno(s)',
          d.alunos_ativos, 'ativos')}
      </div>
      <div class="card"><div class="sec-title">Pagamentos vencidos</div><div class="rank">
        ${listaPend(d.vencidos || [], 'Ninguém vencido. 🎉')}</div></div>
      <div class="card"><div class="sec-title">Vencem nos próximos 7 dias</div><div class="rank">
        ${listaPend(d.vence_7d || [], 'Nada vencendo esta semana.')}</div></div>
      <div class="card"><div class="sec-title">Movimento do período</div><div class="rank">
        ${rankRow('✓', 'Presenças', '', mv.presencas)}
        ${rankRow('✗', 'Faltas', '', mv.faltas)}
        ${rankRow('↻', 'Reposições', '', mv.reposicoes)}
        ${rankRow('$', 'Pagamentos', '', mv.pagamentos)}
        ${rankRow('+', 'Ações no total', '', mv.total_acoes)}
      </div></div>
      <div class="card"><div class="sec-title">Atividade por dia</div>
        ${colChart((d.atividade_por_dia || []).slice(-14).map(x => ({ label: x.dia.slice(8) + '/' + x.dia.slice(5, 7), value: x.acoes })))}
      </div>
    </div>`;
}

// ═══════════════════════════ RELATÓRIO COMANDAS ═══════════════════════════════
let relModo = 'fechamento';
$$('#rel-modo button').forEach(b => b.onclick = () => {
  $$('#rel-modo button').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); relModo = b.dataset.modo; renderRelControls();
});
function renderRelControls() {
  const hoje = localDate();
  const c = $('#rel-controls');
  if (relModo === 'fechamento') {
    c.innerHTML = `<div class="field" style="margin:0"><label>Data</label><input class="inp" id="r-data" type="date" value="${hoje}"></div>
      <button class="btn btn-primary" id="r-go"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>`;
    $('#r-go').onclick = () => relFetch('/comandas/api/relatorios/fechamento-dia', { data: $('#r-data').value });
  } else if (relModo === 'gerencial') {
    c.innerHTML = `<div class="field" style="margin:0"><label>Início</label><input class="inp" id="r-di" type="date" value="${hoje}"></div>
      <div class="field" style="margin:0"><label>Fim</label><input class="inp" id="r-df" type="date" value="${hoje}"></div>
      <button class="btn btn-primary" id="r-go"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>`;
    $('#r-go').onclick = () => relFetch('/comandas/api/relatorios/gerencial', { data_inicio: $('#r-di').value, data_fim: $('#r-df').value });
  } else {
    const d = new Date();
    c.innerHTML = `<div class="field" style="margin:0"><label>Mês</label><select class="inp" id="r-mes">${
      ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
      .map((m, i) => `<option value="${i + 1}" ${i === d.getMonth() ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>Ano</label><input class="inp" id="r-ano" type="number" value="${d.getFullYear()}" style="width:100px"></div>
      <button class="btn btn-primary" id="r-go"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>`;
    $('#r-go').onclick = () => relFetch('/comandas/api/relatorios/mensal', { ano: +$('#r-ano').value, mes: +$('#r-mes').value });
  }
  $('#rel-result').innerHTML = '';
}
async function relFetch(path, body) {
  $('#rel-result').innerHTML = `<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Gerando...</div>`;
  try { renderRelatorio(await apiPOST(path, body)); }
  catch (e) { $('#rel-result').innerHTML = `<div class="empty"><i class="fa-solid fa-circle-info"></i>${esc(e.message)}</div>`; }
}
function renderRelatorio(d) {
  const HORAS = d.faturamento_por_hora || [];
  const comp = d.comparativo_mes_anterior;
  const compHtml = comp ? `<div class="card" style="margin-bottom:16px"><div class="sec-title">Comparativo com mês anterior</div>
    <div class="kpis" style="margin:0">
      ${kpi('Faturamento ant.', fmt(comp.faturamento_bruto), '')}
      ${kpi('Variação', (comp.variacao_faturamento >= 0 ? '+' : '') + comp.variacao_faturamento + '%', '', comp.variacao_faturamento >= 0 ? 'ok-txt' : '')}
      ${kpi('Lucro ant.', fmt(comp.lucro_bruto), '')}
      ${kpi('Ticket ant.', fmt(comp.ticket_medio), '')}
    </div></div>` : '';
  const rankList = (arr, valFn, subFn) => (arr || []).slice(0, 8).map((x, i) => rankRow(i + 1, x.nome, subFn ? subFn(x) : '', valFn(x))).join('') || '<p class="muted" style="font-size:13px">Sem dados.</p>';

  $('#rel-result').innerHTML = `
    <div class="kpis">
      ${kpi('Faturamento', fmt(d.faturamento_bruto), d.total_comandas + ' comandas')}
      ${kpi('Custo (CPV)', fmt(d.custo_total))}
      ${kpi('Lucro bruto', fmt(d.lucro_bruto), '', 'ok-txt')}
      ${kpi('Margem', d.margem_lucro.toFixed(1) + '%')}
      ${kpi('Ticket médio', fmt(d.ticket_medio))}
      ${d.hora_pico != null ? kpi('Hora pico', d.hora_pico + 'h') : ''}
    </div>
    ${compHtml}
    <div class="rel-grid">
      <div class="card"><div class="sec-title">Faturamento por dia</div>
        ${areaChart((d.faturamento_por_dia || []).map(x => ({ label: x.dia.slice(8) + '/' + x.dia.slice(5, 7), value: x.valor })), v => 'R$' + Math.round(v))}
      </div>
      <div class="card"><div class="sec-title">Formas de pagamento</div>
        ${donutChart((d.formas_pagamento || []).map(x => ({ label: x.forma, value: x.valor })), fmt,
          fmt(d.faturamento_bruto).replace('R$ ', 'R$'), 'recebido')}
      </div>
      <div class="card"><div class="sec-title">Mais vendidos</div><div class="rank">
        ${rankList(d.produtos_vendidos, x => x.quantidade + ' un.', x => 'Faturou ' + fmt(x.faturamento))}</div></div>
      <div class="card"><div class="sec-title">Mais lucrativos</div><div class="rank">
        ${rankList(d.ranking_lucrativos, x => fmt(x.lucro), x => x.quantidade + ' un. vendidas')}</div></div>
      <div class="card"><div class="sec-title">Melhores clientes</div><div class="rank">
        ${rankList(d.clientes_ranking, x => fmt(x.total_gasto), x => x.visitas + ' visita(s)')}</div></div>
      ${HORAS.length ? `<div class="card"><div class="sec-title">Faturamento por hora</div>
        ${colChart(HORAS.map(x => ({ label: x.hora + 'h', value: x.valor })), v => 'R$' + Math.round(v))}
      </div>` : ''}
      ${(d.estoque_critico && d.estoque_critico.length) ? `<div class="card"><div class="sec-title">Estoque crítico</div><div class="rank">
        ${d.estoque_critico.slice(0, 8).map(p => `<div class="rank-row"><span>${esc(p.nome)}</span><span class="low-txt">${p.estoque_atual} ${p.tipo_estoque === 'fracionado' ? 'fr.' : 'un.'}</span></div>`).join('')}</div></div>` : ''}
    </div>`;
}
renderRelControls();

// ── Exportar PDF (imprime a seção visível — na janela use "Salvar como PDF") ──
function brData(s) { return s ? s.split('-').reverse().join('/') : '—'; }
function tituloPeriodo() {
  if (!$('#view-aulas').classList.contains('hidden')) {
    return { titulo: 'Relatório de Aulas', periodo: `Período: ${brData($('#au-di').value)} a ${brData($('#au-df').value)}` };
  }
  if (relModo === 'fechamento') return { titulo: 'Relatório de Comandas · Fechamento do dia', periodo: 'Data: ' + brData($('#r-data') && $('#r-data').value) };
  if (relModo === 'gerencial') return { titulo: 'Relatório de Comandas · Período', periodo: `Período: ${brData($('#r-di') && $('#r-di').value)} a ${brData($('#r-df') && $('#r-df').value)}` };
  const mesSel = $('#r-mes option:checked');
  return { titulo: 'Relatório de Comandas · Mensal', periodo: `${mesSel ? mesSel.textContent : ''} de ${$('#r-ano') ? $('#r-ano').value : ''}` };
}
function exportPDF() {
  const alvo = $('#view-aulas').classList.contains('hidden') ? '#rel-result' : '#au-result';
  if (!$(alvo).querySelector('.kpi')) return toast('Gere o relatório antes de exportar.', 'err');
  const { titulo, periodo } = tituloPeriodo();
  $('#print-head').innerHTML = `<div class="ph-t">${esc($('#brand-name').textContent)} — ${esc(titulo)}</div>
    <div class="ph-s">${esc(periodo)} · gerado em ${new Date().toLocaleString('pt-BR')}</div>`;
  window.print();
}
$$('.btn-pdf').forEach(b => b.addEventListener('click', exportPDF));

// ── identidade da arena ──
(async function applyIdentity() {
  try {
    const id = await (await fetch('/api/identity')).json();
    if (id.accent) document.documentElement.style.setProperty('--accent', id.accent);
    if (id.arena_name) $('#brand-name').textContent = id.arena_name;
    if (id.logo_url) { const l = $('#brand-logo'); l.src = id.logo_url; l.style.display = ''; }
  } catch (_) {}
})();
