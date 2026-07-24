'use strict';
const API = '/comandas/api';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmt = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
// Data local YYYY-MM-DD (NÃO usar toISOString, que devolve UTC e vira o dia seguinte à noite)
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── estado ──
let COMANDAS = [], PRODUTOS = [], CLIENTES = [], CATEGORIAS = [];
let selId = null;          // comanda aberta no drawer
let estModo = 'gestao';
const accOpen = {};        // accordions de estoque

// ── API ──
async function apiGET(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw await errFrom(r);
  return r.json();
}
async function apiSend(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw await errFrom(r);
  return r.status === 204 ? {} : r.json();
}
async function errFrom(r) {
  let d = 'Erro na operação.';
  try { d = (await r.json()).detail || d; } catch (_) {}
  return new Error(d);
}

// ── UI helpers ──
let toastT;
function toast(msg, type = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', 2600);
}
function openModal(title, html, size) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').className = 'modal' + (size ? ' ' + size : '');
  $('#modal-back').classList.add('show');
}
function closeModal() { $('#modal-back').classList.remove('show'); }
$('#modal-back').addEventListener('click', e => { if (e.target.id === 'modal-back') closeModal(); });
function confirmDlg(title, msg, onOk, okLabel = 'Confirmar') {
  openModal(title, `<p class="muted" style="font-size:14px;line-height:1.5">${esc(msg)}</p>
    <div class="modal-foot"><button class="btn btn-ghost" id="c-no">Cancelar</button>
    <button class="btn btn-danger-ghost" id="c-yes">${esc(okLabel)}</button></div>`);
  $('#c-no').onclick = closeModal;
  $('#c-yes').onclick = async () => { try { await onOk(); closeModal(); } catch (e) { toast(e.message, 'err'); } };
}

// ── navegação ──
$$('.nav button').forEach(b => b.addEventListener('click', () => {
  $$('.nav button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.page').forEach(p => p.classList.add('hidden'));
  $('#view-' + b.dataset.view).classList.remove('hidden');
  if (b.dataset.view === 'relatorios') renderRelControls();
}));

// ══════════════════════════════════════════ COMANDAS ══════════════════════════
function comandaTotal(c) { return (c.itens || []).reduce((a, i) => a + i.preco_unitario * i.quantidade, 0); }
function elapsed(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'agora'; if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60), r = mins % 60; return r ? `${h}h ${r}min` : h + 'h';
}
function shortId(id) { return ('0000' + id).slice(-4); }

function renderBoard() {
  const q = $('#cmd-search').value.toLowerCase();
  const match = c => c.cliente_nome.toLowerCase().includes(q) || shortId(c.id).includes(q);
  const abertas = COMANDAS.filter(c => c.status === 'aberta' && match(c))
    .sort((a, b) => new Date(a.data_abertura) - new Date(b.data_abertura));
  const pagas = COMANDAS.filter(c => c.status === 'paga' && match(c))
    .sort((a, b) => new Date(a.data_abertura) - new Date(b.data_abertura));
  const totAb = COMANDAS.filter(c => c.status === 'aberta').reduce((a, c) => a + comandaTotal(c), 0);

  $('#cnt-abertas').textContent = abertas.length;
  $('#cnt-pagas').textContent = pagas.length;
  $('#cmd-sub').textContent = `${abertas.length} em aberto · ${pagas.length} pagas`;
  $('#sub-abertas').textContent = totAb > 0 ? fmt(totAb) + ' em aberto' : '';

  const card = c => {
    const tot = comandaTotal(c), n = (c.itens || []).length;
    return `<div class="cmd ${selId === c.id ? 'sel' : ''}" data-id="${c.id}">
      <div><div class="nm">${esc(c.cliente_nome)}</div>
        <div class="meta"><span class="id">#${shortId(c.id)}</span> · ${n} ${n === 1 ? 'item' : 'itens'}</div></div>
      <div class="r"><div class="v">${fmt(tot)}</div><div class="e">${c.status === 'paga' ? 'pago' : elapsed(c.data_abertura)}</div></div>
    </div>`;
  };
  $('#list-abertas').innerHTML = abertas.length
    ? abertas.map(card).join('')
    : `<div class="empty"><i class="fa-regular fa-circle-check"></i>Nenhuma comanda em aberto.</div>`;
  $('#list-pagas').innerHTML = pagas.length
    ? pagas.map(card).join('')
    : `<div class="empty"><i class="fa-regular fa-clock"></i>Nenhuma comanda paga ainda.</div>`;
  $$('.cmd').forEach(el => el.onclick = () => openDrawer(+el.dataset.id));
}

async function reloadComandas() {
  [COMANDAS, PRODUTOS, CLIENTES] = await Promise.all([
    apiGET('/comandas'), apiGET('/produtos'), apiGET('/clientes'),
  ]);
  renderBoard();
  if (selId != null) { const c = COMANDAS.find(x => x.id === selId); if (c) renderDrawer(c); }
}

// ── drawer ──
function openDrawer(id) { selId = id; const c = COMANDAS.find(x => x.id === id); if (c) { renderDrawer(c); showDrawer(true); renderBoard(); } }
function showDrawer(on) {
  $('#overlay').classList.toggle('show', on);
  $('#drawer').classList.toggle('show', on);
  if (!on) { selId = null; renderBoard(); }
}
$('#overlay').addEventListener('click', () => showDrawer(false));

let prodPick = null;
function renderDrawer(c) {
  const tot = comandaTotal(c), aberta = c.status === 'aberta';
  const itens = (c.itens || []).map(i => `<div class="item">
      <div><div class="nm">${esc(i.nome)}</div><div class="q">${i.quantidade}x ${fmt(i.preco_unitario)}</div></div>
      <div style="display:flex;align-items:center;gap:12px"><span class="v">${fmt(i.quantidade * i.preco_unitario)}</span>
      ${aberta ? `<button class="icon-x" data-rm="${i.id}">✕</button>` : ''}</div></div>`).join('')
    || `<div class="empty" style="padding:22px"><i class="fa-regular fa-square-plus"></i>Nenhum item ainda.</div>`;

  let pago = '';
  if (c.status === 'paga' && c.pagamento) {
    const p = c.pagamento;
    pago = `<div class="dr-box" style="background:var(--ok-soft);border-color:#CDEBDE">
      <div class="lab" style="color:var(--ok)"><i class="fa-solid fa-circle-check"></i> Pagamento realizado</div>
      <div class="paybox" style="background:transparent;padding:0;gap:6px">
        <div class="ln"><span class="muted">Total bruto</span><span>${fmt(tot)}</span></div>
        ${p.desconto_percentual > 0 ? `<div class="ln"><span class="muted">Desconto</span><span style="color:var(--danger)">-${p.desconto_percentual}%</span></div>` : ''}
        <div class="ln" style="font-weight:700"><span>Valor final</span><span style="color:var(--ok)">${fmt(p.valor_final)}</span></div>
        <div class="ln"><span class="muted">Troco</span><span>${fmt(p.troco || 0)}</span></div>
        ${(p.pagamentos_recebidos || []).map(x => `<div class="ln"><span class="muted">${esc(x.forma)}</span><span>${fmt(x.valor)}</span></div>`).join('')}
      </div></div>`;
  }

  $('#drawer').innerHTML = `
    <div class="dr-head">
      <div class="top">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="pill ${aberta ? 'open' : 'paid'}">${c.status}</span>
          <h2>#${shortId(c.id)}</h2></div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" id="dr-print" title="Imprimir cupom"><i class="fa-solid fa-print"></i></button>
          <button class="btn btn-ghost btn-sm" id="dr-close"><i class="fa-solid fa-xmark"></i></button></div>
      </div>
      <div class="who">${esc(c.cliente_nome)}</div>
      <div class="when">Aberta às ${new Date(c.data_abertura).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
    <div class="dr-body">
      ${aberta ? `
      <div class="dr-box">
        <div class="lab">Código de barras</div>
        <div class="row"><input class="inp" id="dr-barcode" placeholder="Passe o leitor e Enter..." autocomplete="off">
          <button class="btn btn-dark" id="dr-barcode-btn">OK</button></div>
        <div class="hint">Produto adicionado automaticamente ao ler o código.</div>
      </div>
      <div class="dr-box">
        <div class="lab">Adicionar produto</div>
        <div class="row" style="align-items:flex-start">
          <div style="flex:1;position:relative"><input class="inp" id="dr-prod" placeholder="Digite o produto..." autocomplete="off">
            <div class="dropdown hidden" id="dr-prod-dd"></div></div>
          <input class="inp" id="dr-qtd" type="number" min="1" value="1" style="width:60px;text-align:center">
          <button class="btn btn-dark" id="dr-add"><i class="fa-solid fa-plus"></i></button>
        </div>
      </div>` : ''}
      <div><div class="lab" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:8px">Consumo</div>
        <div class="dr-box" style="padding:4px 15px">${itens}</div></div>
      ${pago}
    </div>
    <div class="dr-foot">
      <div class="tot"><span class="l">Total</span><span class="v">${fmt(tot)}</span></div>
      <div class="row">
        <button class="btn btn-danger-ghost" id="dr-del">Excluir</button>
        ${aberta ? `<button class="btn btn-dark" id="dr-pay" style="flex:1;justify-content:center" ${(c.itens || []).length ? '' : 'disabled'}>Registrar pagamento</button>` : ''}
      </div>
    </div>`;

  $('#dr-close').onclick = () => showDrawer(false);
  $('#dr-print').onclick = () => printCupom(c);
  $('#dr-del').onclick = () => confirmDlg('Excluir comanda',
    'Todos os itens voltam ao estoque. Esta ação não pode ser desfeita.',
    async () => { await apiSend('DELETE', '/comandas/' + c.id); showDrawer(false); await reloadComandas(); toast('Comanda excluída.'); }, 'Excluir');
  $$('#drawer [data-rm]').forEach(b => b.onclick = async () => {
    try { await apiSend('DELETE', `/comandas/${c.id}/itens/${b.dataset.rm}`); await reloadComandas(); }
    catch (e) { toast(e.message, 'err'); }
  });
  if (aberta) setupAddItem(c);
  const payBtn = $('#dr-pay'); if (payBtn) payBtn.onclick = () => openPagamento(c);
}

// Listener ÚNICO para fechar o dropdown de produtos (antes vazava 1 listener por render do drawer)
document.addEventListener('mousedown', e => {
  const dd = document.getElementById('dr-prod-dd');
  if (dd && !dd.contains(e.target) && e.target.id !== 'dr-prod') dd.classList.add('hidden');
});

function setupAddItem(c) {
  prodPick = null;
  const inp = $('#dr-prod'), dd = $('#dr-prod-dd'), qtd = $('#dr-qtd');
  const disp = p => p.tipo === 'fracionado' ? (p.fracoes_disponiveis || 0) : (p.quantidade || 0);
  const dispLabel = p => p.tipo === 'fracionado' ? `${disp(p)} ${p.unidade_medida_fracao || 'fr.'}` : `${disp(p)} un.`;
  function opts() {
    const q = inp.value.toLowerCase().trim();
    let list = PRODUTOS.filter(p => disp(p) > 0);
    let header = '';
    if (q) list = list.filter(p => p.nome.toLowerCase().includes(q));
    else { list = list.sort((a, b) => disp(b) - disp(a)).slice(0, 8); header = '<div class="grp">Sugestões</div>'; }
    if (!list.length) { dd.innerHTML = '<div class="opt muted">Nenhum produto disponível.</div>'; dd.classList.remove('hidden'); return; }
    dd.innerHTML = header + list.map(p => `<div class="opt" data-p="${p.id}"><span>${esc(p.nome)}</span><span class="badge">${dispLabel(p)}</span></div>`).join('');
    dd.classList.remove('hidden');
    $$('.opt[data-p]', dd).forEach(o => o.onclick = () => { prodPick = PRODUTOS.find(p => p.id === +o.dataset.p); inp.value = prodPick.nome; dd.classList.add('hidden'); });
  }
  inp.onfocus = opts; inp.oninput = () => { prodPick = null; opts(); };
  $('#dr-add').onclick = () => addItem(c, prodPick, parseInt(qtd.value) || 1);

  const bc = $('#dr-barcode');
  const doBc = async () => {
    const code = bc.value.trim(); if (!code) return;
    const local = PRODUTOS.find(p => p.codigo_barras === code);
    if (local) { bc.value = ''; return addItem(c, local, 1); }
    try { const p = await apiGET('/produtos/barcode/' + encodeURIComponent(code)); bc.value = ''; addItem(c, p, 1); }
    catch (e) { toast(e.message || 'Produto não encontrado.', 'err'); }
  };
  bc.onkeydown = e => { if (e.key === 'Enter') doBc(); };
  $('#dr-barcode-btn').onclick = doBc;
}

async function addItem(c, produto, qtd) {
  if (!produto) return toast('Selecione um produto.', 'err');
  try {
    await apiSend('POST', `/comandas/${c.id}/itens`, { produto_id: produto.id, quantidade: qtd });
    await reloadComandas();
    toast(`${produto.nome} adicionado!`);
    const inp = $('#dr-prod'); if (inp) { inp.value = ''; prodPick = null; }
    const qq = $('#dr-qtd'); if (qq) qq.value = 1;
    // devolve o foco ao leitor: permite bipar vários produtos em sequência
    const bc = $('#dr-barcode'); if (bc) bc.focus();
  } catch (e) { toast(e.message, 'err'); }
}

// ── nova comanda ──
$('#btn-nova-comanda').addEventListener('click', () => {
  if (!CAIXA.aberto) {
    toast('O caixa está fechado — abra o caixa para começar.', 'err');
    abrirCaixaModal();
    return;
  }
  openModal('Nova comanda', `
    <div class="row" style="align-items:center;gap:8px">
      <div class="search" style="flex:1"><i class="fa-solid fa-magnifying-glass"></i>
        <input class="inp" id="nc-search" placeholder="Buscar cliente..." autocomplete="off" autofocus></div>
      <button class="btn btn-ghost btn-sm" id="nc-toggle-new" style="white-space:nowrap"><i class="fa-solid fa-user-plus"></i> Novo</button>
    </div>
    <div id="nc-newform" class="hidden" style="margin-top:12px;background:#F7F5F1;border-radius:11px;padding:14px">
      <div class="lab" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:9px">Cadastrar cliente</div>
      <div class="field" style="margin-bottom:9px"><input class="inp" id="nc-nome" placeholder="Nome do cliente *" autocomplete="off"></div>
      <div class="row"><input class="inp" id="nc-tel" placeholder="Telefone (opcional)" autocomplete="off">
        <button class="btn btn-primary" id="nc-criar" style="white-space:nowrap"><i class="fa-solid fa-check"></i> Criar e abrir</button></div>
    </div>
    <div id="nc-list" style="display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto;margin-top:12px"></div>`);

  const form = $('#nc-newform');
  const openForm = (nome) => {
    form.classList.remove('hidden');
    $('#nc-nome').value = nome || '';
    ($('#nc-nome').value ? $('#nc-tel') : $('#nc-nome')).focus();
  };
  $('#nc-toggle-new').onclick = () => { form.classList.contains('hidden') ? openForm($('#nc-search').value.trim()) : form.classList.add('hidden'); };
  const criar = async () => {
    const nome = $('#nc-nome').value.trim();
    if (!nome) return toast('Informe o nome do cliente.', 'err');
    try {
      const cli = await apiSend('POST', '/clientes', { nome, telefone: $('#nc-tel').value.trim() || null });
      CLIENTES.push(cli);
      await novaComanda(cli.id);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#nc-criar').onclick = criar;
  $('#nc-tel').onkeydown = e => { if (e.key === 'Enter') criar(); };
  $('#nc-nome').onkeydown = e => { if (e.key === 'Enter') $('#nc-tel').focus(); };

  const draw = () => {
    const q = $('#nc-search').value.toLowerCase().trim();
    const list = CLIENTES.filter(c => c.nome.toLowerCase().includes(q));
    let html = list.map(c => `<button class="btn btn-ghost" style="justify-content:flex-start;gap:10px" data-cli="${c.id}">
        <span class="cli-in">${esc(c.nome[0].toUpperCase())}</span>${esc(c.nome)}${c.telefone ? `<span class="muted" style="font-weight:400">· ${esc(c.telefone)}</span>` : ''}</button>`).join('');
    if (!list.length) {
      html = `<p class="muted" style="text-align:center;padding:8px;font-size:13px">${q ? `Nenhum cliente com "${esc(q)}".` : 'Nenhum cliente cadastrado ainda.'}</p>`;
      if (q) html += `<button class="btn btn-ghost" id="nc-quick" style="border-style:dashed;color:var(--accent);justify-content:center"><i class="fa-solid fa-user-plus"></i> Cadastrar "${esc($('#nc-search').value.trim())}"</button>`;
    }
    $('#nc-list').innerHTML = html;
    $$('#nc-list [data-cli]').forEach(b => b.onclick = () => novaComanda(+b.dataset.cli));
    const qb = $('#nc-quick'); if (qb) qb.onclick = () => openForm($('#nc-search').value.trim());
  };
  $('#nc-search').oninput = draw; draw();
});
async function novaComanda(cliente_id) {
  try { const c = await apiSend('POST', '/comandas', { cliente_id }); closeModal(); await reloadComandas(); openDrawer(c.id); toast('Comanda aberta!'); }
  catch (e) { toast(e.message, 'err'); }
}

// ── pagamento ──
function openPagamento(c) {
  const tot = comandaTotal(c);
  let desc = 0, parciais = [];
  openModal('Finalizar pagamento', `
    <div class="paybox">
      <div class="ln"><span class="muted">Total bruto</span><span>${fmt(tot)}</span></div>
      <div class="ln" style="align-items:center"><span class="muted">Desconto (%)</span>
        <input class="inp" id="pg-desc" type="number" min="0" max="100" value="0" style="width:90px;text-align:center"></div>
      <div class="ln" style="border-top:1px solid var(--line);padding-top:9px"><span style="font-weight:700">Valor final</span><span class="big" id="pg-final">${fmt(tot)}</span></div>
    </div>
    <div class="field" style="margin-top:16px"><label>Registrar pagamento</label>
      <div class="row"><select class="inp" id="pg-forma" style="flex:1"><option>Dinheiro</option><option>PIX</option><option>Cartão</option></select>
        <input class="inp" id="pg-valor" type="number" step="0.01" placeholder="Valor" style="flex:1">
        <button class="btn btn-ghost" id="pg-add">+ Add</button></div>
      <div id="pg-parciais"></div></div>
    <div class="paybox">
      <div class="ln"><span class="muted">Total recebido</span><span id="pg-receb">R$ 0,00</span></div>
      <div class="ln" style="font-weight:700"><span>Troco</span><span id="pg-troco">R$ 0,00</span></div></div>
    <div class="modal-foot" style="margin-top:16px"><button class="btn btn-ok" id="pg-confirm" style="width:100%;justify-content:center" disabled>Confirmar pagamento</button></div>
  `, 'md');

  const recalc = () => {
    desc = Math.min(100, Math.max(0, parseFloat($('#pg-desc').value) || 0));
    const final = tot * (1 - desc / 100);
    const receb = parciais.reduce((a, p) => a + p.valor, 0);
    const troco = Math.max(0, receb - final);
    $('#pg-final').textContent = fmt(final);
    $('#pg-receb').textContent = fmt(receb);
    $('#pg-troco').textContent = fmt(troco);
    $('#pg-parciais').innerHTML = parciais.map((p, i) => `<div class="parcial"><span>${esc(p.forma)}</span>
      <span style="display:flex;gap:10px;align-items:center">${fmt(p.valor)}<button class="icon-x" data-del="${i}">✕</button></span></div>`).join('');
    $$('#pg-parciais [data-del]').forEach(b => b.onclick = () => { parciais.splice(+b.dataset.del, 1); recalc(); });
    $('#pg-confirm').disabled = !(receb >= final && final > 0);
    return { final, receb, troco };
  };
  $('#pg-desc').oninput = recalc;
  const addParcial = () => {
    const v = parseFloat($('#pg-valor').value);
    if (isNaN(v) || v <= 0) return toast('Valor inválido.', 'err');
    parciais.push({ forma: $('#pg-forma').value, valor: v }); $('#pg-valor').value = ''; recalc();
  };
  $('#pg-add').onclick = addParcial;
  $('#pg-valor').onkeydown = e => { if (e.key === 'Enter') addParcial(); };
  $('#pg-confirm').onclick = async () => {
    const { final, troco } = recalc();
    try {
      await apiSend('POST', `/comandas/${c.id}/pagar`, { pagamento_info: {
        desconto_percentual: desc, valor_final: round2(final), pagamentos_recebidos: parciais, troco: round2(troco) } });
      closeModal(); await reloadComandas(); toast('Pagamento confirmado! ✓');
    } catch (e) { toast(e.message, 'err'); }
  };
  recalc();
}
const round2 = v => Math.round(v * 100) / 100;

// ── caixa: abrir (com fundo de troco) / fechar ──
let CAIXA = { aberto: false, valor_abertura: 0 };
function renderCaixaBtn() {
  const b = $('#btn-fechar-caixa');
  if (CAIXA.aberto) {
    b.innerHTML = '<i class="fa-solid fa-cash-register"></i> Fechar caixa';
    b.title = CAIXA.valor_abertura > 0 ? `Aberto com ${fmt(CAIXA.valor_abertura)} de troco` : 'Caixa aberto';
  } else {
    b.innerHTML = '<i class="fa-solid fa-lock-open"></i> Abrir caixa';
    b.title = 'O caixa está fechado';
  }
}
async function loadCaixa() {
  try { CAIXA = await apiGET('/caixa'); } catch (_) {}
  renderCaixaBtn();
}
function abrirCaixaModal() {
  openModal('Abrir o caixa', `
    <p class="muted" style="font-size:14px;line-height:1.5">Informe quanto tem em dinheiro no caixa para começar o dia (fundo de troco).</p>
    <div class="field" style="margin-top:14px"><label>Valor de abertura (R$)</label>
      <input class="inp" id="cx-valor" type="number" step="0.01" min="0" placeholder="0,00" autofocus></div>
    <div class="modal-foot"><button class="btn btn-ghost" id="cx-cancel">Cancelar</button>
      <button class="btn btn-ok" id="cx-abrir"><i class="fa-solid fa-lock-open"></i> Abrir caixa</button></div>`);
  $('#cx-cancel').onclick = closeModal;
  const doAbrir = async () => {
    const v = parseFloat($('#cx-valor').value) || 0;
    if (v < 0) return toast('Valor inválido.', 'err');
    try {
      await apiSend('POST', '/caixa/abrir', { valor_abertura: v });
      closeModal(); await loadCaixa();
      toast(`Caixa aberto com ${fmt(v)} de troco.`);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#cx-abrir').onclick = doAbrir;
  $('#cx-valor').onkeydown = e => { if (e.key === 'Enter') doAbrir(); };
}
$('#btn-fechar-caixa').addEventListener('click', () => {
  if (!CAIXA.aberto) { abrirCaixaModal(); return; }
  confirmDlg('Fechar o caixa',
    'Todas as comandas pagas serão arquivadas e o caixa será encerrado. Comandas abertas precisam ser finalizadas antes.',
    async () => { await apiSend('POST', '/comandas/fechar-dia'); showDrawer(false); await reloadComandas(); await loadCaixa(); toast('Caixa fechado!'); }, 'Fechar caixa');
});
$('#cmd-search').addEventListener('input', renderBoard);

// ── cupom ──
function printCupom(c) {
  const tot = comandaTotal(c);
  const p = c.pagamento;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>@page{size:80mm auto;margin:0}
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:monospace;font-size:11px;width:72mm;padding:3mm 4mm;line-height:1.5}
    .c{text-align:center}.b{font-weight:bold}.big{font-size:15px;font-weight:bold}.sm{font-size:10px}
    .logo{max-width:44mm;max-height:22mm;object-fit:contain;margin:0 auto 3px;display:block;filter:grayscale(1) contrast(1.2)}
    .row{display:flex;justify-content:space-between}.dv{border-top:1px dashed #000;margin:4px 0}</style></head><body>
    <div class="c"><img class="logo" src="${esc(BRAND.logo)}" onerror="this.style.display='none'"><div class="big">${esc(BRAND.name)}</div><div class="sm">Comandas</div></div><div class="dv"></div>
    <div><b>Comanda:</b> #${shortId(c.id)}</div><div><b>Cliente:</b> ${esc(c.cliente_nome)}</div>
    <div><b>Data:</b> ${new Date(c.data_abertura).toLocaleString('pt-BR')}</div><div><b>Status:</b> ${esc(c.status.toUpperCase())}</div>
    <div class="dv"></div><div class="b">ITENS:</div>
    ${(c.itens || []).map(i => `<div class="row"><span>${i.quantidade}x ${esc(i.nome)}</span><span>${fmt(i.quantidade * i.preco_unitario)}</span></div>`).join('')}
    <div class="dv"></div><div class="row b"><span>TOTAL:</span><span>${fmt(tot)}</span></div>
    ${p ? `<div class="dv"></div>${p.desconto_percentual > 0 ? `<div class="row"><span>Desconto (${p.desconto_percentual}%):</span><span>-${fmt(tot - p.valor_final)}</span></div>` : ''}
      <div class="row b"><span>VALOR FINAL:</span><span>${fmt(p.valor_final)}</span></div><div class="row"><span>Troco:</span><span>${fmt(p.troco || 0)}</span></div>
      <div class="dv"></div><div class="b">PAGAMENTOS:</div>${(p.pagamentos_recebidos || []).map(x => `<div class="row"><span>${esc(x.forma)}:</span><span>${fmt(x.valor)}</span></div>`).join('')}` : ''}
    <div class="dv"></div><div class="c sm">Obrigado pela preferência!<br>${new Date().toLocaleDateString('pt-BR')}</div></body></html>`;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:80mm;height:0;border:none';
  document.body.appendChild(f);
  const doc = f.contentWindow.document; doc.open(); doc.write(html); doc.close();
  const go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1000); };
  f.onload = () => {
    const img = doc.querySelector('.logo');
    // espera a logo carregar (senão imprime antes da imagem aparecer)
    if (img && !img.complete) { img.onload = img.onerror = () => setTimeout(go, 120); setTimeout(go, 800); }
    else setTimeout(go, 200);
  };
}

// ══════════════════════════════════════════ ESTOQUE ═══════════════════════════
$$('#est-modo button').forEach(b => b.onclick = () => {
  $$('#est-modo button').forEach(x => x.classList.remove('active')); b.classList.add('active');
  estModo = b.dataset.modo; renderEstoque();
});
$('#est-search').addEventListener('input', renderEstoque);

async function reloadEstoque() {
  [PRODUTOS, CATEGORIAS] = await Promise.all([apiGET('/produtos'), apiGET('/categorias')]);
  renderEstoque();
}
function dispNum(p) { return p.tipo === 'fracionado' ? (p.fracoes_disponiveis || 0) : (p.quantidade || 0); }
function renderEstoque() {
  const q = $('#est-search').value.toLowerCase();
  const list = PRODUTOS.filter(p => p.nome.toLowerCase().includes(q));
  const grupos = {};
  list.forEach(p => { const c = p.categoria || 'Sem categoria'; (grupos[c] = grupos[c] || []).push(p); });
  const cats = Object.keys(grupos).sort((a, b) => a === 'Sem categoria' ? 1 : b === 'Sem categoria' ? -1 : a.localeCompare(b));
  $('#est-sub').textContent = `${PRODUTOS.length} produtos · ${new Set(PRODUTOS.map(p => p.categoria || 'Sem categoria')).size} categorias`;
  const gest = estModo === 'gestao';

  if (!list.length) { $('#est-list').innerHTML = `<div class="empty"><i class="fa-solid fa-box-open"></i>Nenhum produto encontrado.</div>`; return; }
  $('#est-list').innerHTML = cats.map(cat => {
    const prods = grupos[cat];
    const low = prods.some(p => dispNum(p) <= 5);
    // Categorias começam MINIMIZADAS; buscar expande tudo para mostrar os resultados
    const open = q ? true : accOpen[cat] === true;
    const rows = prods.map(p => {
      const estoque = p.tipo === 'fracionado' ? `${p.fracoes_disponiveis} ${p.unidade_medida_fracao || 'fr.'}` : `${p.quantidade} un.`;
      const preco = p.tipo === 'fracionado' ? `${fmt(p.preco_venda_fracao || 0)} / ${p.unidade_medida_fracao || 'fr.'}` : fmt(p.preco_venda || 0);
      const lucro = p.tipo === 'fracionado' ? (p.preco_venda_fracao || 0) - (p.preco_custo / (p.total_fracoes || 1)) : (p.preco_venda || 0) - p.preco_custo;
      const baixo = dispNum(p) <= 5;
      return `<tr>
        <td><span style="font-weight:600">${esc(p.nome)}</span></td>
        ${gest ? `<td><span class="tag ${p.tipo === 'fracionado' ? 'frac' : 'unit'}">${p.tipo === 'fracionado' ? 'Fracionado' : 'Unitário'}</span></td>` : ''}
        <td>${preco}${gest ? `<span class="lucro">+${fmt(lucro)}</span>` : ''}</td>
        <td class="${baixo ? 'low-txt' : 'muted'}">${estoque}</td>
        ${gest ? `<td><div class="r-actions">
          <button class="btn btn-ghost btn-sm" data-ver="${p.id}">Ver</button>
          <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Editar</button>
          <button class="btn btn-danger-ghost btn-sm" data-del="${p.id}">Excluir</button></div></td>` : ''}
      </tr>`;
    }).join('');
    return `<div class="acc ${open ? 'open' : ''}" data-cat="${esc(cat)}">
      <button class="acc-head"><div class="l"><span class="cat">${esc(cat)}</span><span class="cnt">${prods.length}</span>
        ${low ? '<span class="low">Estoque baixo</span>' : ''}</div>
        <i class="fa-solid fa-chevron-down chev"></i></button>
      <div class="acc-body"><table><thead><tr>
        <th>Nome</th>${gest ? '<th>Tipo</th>' : ''}<th>Preço venda</th><th>Estoque</th>${gest ? '<th style="text-align:right">Ações</th>' : ''}
        </tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join('');

  $$('.acc-head').forEach(h => h.onclick = () => {
    const el = h.closest('.acc');
    el.classList.toggle('open');
    accOpen[el.dataset.cat] = el.classList.contains('open');
  });
  $$('[data-edit]').forEach(b => b.onclick = e => { e.stopPropagation(); produtoModal(PRODUTOS.find(p => p.id === +b.dataset.edit)); });
  $$('[data-ver]').forEach(b => b.onclick = e => { e.stopPropagation(); produtoDetalhe(PRODUTOS.find(p => p.id === +b.dataset.ver)); });
  $$('[data-del]').forEach(b => b.onclick = e => { e.stopPropagation(); const p = PRODUTOS.find(x => x.id === +b.dataset.del);
    confirmDlg('Excluir produto', `Excluir "${p.nome}"? Esta ação não pode ser desfeita.`,
      async () => { await apiSend('DELETE', '/produtos/' + p.id); await reloadEstoque(); toast('Produto excluído.'); }, 'Excluir'); });
}

$('#btn-novo-produto').addEventListener('click', () => produtoModal(null));
function produtoModal(prod) {
  const f = prod || { tipo: 'unitario', preco_custo: '', preco_venda: '', quantidade: '', unidade_medida_fracao: '', preco_venda_fracao: '', volume_pai: '', volume_fracao: '', categoria: '', codigo_barras: '', nome: '' };
  const catOpts = CATEGORIAS.map(c => `<option ${f.categoria === c.nome ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  openModal(prod ? 'Editar produto' : 'Novo produto', `
    <div class="field"><label>Tipo</label><select class="inp" id="f-tipo">
      <option value="unitario" ${f.tipo === 'unitario' ? 'selected' : ''}>Produto unitário</option>
      <option value="fracionado" ${f.tipo === 'fracionado' ? 'selected' : ''}>Produto fracionado</option></select></div>
    <div class="field"><label>Nome *</label><input class="inp" id="f-nome" value="${esc(f.nome)}" placeholder="Nome do produto"></div>
    <div class="field"><label>Código de barras</label><input class="inp" id="f-codigo" value="${esc(f.codigo_barras || '')}" placeholder="Opcional"></div>
    <div class="field"><label>Categoria</label><select class="inp" id="f-cat">
      <option value="">Sem categoria</option>${catOpts}<option value="__nova__">+ Criar nova categoria...</option></select>
      <input class="inp hidden" id="f-catnova" placeholder="Nome da nova categoria" style="margin-top:8px"></div>
    <div class="field"><label>Preço de custo (R$)</label><input class="inp" id="f-custo" type="number" step="0.01" value="${f.preco_custo}" placeholder="0,00"></div>
    <div id="f-unit">
      <div class="field"><label>Preço de venda (R$)</label><input class="inp" id="f-venda" type="number" step="0.01" value="${f.preco_venda || ''}" placeholder="0,00"></div>
      <div class="field"><label>Quantidade em estoque</label><input class="inp" id="f-qtd" type="number" value="${f.quantidade || ''}" placeholder="0"></div>
    </div>
    <div id="f-frac" class="hidden">
      <div class="field"><label>Nome da fração (ex: Dose, Copo)</label><input class="inp" id="f-un" value="${esc(f.unidade_medida_fracao || '')}" placeholder="Dose"></div>
      <div class="field"><label>Preço de venda da fração (R$)</label><input class="inp" id="f-vfrac" type="number" step="0.01" value="${f.preco_venda_fracao || ''}" placeholder="0,00"></div>
      <div class="row"><div class="field" style="flex:1"><label>Volume total (ml)</label><input class="inp" id="f-vpai" type="number" value="${f.volume_pai || ''}" placeholder="1000"></div>
        <div class="field" style="flex:1"><label>Volume da fração (ml)</label><input class="inp" id="f-vf" type="number" value="${f.volume_fracao || ''}" placeholder="50"></div></div>
      <div class="field"><label>Qtd. de garrafas/unidades-mãe</label><input class="inp" id="f-qtdf" type="number" value="${f.quantidade || ''}" placeholder="0"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" id="f-cancel">Cancelar</button>
      <button class="btn btn-primary" id="f-save">${prod ? 'Salvar' : 'Cadastrar'}</button></div>
  `);
  const tipo = $('#f-tipo');
  const sync = () => { const frac = tipo.value === 'fracionado'; $('#f-frac').classList.toggle('hidden', !frac); $('#f-unit').classList.toggle('hidden', frac); };
  tipo.onchange = sync; sync();
  $('#f-cat').onchange = e => $('#f-catnova').classList.toggle('hidden', e.target.value !== '__nova__');
  $('#f-cancel').onclick = closeModal;
  $('#f-save').onclick = async () => {
    const nome = $('#f-nome').value.trim(); if (!nome) return toast('Nome é obrigatório.', 'err');
    let categoria = $('#f-cat').value;
    if (categoria === '__nova__') { categoria = $('#f-catnova').value.trim(); if (!categoria) return toast('Digite o nome da categoria.', 'err'); }
    const d = { nome, tipo: tipo.value, preco_custo: parseFloat($('#f-custo').value) || 0, categoria: categoria || null, codigo_barras: $('#f-codigo').value.trim() || null };
    if (tipo.value === 'unitario') { d.preco_venda = parseFloat($('#f-venda').value) || 0; d.quantidade = parseInt($('#f-qtd').value) || 0; }
    else { d.unidade_medida_fracao = $('#f-un').value.trim(); d.preco_venda_fracao = parseFloat($('#f-vfrac').value) || 0;
      d.volume_pai = parseFloat($('#f-vpai').value) || 0; d.volume_fracao = parseFloat($('#f-vf').value) || 0; d.quantidade = parseInt($('#f-qtdf').value) || 0; }
    try {
      if (categoria && !CATEGORIAS.some(c => c.nome === categoria)) await apiSend('POST', '/categorias', { nome: categoria });
      if (prod) await apiSend('PUT', '/produtos/' + prod.id, d); else await apiSend('POST', '/produtos', d);
      closeModal(); await reloadEstoque(); toast(prod ? 'Produto atualizado!' : 'Produto cadastrado!');
    } catch (e) { toast(e.message, 'err'); }
  };
}
function produtoDetalhe(p) {
  const rows = [['Nome', p.nome], ['Categoria', p.categoria || 'Sem categoria'], ['Tipo', p.tipo === 'fracionado' ? 'Fracionado' : 'Unitário'], ['Preço de custo', fmt(p.preco_custo)]];
  let extra;
  if (p.tipo === 'unitario') {
    const lucro = (p.preco_venda || 0) - p.preco_custo, mg = p.preco_venda ? (lucro / p.preco_venda * 100).toFixed(1) : 0;
    extra = [['Preço de venda', fmt(p.preco_venda || 0)], ['Lucro por unidade', `${fmt(lucro)} (${mg}%)`], ['Estoque atual', `${p.quantidade} un.`]];
  } else {
    const cf = p.preco_custo / (p.total_fracoes || 1), lf = (p.preco_venda_fracao || 0) - cf, mg = p.preco_venda_fracao ? (lf / p.preco_venda_fracao * 100).toFixed(1) : 0;
    extra = [['Fração', `${p.unidade_medida_fracao} (${p.volume_fracao}ml)`], ['Frações por unidade', p.total_fracoes], ['Preço da fração', fmt(p.preco_venda_fracao || 0)],
      ['Custo por fração', fmt(cf)], ['Lucro por fração', `${fmt(lf)} (${mg}%)`], ['Estoque', `${p.quantidade} un. (${p.fracoes_disponiveis} frações)`]];
  }
  openModal('Detalhes do produto', [...rows, ...extra].map(([l, v]) =>
    `<div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line)"><span class="muted" style="font-size:13px">${esc(l)}</span><span style="font-weight:600;font-size:13px">${esc(v)}</span></div>`).join(''));
}

// ── categorias ──
$('#btn-categorias').addEventListener('click', catModal);
function catModal() {
  openModal('Gerenciar categorias', `
    <div class="row"><input class="inp" id="cat-nome" placeholder="Nova categoria..."><button class="btn btn-primary" id="cat-add">+ Criar</button></div>
    <div id="cat-list" style="display:flex;flex-direction:column;gap:8px;margin-top:14px;max-height:320px;overflow-y:auto"></div>`);
  const draw = () => {
    $('#cat-list').innerHTML = CATEGORIAS.length ? CATEGORIAS.map(c => {
      const n = PRODUTOS.filter(p => p.categoria === c.nome).length;
      return `<div class="parcial"><div><div style="font-weight:600;font-size:13.5px">${esc(c.nome)}</div><div class="muted" style="font-size:11.5px">${n} produto(s)</div></div>
        <div class="row"><button class="btn btn-ghost btn-sm" data-ed="${c.id}">Editar</button><button class="btn btn-danger-ghost btn-sm" data-dl="${c.id}">Excluir</button></div></div>`;
    }).join('') : '<p class="muted" style="text-align:center;font-size:13px;padding:8px">Nenhuma categoria ainda.</p>';
    $$('#cat-list [data-ed]').forEach(b => b.onclick = () => { const c = CATEGORIAS.find(x => x.id === +b.dataset.ed); const nv = prompt('Novo nome da categoria:', c.nome); if (nv && nv.trim()) apiSend('PUT', '/categorias/' + c.id, { nome: nv.trim() }).then(async () => { await reloadEstoque(); draw(); toast('Categoria atualizada.'); }).catch(e => toast(e.message, 'err')); });
    $$('#cat-list [data-dl]').forEach(b => b.onclick = () => { const c = CATEGORIAS.find(x => x.id === +b.dataset.dl);
      confirmDlg('Excluir categoria', `Excluir "${c.nome}"? Os produtos ficarão como "Sem categoria".`,
        async () => { await apiSend('DELETE', '/categorias/' + c.id); await reloadEstoque(); draw(); toast('Categoria excluída.'); }, 'Excluir'); });
  };
  $('#cat-add').onclick = async () => { const nome = $('#cat-nome').value.trim(); if (!nome) return; try { await apiSend('POST', '/categorias', { nome }); $('#cat-nome').value = ''; await reloadEstoque(); draw(); toast('Categoria criada.'); } catch (e) { toast(e.message, 'err'); } };
  $('#cat-nome').onkeydown = e => { if (e.key === 'Enter') $('#cat-add').click(); };
  draw();
}

// ══════════════════════════════════════════ CLIENTES ══════════════════════════
$('#cli-search').addEventListener('input', renderClientes);
$('#btn-novo-cliente').addEventListener('click', () => clienteModal(null));
async function reloadClientes() { CLIENTES = await apiGET('/clientes'); renderClientes(); }
function renderClientes() {
  const q = $('#cli-search').value.toLowerCase();
  const list = CLIENTES.filter(c => c.nome.toLowerCase().includes(q));
  $('#cli-sub').textContent = `${CLIENTES.length} cliente(s)`;
  if (!list.length) { $('#cli-list').innerHTML = `<div class="empty" style="grid-column:1/-1"><i class="fa-solid fa-user-group"></i>Nenhum cliente encontrado.</div>`; return; }
  $('#cli-list').innerHTML = list.map(c => `<div class="cli">
    <div class="av">${esc(c.nome[0].toUpperCase())}</div>
    <div class="nm">${esc(c.nome)}</div>
    ${c.telefone ? `<div class="info"><i class="fa-solid fa-phone" style="font-size:11px"></i> ${esc(c.telefone)}</div>` : ''}
    ${c.cpf ? `<div class="info"><i class="fa-solid fa-id-card" style="font-size:11px"></i> ${esc(c.cpf)}</div>` : ''}
    ${c.endereco ? `<div class="info"><i class="fa-solid fa-location-dot" style="font-size:11px"></i> ${esc(c.endereco)}</div>` : ''}
    <div class="cli-actions"><button class="btn btn-ghost btn-sm" data-ed="${c.id}">Editar</button>
      <button class="btn btn-danger-ghost btn-sm" data-dl="${c.id}">Excluir</button></div></div>`).join('');
  $$('#cli-list [data-ed]').forEach(b => b.onclick = () => clienteModal(CLIENTES.find(c => c.id === +b.dataset.ed)));
  $$('#cli-list [data-dl]').forEach(b => b.onclick = () => { const c = CLIENTES.find(x => x.id === +b.dataset.dl);
    confirmDlg('Excluir cliente', `Excluir "${c.nome}"?`, async () => { await apiSend('DELETE', '/clientes/' + c.id); await reloadClientes(); toast('Cliente excluído.'); }, 'Excluir'); });
}
function clienteModal(cli) {
  const c = cli || { nome: '', telefone: '', endereco: '', cpf: '' };
  openModal(cli ? 'Editar cliente' : 'Novo cliente', `
    <div class="field"><label>Nome *</label><input class="inp" id="cl-nome" value="${esc(c.nome)}" autofocus></div>
    <div class="field"><label>Telefone</label><input class="inp" id="cl-tel" value="${esc(c.telefone || '')}"></div>
    <div class="field"><label>CPF</label><input class="inp" id="cl-cpf" value="${esc(c.cpf || '')}"></div>
    <div class="field"><label>Endereço</label><input class="inp" id="cl-end" value="${esc(c.endereco || '')}"></div>
    <div class="modal-foot"><button class="btn btn-ghost" id="cl-cancel">Cancelar</button><button class="btn btn-primary" id="cl-save">${cli ? 'Salvar' : 'Cadastrar'}</button></div>`);
  $('#cl-cancel').onclick = closeModal;
  $('#cl-save').onclick = async () => {
    const d = { nome: $('#cl-nome').value.trim(), telefone: $('#cl-tel').value.trim(), cpf: $('#cl-cpf').value.trim(), endereco: $('#cl-end').value.trim() };
    if (!d.nome) return toast('Nome é obrigatório.', 'err');
    try { if (cli) await apiSend('PUT', '/clientes/' + cli.id, d); else await apiSend('POST', '/clientes', d); closeModal(); await reloadClientes(); toast(cli ? 'Cliente atualizado!' : 'Cliente cadastrado!'); }
    catch (e) { toast(e.message, 'err'); }
  };
}

// ══════════════════════════════════════════ RELATÓRIOS ════════════════════════
let relModo = 'fechamento';
$$('#rel-modo button').forEach(b => b.onclick = () => { $$('#rel-modo button').forEach(x => x.classList.remove('active')); b.classList.add('active'); relModo = b.dataset.modo; renderRelControls(); });
function renderRelControls() {
  const hoje = localDate();
  const c = $('#rel-controls');
  if (relModo === 'fechamento') {
    c.innerHTML = `<div class="field" style="margin:0"><label>Data</label><input class="inp" id="r-data" type="date" value="${hoje}"></div>
      <button class="btn btn-primary" id="r-go"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>`;
    $('#r-go').onclick = () => relFetch('/relatorios/fechamento-dia', { data: $('#r-data').value });
  } else if (relModo === 'gerencial') {
    c.innerHTML = `<div class="field" style="margin:0"><label>Início</label><input class="inp" id="r-di" type="date" value="${hoje}"></div>
      <div class="field" style="margin:0"><label>Fim</label><input class="inp" id="r-df" type="date" value="${hoje}"></div>
      <button class="btn btn-primary" id="r-go"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>`;
    $('#r-go').onclick = () => relFetch('/relatorios/gerencial', { data_inicio: $('#r-di').value, data_fim: $('#r-df').value });
  } else {
    const d = new Date();
    c.innerHTML = `<div class="field" style="margin:0"><label>Mês</label><select class="inp" id="r-mes">${
      ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
      .map((m, i) => `<option value="${i + 1}" ${i === d.getMonth() ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>Ano</label><input class="inp" id="r-ano" type="number" value="${d.getFullYear()}" style="width:100px"></div>
      <button class="btn btn-primary" id="r-go"><i class="fa-solid fa-magnifying-glass"></i> Gerar</button>`;
    $('#r-go').onclick = () => relFetch('/relatorios/mensal', { ano: +$('#r-ano').value, mes: +$('#r-mes').value });
  }
  $('#rel-result').innerHTML = '';
}
async function relFetch(path, body) {
  $('#rel-result').innerHTML = `<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i>Gerando...</div>`;
  try { renderRelatorio(await apiSend('POST', path, body)); }
  catch (e) { $('#rel-result').innerHTML = `<div class="empty"><i class="fa-solid fa-circle-info"></i>${esc(e.message)}</div>`; }
}
function renderRelatorio(d) {
  const kpi = (l, v, s, cls = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
  const margemCls = d.margem_lucro >= 30 ? '' : '';
  const maxDia = Math.max(1, ...(d.faturamento_por_dia || []).map(x => x.valor));
  const maxForma = Math.max(1, ...(d.formas_pagamento || []).map(x => x.valor));
  const HORAS = d.faturamento_por_hora || [];
  const maxHora = Math.max(1, ...HORAS.map(x => x.valor));

  const comp = d.comparativo_mes_anterior;
  const compHtml = comp ? `<div class="card" style="margin-bottom:16px"><div class="sec-title">Comparativo com mês anterior</div>
    <div class="kpis" style="margin:0">
      ${kpi('Faturamento ant.', fmt(comp.faturamento_bruto), '')}
      ${kpi('Variação', (comp.variacao_faturamento >= 0 ? '+' : '') + comp.variacao_faturamento + '%', '', comp.variacao_faturamento >= 0 ? 'ok-txt' : '')}
      ${kpi('Lucro ant.', fmt(comp.lucro_bruto), '')}
      ${kpi('Ticket ant.', fmt(comp.ticket_medio), '')}
    </div></div>` : '';

  const rankList = (arr, valFn, subFn) => (arr || []).slice(0, 8).map((x, i) => `<div class="rank-row">
    <div class="n"><span class="pos">${i + 1}</span><div><div style="font-weight:600">${esc(x.nome)}</div>${subFn ? `<div class="muted" style="font-size:11.5px">${subFn(x)}</div>` : ''}</div></div>
    <span style="font-weight:700">${valFn(x)}</span></div>`).join('') || '<p class="muted" style="font-size:13px">Sem dados.</p>';

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
      <div class="card"><div class="sec-title">Faturamento por dia</div><div class="bars">
        ${(d.faturamento_por_dia || []).map(x => `<div class="bar-row"><span class="muted">${x.dia.slice(8) + '/' + x.dia.slice(5, 7)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${x.valor / maxDia * 100}%"></div></div><span>${fmt(x.valor)}</span></div>`).join('') || '<p class="muted" style="font-size:13px">Sem dados.</p>'}
      </div></div>
      <div class="card"><div class="sec-title">Formas de pagamento</div><div class="bars">
        ${(d.formas_pagamento || []).map(x => `<div class="bar-row"><span class="muted">${esc(x.forma)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${x.valor / maxForma * 100}%"></div></div><span>${fmt(x.valor)}</span></div>`).join('') || '<p class="muted" style="font-size:13px">Sem dados.</p>'}
      </div></div>
      <div class="card"><div class="sec-title">Mais vendidos</div><div class="rank">
        ${rankList(d.produtos_vendidos, x => x.quantidade + ' un.', x => 'Faturou ' + fmt(x.faturamento))}</div></div>
      <div class="card"><div class="sec-title">Mais lucrativos</div><div class="rank">
        ${rankList(d.ranking_lucrativos, x => fmt(x.lucro), x => x.quantidade + ' un. vendidas')}</div></div>
      <div class="card"><div class="sec-title">Melhores clientes</div><div class="rank">
        ${rankList(d.clientes_ranking, x => fmt(x.total_gasto), x => x.visitas + ' visita(s)')}</div></div>
      ${HORAS.length ? `<div class="card"><div class="sec-title">Faturamento por hora</div><div class="bars">
        ${HORAS.map(x => `<div class="bar-row"><span class="muted">${x.hora}h</span><div class="bar-track"><div class="bar-fill" style="width:${x.valor / maxHora * 100}%"></div></div><span>${fmt(x.valor)}</span></div>`).join('')}
      </div></div>` : ''}
      ${(d.estoque_critico && d.estoque_critico.length) ? `<div class="card"><div class="sec-title">Estoque crítico</div><div class="rank">
        ${d.estoque_critico.slice(0, 8).map(p => `<div class="rank-row"><span>${esc(p.nome)}</span><span class="low-txt">${p.estoque_atual} ${p.tipo_estoque === 'fracionado' ? 'fr.' : 'un.'}</span></div>`).join('')}</div></div>` : ''}
    </div>`;
}

// ══════════════════════════════════════════ INIT ══════════════════════════════
const BRAND = { name: 'Arena AMP', accent: '#FF7A1A', logo: '/static/logo.png' };
async function applyIdentity() {
  try {
    const id = await (await fetch('/api/identity')).json();
    if (id.accent) { document.documentElement.style.setProperty('--accent', id.accent); BRAND.accent = id.accent; }
    if (id.arena_name) { BRAND.name = id.arena_name; $('#brand-name').textContent = id.arena_name; }
    BRAND.logo = id.logo_url || '/static/logo.png';
    if (id.logo_url) { const l = $('#brand-logo'); l.src = id.logo_url; l.style.display = ''; }
  } catch (_) {}
}
(async function init() {
  await applyIdentity();
  try {
    [COMANDAS, PRODUTOS, CLIENTES, CATEGORIAS] = await Promise.all([
      apiGET('/comandas'), apiGET('/produtos'), apiGET('/clientes'), apiGET('/categorias'),
    ]);
    renderBoard(); renderEstoque(); renderClientes();
  } catch (e) { toast('Erro ao carregar: ' + e.message, 'err'); }
  loadCaixa();
  setInterval(renderBoard, 60000); // atualiza "elapsed"
})();
