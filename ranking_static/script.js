/**
 * ARENA AMP — Ranking (módulo do ecossistema)
 * Backend: Flask + SQLite (local). API sob /ranking.
 */

const API = '/ranking';

// ============================================================
// HELPERS GERAIS E API
// ============================================================
async function apiFetch(path, options = {}) {
    const res = await fetch(API + path, {
        headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        },
        cache: 'no-store',
        credentials: 'same-origin',
        ...options,
    });

    if (
        res.status === 401 &&
        !path.startsWith('/api/auth/login') &&
        !path.startsWith('/api/auth/me')
    ) {
        if (typeof window.showLoginGate === 'function') window.showLoginGate();
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail;
        const msg = Array.isArray(detail)
            ? detail.map((d) => d.msg || d).join(', ')
            : (detail || `Erro ${res.status}`);
        throw new Error(msg);
    }
    return res.json();
}

const apiGet    = p     => apiFetch(p);
const apiPost   = (p,b) => apiFetch(p, { method:'POST',   body:JSON.stringify(b) });
const apiPut    = (p,b) => apiFetch(p, { method:'PUT',    body:JSON.stringify(b) });
const apiPatch  = (p,b) => apiFetch(p, { method:'PATCH',  body:JSON.stringify(b) }); // <-- Correção Crítica Aqui
const apiDelete = p     => apiFetch(p, { method:'DELETE' });

const escapeHTML = (str) => {
    if (!str) return '';
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
};

// ============================================================
// MOTOR DO TORNEIO (Estado e Lógica)
// ============================================================
let CAMP = {
    id: null, 
    step: 'config',
    modalidade: 'Masculina',
    categoria: 'Iniciante',
    jogadores: [], 
    selecionados: [],
    rodadaF1: 1,
    jogosF1r1: [], jogosF1r2: [], jogosF2: [], jogosFinal: [],
    classificadosF2: [], finalistasF3: []
};

const PTS = {
    f1:    { vitoria:5,  derrota:2 },
    f2:    { vitoria:7,  derrota:3 },
    final: { vitoria:10, derrota:5 },
};

function salvarEstadoCamp() {
    localStorage.setItem('arena_amp_torneio', JSON.stringify(CAMP));
}

function recuperarEstadoCamp() {
    const salvo = localStorage.getItem('arena_amp_torneio');
    if (salvo) {
        try {
            CAMP = JSON.parse(salvo);
            return true;
        } catch(e) { console.error('Erro ao recuperar', e); }
    }
    return false;
}

function limparEstadoCamp() {
    localStorage.removeItem('arena_amp_torneio');
    CAMP = { id: null, step: 'config', modalidade: document.getElementById('camp-modalidade').value, categoria: document.getElementById('camp-categoria').value, jogadores: [], selecionados: [], rodadaF1: 1, jogosF1r1: [], jogosF1r2: [], jogosF2: [], jogosFinal: [], classificadosF2: [], finalistasF3: [] };
}

function calcBonus(placarStr, ganhou) {
    if (!placarStr) return 0;
    const isTB   = placarStr.toUpperCase().includes('TB');
    const partes = placarStr.replace(/TB/gi,'').split('-').map(Number);
    const menor  = Math.min(partes[0]||0, partes[1]||0);
    if (ganhou) {
        if (menor === 0) return 2;
        if (menor === 1) return 1;
        return 0;
    }
    return isTB ? 1 : 0;
}

function rankearJogadores(lista) {
    return [...lista].sort((a,b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.vitorias !== a.vitorias) return b.vitorias - a.vitorias;
        if ((b.saldoGames||0) !== (a.saldoGames||0)) return (b.saldoGames||0)-(a.saldoGames||0);
        if ((a.gamesSofridos||0) !== (b.gamesSofridos||0)) return (a.gamesSofridos||0)-(b.gamesSofridos||0);
        return ((b.confrontos&&b.confrontos[a.nome])||0) - ((a.confrontos&&a.confrontos[b.nome])||0);
    });
}

function shuffleArr(arr) {
    const a = [...arr];
    for (let i = a.length-1; i > 0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
}

function sortearDuplas(nomes) {
    const s = shuffleArr(nomes);
    const d = [];
    for (let i=0; i<s.length; i+=2) d.push([s[i], s[i+1]||null]);
    return d;
}

function gerarConfrontos(duplas, label) {
    const j = [];
    for (let i=0; i<duplas.length; i+=2) {
        if (duplas[i+1]) j.push({ id:`${label}-${i/2}`, dupla1:duplas[i], dupla2:duplas[i+1], placar:'', vencedoresDupla:null, concluido:false, idBD: null });
    }
    return j;
}

async function salvarJogosBackend(faseStr, jogosArray) {
    if (!CAMP.id) return;
    try {
        const payload = jogosArray.map(j => ({
            fase: faseStr,
            dupla1: j.dupla1.filter(Boolean),
            dupla2: j.dupla2.filter(Boolean)
        }));
        const criados = await apiPost(`/api/campeonatos/${CAMP.id}/jogos`, payload);
        jogosArray.forEach((j, idx) => {
            if(criados[idx]) j.idBD = criados[idx].id;
        });
        salvarEstadoCamp();
    } catch(e) { console.error('Erro ao registrar jogos no BD:', e); }
}

// ============================================================
// INICIALIZAÇÃO E UI GERAL
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {

    const themeEarly = localStorage.getItem('theme') || 'dark';
    document.body.classList.toggle('light-mode', themeEarly === 'light');

    const loginGate = document.getElementById('login-gate');
    const appShell  = document.querySelector('.app-shell');
    const loginForm = document.getElementById('login-form');
    const loginUser = document.getElementById('login-username');
    const loginPass = document.getElementById('login-password');
    const loginErr  = document.getElementById('login-error');

    async function refreshSession() {
        try {
            const r = await fetch(API + '/api/auth/me', {
                credentials: 'same-origin',
                cache: 'no-store',
            });
            if (!r.ok) return null;
            const ct = r.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return null;
            const data = await r.json();
            return data.user || null;
        } catch {
            return null;
        }
    }

    function showLoginGateFn() {
        if (loginGate) loginGate.classList.remove('hidden');
        if (appShell) appShell.classList.add('hidden');
    }
    function hideLoginGateFn() {
        if (loginGate) loginGate.classList.add('hidden');
        if (appShell) appShell.classList.remove('hidden');
    }
    window.showLoginGate = showLoginGateFn;

    let mainStarted = false;
    function startMainIfNeeded() {
        if (mainStarted) return;
        mainStarted = true;
        initMainApp();
    }

    let sessUser = null;
    try {
        sessUser = await refreshSession();
    } catch {
        sessUser = null;
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (loginErr) loginErr.textContent = '';
            const username = (loginUser && loginUser.value || '').trim();
            const password = (loginPass && loginPass.value) || '';
            if (!username || !password) {
                if (loginErr) loginErr.textContent = 'Preencha usuário e senha.';
                return;
            }
            try {
                await apiPost('/api/auth/login', { username, password });
                if (loginPass) loginPass.value = '';
                hideLoginGateFn();
                if (!mainStarted) startMainIfNeeded();
            } catch (err) {
                if (loginErr) loginErr.textContent = err.message || 'Falha no login.';
            }
        });
    }

    if (sessUser && sessUser.id != null) {
        hideLoginGateFn();
        startMainIfNeeded();
    } else {
        showLoginGateFn();
    }

    function initMainApp() {

    const body           = document.body;
    const themeToggle    = document.getElementById('theme-toggle');
    const toastContainer = document.getElementById('toast-container');

    const btnNovoJogador = document.getElementById('nav-novo-jogador-btn');
    const btnListaJog    = document.getElementById('nav-lista-jogadores-btn');

    function showToast(msg, type='success') {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':'fa-exclamation-circle'}"></i> ${escapeHTML(msg)}`;
        toastContainer.appendChild(t);
        setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(()=>t.remove(),300); }, 2800);
    }

    const confirmModal  = document.getElementById('modal-confirm');
    const confirmTitle  = document.getElementById('modal-confirm-title');
    const confirmMsg    = document.getElementById('modal-confirm-message');
    const confirmOk     = document.getElementById('modal-confirm-ok');
    const confirmCancel = document.getElementById('modal-confirm-cancel');
    const confirmClose  = document.getElementById('modal-confirm-close');

    function showConfirm({
        title = 'Arena AMP — Aviso',
        message = 'Deseja continuar?',
        confirmText = 'Confirmar',
        cancelText = 'Cancelar',
        danger = true
    } = {}) {
        return new Promise((resolve) => {
            confirmTitle.textContent = title;
            confirmMsg.textContent = message;
            confirmOk.textContent = confirmText;
            confirmCancel.textContent = cancelText;
            confirmOk.className = `btn ${danger ? 'btn-danger-ghost' : 'btn-primary'}`;

            const closeWith = (result) => {
                confirmModal.classList.remove('visible');
                confirmOk.removeEventListener('click', onOk);
                confirmCancel.removeEventListener('click', onCancel);
                confirmClose.removeEventListener('click', onCancel);
                confirmModal.removeEventListener('click', onBackdrop);
                resolve(result);
            };
            const onOk = () => closeWith(true);
            const onCancel = () => closeWith(false);
            const onBackdrop = (e) => { if (e.target === confirmModal) closeWith(false); };

            confirmOk.addEventListener('click', onOk);
            confirmCancel.addEventListener('click', onCancel);
            confirmClose.addEventListener('click', onCancel);
            confirmModal.addEventListener('click', onBackdrop);
            confirmModal.classList.add('visible');
        });
    }

    function setTema(t) {
        body.classList.toggle('light-mode', t==='light');
        themeToggle.checked = t==='light';
    }
    themeToggle.addEventListener('change', () => {
        const t = themeToggle.checked?'light':'dark';
        localStorage.setItem('theme', t);
        setTema(t);
    });
    setTema(localStorage.getItem('theme')||'dark');

    const btnUsuariosSite = document.getElementById('nav-usuarios-site-btn');
    const btnLogout       = document.getElementById('nav-logout-btn');
    const modalContas     = document.getElementById('modal-contas-site');
    const contasListEl    = document.getElementById('contas-site-list');
    const formNovaConta   = document.getElementById('form-nova-conta-site');
    const novaContaUser   = document.getElementById('nova-conta-username');
    const novaContaPass   = document.getElementById('nova-conta-password');

    async function carregarContasSite() {
        try {
            const list = await apiGet('/api/contas/');
            contasListEl.innerHTML = list.map((u) =>
                '<div class="conta-site-row" data-id="' + u.id + '">' +
                    '<div>' +
                        '<strong>' + escapeHTML(u.username) + '</strong>' +
                        '<span class="conta-site-meta">' + escapeHTML(u.created_at || '') + '</span>' +
                    '</div>' +
                    '<button type="button" class="btn btn-danger-ghost btn-sm btn-excluir-conta" data-id="' + u.id + '">' +
                        '<i class="fas fa-trash"></i></button>' +
                '</div>'
            ).join('');
            contasListEl.querySelectorAll('.btn-excluir-conta').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    const id = Number(btn.dataset.id);
                    const ok = await showConfirm({
                        title: 'Remover usuário',
                        message: 'Esta conta será removida. Continuar?',
                        danger: true
                    });
                    if (!ok) return;
                    try {
                        await apiDelete('/api/contas/' + id);
                        showToast('Usuário removido.');
                        const me = await refreshSession();
                        if (!me) {
                            showLoginGateFn();
                            return;
                        }
                        await carregarContasSite();
                    } catch (err) { showToast(err.message, 'error'); }
                });
            });
        } catch (err) { showToast(err.message, 'error'); }
    }

    if (btnUsuariosSite) btnUsuariosSite.addEventListener('click', () => {
        document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('visible'));
        modalContas.classList.add('visible');
        carregarContasSite();
    });

    formNovaConta.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = (novaContaUser.value || '').trim();
        const password = novaContaPass.value || '';
        if (!username || !password) return showToast('Preencha usuário e senha.', 'error');
        try {
            await apiPost('/api/contas/', { username, password });
            novaContaUser.value = '';
            novaContaPass.value = '';
            showToast('Usuário criado.');
            carregarContasSite();
        } catch (err) { showToast(err.message, 'error'); }
    });

    if (btnLogout) btnLogout.addEventListener('click', () => {
        window.location.href = '/logout';
    });

    document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const backdrop = e.target.closest('.modal-backdrop');
            if (backdrop) backdrop.classList.remove('visible');
        });
    });

    // ============================================================
    // JOGADORES (CRUD)
    // ============================================================
    let cacheJogadores = [];
    const modalJogador   = document.getElementById('modal-jogador');
    const formJogador    = document.getElementById('jogador-form');
    const modalJogTitle  = document.getElementById('modal-jogador-title');
    
    btnNovoJogador.addEventListener('click', () => {
        formJogador.reset();
        document.getElementById('edit-jogador-id').value = '';
        modalJogTitle.textContent = 'Cadastrar Novo Jogador';
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('visible'));
        modalJogador.classList.add('visible');
    });

    formJogador.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('j-nome').value.trim().toUpperCase();
        const id   = document.getElementById('edit-jogador-id').value;
        if (!nome) return showToast('Nome é obrigatório', 'error');

        const bodyData = {
            nome,
            modalidade: document.getElementById('j-modalidade').value,
            categoria: document.getElementById('j-categoria').value,
            idade: document.getElementById('j-idade').value,
            telefone: document.getElementById('j-telefone').value,
            pontuacao: 0, partidas: 0, vitorias: 0 
        };

        try {
            if (id) {
                await apiPut(`/api/jogadores/${id}`, bodyData);
                showToast('Jogador atualizado!');
            } else {
                await apiPost('/api/jogadores/', bodyData);
                showToast('Jogador cadastrado!');
            }
            modalJogador.classList.remove('visible');
            if (document.getElementById('modal-lista-jogadores').classList.contains('visible')) {
                carregarListaGeral();
            }
        } catch(err) { showToast(err.message, 'error'); }
    });

    const modalListaJog  = document.getElementById('modal-lista-jogadores');
    const tbodyListaJog  = document.getElementById('lista-jogadores-body');
    const searchLista    = document.getElementById('lista-search-input');
    const filtroModLista = document.getElementById('lista-modalidade-filter');
    const filtroCatLista = document.getElementById('lista-categoria-filter');

    btnListaJog.addEventListener('click', () => {
        modalListaJog.classList.add('visible');
        carregarListaGeral();
    });

    async function carregarListaGeral() {
        const loaderLista = document.getElementById('lista-loading');
        loaderLista.style.display = 'flex';
        try {
            const m = filtroModLista.value;
            const c = filtroCatLista.value;
            let res = await apiGet(`/api/jogadores/?modalidade=${m}&categoria=${encodeURIComponent(c)}`);
            
            if (res && !Array.isArray(res) && Array.isArray(res.data)) cacheJogadores = res.data;
            else if (Array.isArray(res)) cacheJogadores = res;
            else cacheJogadores = [];
            
            renderizarListaJogadores();
        } catch(e) { showToast('Erro: ' + e.message, 'error'); } 
        finally { loaderLista.style.display = 'none'; }
    }

    function renderizarListaJogadores() {
        const t = searchLista.value.toLowerCase().trim();
        const filtrados = cacheJogadores.filter(j => j.nome.toLowerCase().includes(t));

        tbodyListaJog.innerHTML = '';
        if (filtrados.length === 0) {
            tbodyListaJog.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:var(--c-muted)">Nenhum jogador encontrado.</td></tr>';
            return;
        }

        filtrados.forEach(j => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:600">${escapeHTML(j.nome)}</td>
                <td>${escapeHTML(j.modalidade)}</td>
                <td>${escapeHTML(j.categoria)}</td>
                <td class="col-actions"><button class="btn btn-ghost btn-sm btn-perfil"><i class="fas fa-eye"></i> Perfil</button></td>
            `;
            tr.querySelector('.btn-perfil').addEventListener('click', (e) => { e.stopPropagation(); abrirPerfilJogador(j); });
            tr.addEventListener('click', () => abrirPerfilJogador(j));
            tbodyListaJog.appendChild(tr);
        });
    }

    searchLista.addEventListener('input', renderizarListaJogadores);
    filtroModLista.addEventListener('change', renderizarListaJogadores);
    filtroCatLista.addEventListener('change', renderizarListaJogadores);

    // ============================================================
    // PERFIL E HISTÓRICO
    // ============================================================
    const modalPerfil = document.getElementById('modal-perfil-jogador');
    const perfilNome  = document.getElementById('perfil-nome');
    const perfilCat   = document.getElementById('perfil-categoria');
    const sumarioPerf = document.getElementById('perfil-stats-summary');
    const listHist    = document.getElementById('perfil-historico-list');

    let jogadorAberto = null;

    async function abrirPerfilJogador(j) {
        jogadorAberto = j;
        perfilNome.textContent = j.nome;
        perfilCat.textContent  = `${j.modalidade} · ${j.categoria}`;
        
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('visible'));
        modalPerfil.classList.add('visible');
        
        listHist.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
        sumarioPerf.innerHTML = '';

        try {
            let historico = await apiGet(`/api/campeonatos/historico/jogador?nome=${encodeURIComponent(j.nome)}`);
            if (historico && !Array.isArray(historico) && Array.isArray(historico.data)) historico = historico.data;
            else if (!Array.isArray(historico)) historico = [];
            
            renderizarHistorico(j.nome, historico);
        } catch(e) {
            listHist.innerHTML = `<p style="color:var(--c-red);text-align:center;padding:20px;">Erro ao buscar histórico: ${e.message}</p>`;
        }
    }

    function renderizarHistorico(nome, torneios) {
        let totalJogos = 0, totalVitorias = 0, totalPts = 0, titulos = 0;

        torneios.forEach(t => {
            totalJogos += t.jogos || 0;
            totalVitorias += t.vitorias || 0;
            totalPts += t.pts || 0;
            
            if (t.jogos_detalhes) {
                const ganhouFinal = t.jogos_detalhes.some(jd => 
                    jd.fase === 'final' && 
                    ((jd.vencedor_dupla === 1 && jd.dupla1.includes(nome)) || 
                     (jd.vencedor_dupla === 2 && jd.dupla2.includes(nome)))
                );
                if (ganhouFinal) titulos++;
            }
        });

        const aproveitamento = totalJogos > 0 ? Math.round((totalVitorias / totalJogos) * 100) : 0;

        sumarioPerf.innerHTML = `
            <div class="phs-card"><span class="phs-val">${torneios.length}</span><span class="phs-label">Torneios</span></div>
            <div class="phs-card win"><span class="phs-val">${titulos}</span><span class="phs-label">Títulos</span></div>
            <div class="phs-card pts"><span class="phs-val">${aproveitamento}%</span><span class="phs-label">Aproveit.</span></div>
            <div class="phs-card wr"><span class="phs-val">${totalPts}</span><span class="phs-label">Pts Totais</span></div>
        `;

        if (torneios.length === 0) {
            listHist.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-xmark"></i><p>Nenhuma participação oficial encontrada.</p></div>';
            return;
        }

        listHist.innerHTML = '';
        torneios.forEach(t => {
            const dStr = new Date(t.created_at).toLocaleDateString('pt-BR');
            const blk = document.createElement('div');
            blk.className = 'ph-day-block';

            blk.innerHTML = `
                <div class="ph-day-header" style="background:var(--c-surface2); padding:12px 16px; border-radius:8px; border:1px solid var(--c-border); margin-bottom:10px">
                    <div class="ph-day-info">
                        <strong style="color:var(--c-green); font-size:1.05rem;">🏆 Torneio ${escapeHTML(t.modalidade)} · ${escapeHTML(t.categoria)}</strong>
                        <span class="ph-day-date">${dStr}</span>
                    </div>
                    <div style="font-size:0.85rem; color:var(--c-text); margin-top:8px; display:flex; gap:16px">
                        <span><i class="fas fa-chart-line" style="color:var(--c-muted)"></i> Campanha: <strong>${t.vitorias}V / ${t.jogos - t.vitorias}D</strong></span>
                        <span><i class="fas fa-star" style="color:var(--c-gold)"></i> <strong>${t.pts} pts</strong> ganhos</span>
                    </div>
                </div>
            `;

            if (t.jogos_detalhes && t.jogos_detalhes.length > 0) {
                const matchesContainer = document.createElement('div');
                matchesContainer.style.paddingLeft = '14px';
                matchesContainer.style.borderLeft = '2px solid var(--c-border2)';
                matchesContainer.style.display = 'flex';
                matchesContainer.style.flexDirection = 'column';
                matchesContainer.style.gap = '8px';

                t.jogos_detalhes.forEach(jd => {
                    const isDupla1 = jd.dupla1.includes(nome);
                    const parceiro = isDupla1 ? jd.dupla1.find(n => n !== nome) : jd.dupla2.find(n => n !== nome);
                    const advs     = isDupla1 ? jd.dupla2 : jd.dupla1;
                    const ganhou   = (isDupla1 && jd.vencedor_dupla === 1) || (!isDupla1 && jd.vencedor_dupla === 2);

                    const card = document.createElement('div');
                    card.className = `ph-card ${ganhou?'ph-win':'ph-loss'}`;
                    card.style.padding = '12px';
                    card.innerHTML = `
                        <div class="ph-result-badge ${ganhou?'win':'loss'}">${ganhou?'V':'D'}</div>
                        <div class="ph-main">
                            <div class="ph-opponent" style="font-size:0.9rem">
                                <span class="ph-label">vs</span> <strong>${escapeHTML(advs.join(' & '))}</strong>
                                ${parceiro ? `<span class="ph-partner" style="font-size:0.75rem">com <strong>${escapeHTML(parceiro)}</strong></span>` : ''}
                            </div>
                            <div class="ph-meta" style="margin-top:4px">
                                <span class="ph-tag" style="background:var(--c-surface2);color:var(--c-text)">${escapeHTML(jd.fase).replace('_', ' ').toUpperCase()}</span>
                                ${jd.placar ? `<span class="ph-score" style="margin-left:8px; color:var(--c-text)">📊 ${escapeHTML(jd.placar)}</span>` : ''}
                            </div>
                        </div>
                    `;
                    matchesContainer.appendChild(card);
                });
                blk.appendChild(matchesContainer);
            }
            listHist.appendChild(blk);
        });
    }

    document.getElementById('perfil-editar-btn').addEventListener('click', () => {
        if (!jogadorAberto) return;
        document.getElementById('edit-jogador-id').value = jogadorAberto.id;
        document.getElementById('j-nome').value = jogadorAberto.nome;
        document.getElementById('j-modalidade').value = jogadorAberto.modalidade;
        document.getElementById('j-categoria').value = jogadorAberto.categoria;
        document.getElementById('j-idade').value = jogadorAberto.idade || '';
        document.getElementById('j-telefone').value = jogadorAberto.telefone || '';
        modalJogTitle.textContent = `Editar · ${jogadorAberto.nome}`;
        
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('visible'));
        document.getElementById('modal-jogador').classList.add('visible');
    });

    document.getElementById('perfil-reset-historico-btn').addEventListener('click', async () => {
        if (!jogadorAberto || !jogadorAberto.id) return;
        const confirmaReset = await showConfirm({
            title: 'Arena AMP — Aviso',
            message: `ATENÇÃO: Você está prestes a ZERAR o histórico de ${jogadorAberto.nome}.\n\nIsso limpará os pontos globais do ranking e apagará todos os registros de partidas passadas. Deseja continuar?`,
            confirmText: 'Sim, resetar',
            cancelText: 'Cancelar',
            danger: true
        });
        if (!confirmaReset) return;

        const btn = document.getElementById('perfil-reset-historico-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Zerando...';

        try {
            // 1. Monta payload completo que o modelo Pydantic exige (todos os campos obrigatórios)
            const payload = {
                nome:       jogadorAberto.nome,
                modalidade: jogadorAberto.modalidade,
                categoria:  jogadorAberto.categoria,
                pontuacao:  0,
                partidas:   0,
                vitorias:   0,
                idade:      jogadorAberto.idade  || null,
                telefone:   jogadorAberto.telefone || null,
            };
            await apiPut(`/api/jogadores/${jogadorAberto.id}`, payload);

            // 2. Apaga as vinculações do jogador aos torneios passados (pela rota /historico)
            await apiDelete(`/api/jogadores/${jogadorAberto.id}/historico`);

            showToast('Estatísticas e histórico zerados com sucesso!');

            // 3. Atualiza o objeto local para refletir o zero
            jogadorAberto.pontuacao = 0;
            jogadorAberto.partidas  = 0;
            jogadorAberto.vitorias  = 0;

            // 4. Recarrega o perfil já zerado
            abrirPerfilJogador(jogadorAberto);

            if (document.getElementById('modal-lista-jogadores').classList.contains('visible')) {
                carregarListaGeral();
            }
        } catch(e) {
            showToast('Erro ao resetar: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rotate-left"></i> Resetar';
        }
    });

    document.getElementById('perfil-excluir-btn').addEventListener('click', async () => {
        if (!jogadorAberto) return;
        const confirmaExclusao = await showConfirm({
            title: 'Arena AMP — Aviso',
            message: `Tem certeza que deseja EXCLUIR ${jogadorAberto.nome}?`,
            confirmText: 'Sim, excluir',
            cancelText: 'Cancelar',
            danger: true
        });
        if (!confirmaExclusao) return;
        try {
            await apiDelete(`/api/jogadores/${jogadorAberto.id}`);
            showToast('Jogador excluído');
            document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('visible'));
            carregarListaGeral();
        } catch(e) { showToast(e.message, 'error'); }
    });

    // ============================================================
    // FLUXO DO TORNEIO
    // ============================================================
    const campGrid     = document.getElementById('camp-players-grid');
    const campCount    = document.getElementById('camp-player-count');
    const campStartBtn = document.getElementById('camp-start-btn');
    
    const steps = {
        config: document.getElementById('camp-step-config'),
        fase1:  document.getElementById('camp-step-fase1'),
        fase2:  document.getElementById('camp-step-fase2'),
        final:  document.getElementById('camp-step-final'),
        podio:  document.getElementById('camp-step-podio')
    };

    function irParaStep(stepKey) {
        CAMP.step = stepKey;
        Object.values(steps).forEach(el => el.classList.add('hidden'));
        steps[stepKey].classList.remove('hidden');
        salvarEstadoCamp();

        const btnCancelar = document.getElementById('nav-cancelar-torneio-btn');
        if (btnCancelar) {
            const torneioIniciado = Boolean(CAMP.id);
            if (!torneioIniciado || stepKey === 'config' || stepKey === 'podio') {
                btnCancelar.classList.add('hidden');
            } else {
                btnCancelar.classList.remove('hidden');
            }
        }
    }

    // ============================================================
    // BOTÃO CANCELAR TORNEIO — CORRIGIDO
    // O problema original: o if(btnCancelarOriginal){} estava
    // FORA do DOMContentLoaded, então o botão clonado perdia
    // referência ao escopo de showToast, irParaStep, etc.
    // ============================================================
    const btnCancelarTorneio = document.getElementById('nav-cancelar-torneio-btn');

    if (btnCancelarTorneio) {
        btnCancelarTorneio.addEventListener('click', async () => {
            const confirmacao = await showConfirm({
                title: 'Arena AMP — Aviso',
                message: 'ATENÇÃO: Deseja realmente CANCELAR este torneio?\n\nEsta ação apagará todos os jogos e voltará ao início.',
                confirmText: 'Cancelar Torneio',
                cancelText: 'Voltar',
                danger: true
            });
            if (!confirmacao) return;

            const textoOriginal = btnCancelarTorneio.innerHTML;
            btnCancelarTorneio.disabled = true;
            btnCancelarTorneio.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelando...';

            try {
                if (CAMP.id) {
                    await apiDelete(`/api/campeonatos/${CAMP.id}`);
                    showToast('Torneio cancelado e apagado do sistema!', 'success');
                }
            } catch(e) {
                console.warn('Erro ao deletar no backend:', e.message);
                showToast('Aviso: erro no servidor, mas a tela foi limpa.', 'error');
            } finally {
                limparEstadoCamp();
                irParaStep('config');

                const grid = document.getElementById('camp-players-grid');
                if (grid) grid.innerHTML = '';

                const count = document.getElementById('camp-player-count');
                if (count) { count.textContent = '0/12'; count.className = 'camp-count-badge'; }

                const startBtn = document.getElementById('camp-start-btn');
                if (startBtn) {
                    startBtn.disabled = true;
                    startBtn.innerHTML = '<i class="fas fa-play"></i> Selecione 12 jogadores para iniciar';
                }

                setTimeout(() => {
                    const btnLoad = document.getElementById('camp-load-players-btn');
                    if (btnLoad) btnLoad.click();
                }, 300);

                btnCancelarTorneio.innerHTML = textoOriginal;
                btnCancelarTorneio.disabled = false;
            }
        });
    }

    document.getElementById('camp-load-players-btn').addEventListener('click', async () => {
        campGrid.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
        try {
            const m = document.getElementById('camp-modalidade').value;
            const c = document.getElementById('camp-categoria').value;
            CAMP.modalidade = m; CAMP.categoria = c;
            
            let dados = await apiGet(`/api/jogadores/?modalidade=${m}&categoria=${encodeURIComponent(c)}`);
            if (dados && !Array.isArray(dados) && Array.isArray(dados.data)) dados = dados.data;
            
            CAMP.selecionados = [];
            renderGridSelecao(dados);
        } catch(e) {
            campGrid.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Erro ao carregar</p></div>';
            showToast('Erro ao carregar base', 'error');
        }
    });

    document.getElementById('camp-deselect-btn').addEventListener('click', () => {
        CAMP.selecionados = [];
        document.querySelectorAll('.camp-player-chip').forEach(c => c.classList.remove('selected'));
        atualizarCountTorneio();
    });

    function renderGridSelecao(lista) {
        campGrid.innerHTML = '';
        if (!lista.length) {
            campGrid.innerHTML = `<div class="empty-state"><i class="fas fa-user-xmark"></i><p>Nenhum jogador nesta categoria.</p></div>`;
            return;
        }
        const ordenados = [...lista].sort((a,b) => (b.pontuacao||0) - (a.pontuacao||0));
        ordenados.forEach(j => {
            const chip = document.createElement('div');
            chip.className = 'camp-player-chip';
            chip.innerHTML = `
                <div class="chip-check"><i class="fas fa-check" style="font-size:0.55rem"></i></div>
                <div class="chip-name">${escapeHTML(j.nome)}</div>
                <div class="chip-pts">Rank Pts: ${j.pontuacao || 0}</div>
            `;
            chip.addEventListener('click', () => {
                const idx = CAMP.selecionados.indexOf(j.nome);
                if (idx === -1) {
                    if (CAMP.selecionados.length >= 12) return showToast('Máximo de 12 atingido', 'error');
                    CAMP.selecionados.push(j.nome);
                    chip.classList.add('selected');
                } else {
                    CAMP.selecionados.splice(idx, 1);
                    chip.classList.remove('selected');
                }
                atualizarCountTorneio();
            });
            campGrid.appendChild(chip);
        });
        atualizarCountTorneio();
    }

    function atualizarCountTorneio() {
        const n = CAMP.selecionados.length;
        campCount.textContent = `${n}/12`;
        campCount.className   = `camp-count-badge${n===12?' full':''}`;
        campStartBtn.disabled = n !== 12;
        campStartBtn.innerHTML = n === 12 ? '<i class="fas fa-play"></i> Iniciar Torneio Agora' : `<i class="fas fa-play"></i> Selecione mais ${12-n} jogadores`;
    }

    campStartBtn.addEventListener('click', async () => {
        if (CAMP.selecionados.length !== 12) return;
        campStartBtn.disabled = true;
        try {
            const resBD = await apiPost('/api/campeonatos/', {
                modalidade: CAMP.modalidade,
                categoria: CAMP.categoria,
                jogadores: CAMP.selecionados
            });
            CAMP.id = resBD.id; 
            CAMP.jogadores = CAMP.selecionados.map(nome => ({ nome, pts:0, vitorias:0, jogos:0, saldoGames:0, gamesSofridos:0, confrontos:{} }));
            CAMP.rodadaF1 = 1;
            
            salvarEstadoCamp();
            iniciarF1(1);
        } catch(e) {
            showToast('Erro ao criar torneio: ' + e.message, 'error');
            campStartBtn.disabled = false;
        }
    });

    function restaurarView(fase) {
        if (fase === 'fase1') {
            document.getElementById('camp-f1-subtitle').textContent = `Rodada ${CAMP.rodadaF1} de 2 · 6 duplas`;
            const jogos = CAMP.rodadaF1 === 1 ? CAMP.jogosF1r1 : CAMP.jogosF1r2;
            renderJogos('camp-f1-jogos', jogos, 'fase1');
            renderRanking('camp-f1-ranking', CAMP.jogadores, 12);
            verificarConclusaoFase('fase1');
        } else if (fase === 'fase2') {
            renderJogos('camp-f2-jogos', CAMP.jogosF2, 'fase2');
            renderRanking('camp-f2-ranking', CAMP.jogadores.filter(j=>CAMP.classificadosF2.includes(j.nome)), 8);
            verificarConclusaoFase('fase2');
        } else if (fase === 'final') {
            renderJogos('camp-final-jogos', CAMP.jogosFinal, 'final');
            renderRanking('camp-final-ranking', CAMP.jogadores.filter(j=>CAMP.finalistasF3.includes(j.nome)), 4);
            verificarConclusaoFase('final');
        } else if (fase === 'podio') {
            renderPodio();
        }
    }

    async function iniciarF1(rodada) {
        CAMP.rodadaF1 = rodada;
        document.getElementById('camp-f1-subtitle').textContent = `Rodada ${rodada} de 2 · 6 duplas`;
        const duplas = sortearDuplas(CAMP.jogadores.map(j=>j.nome));
        const jogos  = gerarConfrontos(duplas, `f1r${rodada}`);
        
        await salvarJogosBackend(`fase1_r${rodada}`, jogos);
        if (rodada === 1) CAMP.jogosF1r1 = jogos; else CAMP.jogosF1r2 = jogos;
        
        document.getElementById('camp-f1-proxima-btn').classList.add('hidden');
        document.getElementById('camp-f1-avancar-btn').classList.add('hidden');
        irParaStep('fase1');
        restaurarView('fase1');
    }

    document.getElementById('camp-f1-sortear-btn').addEventListener('click', () => iniciarF1(CAMP.rodadaF1));
    document.getElementById('camp-f1-proxima-btn').addEventListener('click', () => iniciarF1(2));
    
    // --- CORREÇÃO: AVANÇAR PARA QUARTAS (PATCH) ---
    document.getElementById('camp-f1-avancar-btn').addEventListener('click', async () => {
        const btn = document.getElementById('camp-f1-avancar-btn');
        btn.disabled = true;
        try {
            CAMP.classificadosF2 = rankearJogadores(CAMP.jogadores).slice(0,8).map(j=>j.nome);
            // MUDOU PARA apiPut AQUI:
            await apiPut(`/api/campeonatos/${CAMP.id}/fase`, { fase: 'fase2' });
            iniciarF2();
        } catch(e) {
            showToast('Erro ao avançar: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    });

    async function iniciarF2() {
        const duplas = sortearDuplas(CAMP.classificadosF2);
        const jogos = gerarConfrontos(duplas,'f2');
        
        await salvarJogosBackend('quartas', jogos);
        CAMP.jogosF2 = jogos;
        
        document.getElementById('camp-f2-avancar-btn').classList.add('hidden');
        irParaStep('fase2');
        restaurarView('fase2');
    }

    document.getElementById('camp-f2-sortear-btn').addEventListener('click', iniciarF2);
    
    // --- CORREÇÃO: AVANÇAR PARA FINAL (PATCH) ---
    document.getElementById('camp-f2-avancar-btn').addEventListener('click', async () => {
        const btn = document.getElementById('camp-f2-avancar-btn');
        btn.disabled = true;
        try {
            CAMP.finalistasF3 = rankearJogadores(CAMP.jogadores.filter(j=>CAMP.classificadosF2.includes(j.nome))).slice(0,4).map(j=>j.nome);
            // MUDOU PARA apiPut AQUI TAMBÉM:
            await apiPut(`/api/campeonatos/${CAMP.id}/fase`, { fase: 'final' });
            iniciarFinal();
        } catch(e) {
            showToast('Erro ao avançar: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    });

    async function iniciarFinal() {
        const duplas = sortearDuplas(CAMP.finalistasF3);
        const jogos = gerarConfrontos(duplas,'final');
        
        await salvarJogosBackend('final', jogos);
        CAMP.jogosFinal = jogos;
        
        document.getElementById('camp-final-encerrar-btn').classList.add('hidden');
        irParaStep('final');
        restaurarView('final');
    }

    document.getElementById('camp-final-sortear-btn').addEventListener('click', iniciarFinal);
    document.getElementById('camp-final-encerrar-btn').addEventListener('click', async () => {
        try {
            await apiPost(`/api/campeonatos/${CAMP.id}/encerrar`, {});
        } catch(e) { console.error('Erro ao encerrar BD', e); }
        irParaStep('podio');
        renderPodio();
        showToast('Torneio Encerrado e Salvo no Histórico!');
    });

    function renderJogos(containerId, jogos, faseId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        jogos.forEach((jogo, idx) => {
            const card = document.createElement('div');
            card.className = `camp-jogo-card${jogo.concluido?' concluido':''}`;
            const d1 = jogo.dupla1.filter(Boolean).join(' & ');
            const d2 = jogo.dupla2.filter(Boolean).join(' & ');
            card.innerHTML = `
                <div class="camp-jogo-num">${idx+1}</div>
                <div class="camp-jogo-matchup">
                    <div class="camp-jogo-dupla">${escapeHTML(d1)}</div>
                    <div class="camp-jogo-dupla"><span class="vs-mini">vs</span> ${escapeHTML(d2)}</div>
                </div>
                <div class="camp-jogo-placar">${jogo.concluido ? escapeHTML(jogo.placar) : '—'}</div>
                <div class="camp-jogo-status">
                    <span class="camp-status-badge ${jogo.concluido?'concluido':'pendente'}">
                        ${jogo.concluido?'✓ OK':'Pendente'}
                    </span>
                </div>`;
            
            if (!jogo.concluido) {
                card.addEventListener('click', () => abrirModalResultado(jogo, faseId));
            }
            container.appendChild(card);
        });
    }

    function renderRanking(containerId, listaRef, limit) {
        const container = document.getElementById(containerId);
        const ranked = rankearJogadores(listaRef);
        const corte  = limit === 12 ? 8 : limit === 8 ? 4 : 2;
        container.innerHTML = '';
        
        ranked.forEach((j, idx) => {
            const pos = idx + 1;
            const row = document.createElement('div');
            row.className = `camp-rank-row ${pos <= corte ? 'classificado' : 'eliminado'}`;
            row.innerHTML = `
                <div class="camp-rank-pos">${pos}º</div>
                <div class="camp-rank-nome">${escapeHTML(j.nome)}</div>
                <div class="camp-rank-pts">${j.pts} pts</div>
                <div style="font-size:0.75rem">${pos <= corte ? '✅' : '❌'}</div>`;
            container.appendChild(row);
        });
    }

    const modalResultado   = document.getElementById('modal-resultado');
    const resPlacar        = document.getElementById('resultado-placar');
    const resVencedor      = document.getElementById('resultado-vencedor');
    const resPreview       = document.getElementById('resultado-bonus-preview');
    const btnConfirmarRes  = document.getElementById('resultado-confirmar-btn');

    let jogoAbertoCtx = null;
    let faseAbertaCtx = null;

    function abrirModalResultado(jogo, fase) {
        jogoAbertoCtx = jogo; 
        faseAbertaCtx = fase;
        const d1 = jogo.dupla1.filter(Boolean).join(' & ');
        const d2 = jogo.dupla2.filter(Boolean).join(' & ');
        
        document.getElementById('resultado-matchup').innerHTML = `<strong>${escapeHTML(d1)}</strong><span class="vs-text">VS</span><strong>${escapeHTML(d2)}</strong>`;
        resVencedor.innerHTML = `<option value="">Selecione a dupla vencedora...</option><option value="1">🏆 ${escapeHTML(d1)}</option><option value="2">🏆 ${escapeHTML(d2)}</option>`;
        resPlacar.value = '';
        resPreview.innerHTML = '<span style="color:var(--c-muted);font-size:0.8rem">Digite o placar e selecione o vencedor para ver os pontos.</span>';
        
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('visible'));
        modalResultado.classList.add('visible');
        resPlacar.focus();
    }

    function atualizarPreview() {
        const placar = resPlacar.value.trim();
        const winner = resVencedor.value;
        if (!placar || !winner || !jogoAbertoCtx) return;
        
        const ptsFase = faseAbertaCtx === 'fase1' ? PTS.f1 : faseAbertaCtx === 'fase2' ? PTS.f2 : PTS.final;
        const bV = calcBonus(placar,true);
        const bP = calcBonus(placar,false);
        const d1 = jogoAbertoCtx.dupla1.filter(Boolean).join(' & ');
        const d2 = jogoAbertoCtx.dupla2.filter(Boolean).join(' & ');
        const vLabel = winner === '1' ? d1 : d2;
        const pLabel = winner === '1' ? d2 : d1;
        
        resPreview.innerHTML = `
            <div class="bonus-item"><span>🏆 ${escapeHTML(vLabel)}</span><span class="bonus-val pos">+${ptsFase.vitoria+bV} pts${bV>0?` (+${bV} bônus)`:''}</span></div>
            <div class="bonus-item"><span>❌ ${escapeHTML(pLabel)}</span><span class="bonus-val neu">+${ptsFase.derrota+bP} pts${bP>0?` (+${bP} TB)`:''}</span></div>
        `;
    }

    resPlacar.addEventListener('input', atualizarPreview);
    resVencedor.addEventListener('change', atualizarPreview);

    btnConfirmarRes.addEventListener('click', async () => {
        const placar = resPlacar.value.trim();
        const winner = resVencedor.value;
        if (!placar) return showToast('Digite o placar.', 'error');
        if (!winner) return showToast('Selecione o vencedor.', 'error');

        btnConfirmarRes.disabled = true;

        const jogo = jogoAbertoCtx;
        const ptsFase = faseAbertaCtx === 'fase1' ? PTS.f1 : faseAbertaCtx === 'fase2' ? PTS.f2 : PTS.final;
        const bV = calcBonus(placar,true);
        const bP = calcBonus(placar,false);
        const dupVen  = winner === '1' ? jogo.dupla1 : jogo.dupla2;
        const dupPerd = winner === '1' ? jogo.dupla2 : jogo.dupla1;
        
        const partes = placar.replace(/TB/gi,'').split('-').map(Number);
        const gV = Math.max(partes[0]||0, partes[1]||0);
        const gP = Math.min(partes[0]||0, partes[1]||0);

        const atualizacoesBD = [];

        dupVen.filter(Boolean).forEach(nome => {
            const j = CAMP.jogadores.find(x=>x.nome===nome); if(!j) return;
            const ptsGanhos = ptsFase.vitoria + bV;
            j.pts += ptsGanhos; j.vitorias += 1; j.jogos += 1;
            j.saldoGames = (j.saldoGames||0) + gV - gP;
            j.gamesSofridos = (j.gamesSofridos||0) + gP;
            dupPerd.filter(Boolean).forEach(op=>{ j.confrontos[op] = (j.confrontos[op]||0) + 1; });
            
            atualizacoesBD.push({ nome: nome, pts_delta: ptsGanhos, vitorias_delta: 1, jogos_delta: 1, saldo_delta: gV - gP, sofridos_delta: gP });
        });
        
        dupPerd.filter(Boolean).forEach(nome => {
            const j = CAMP.jogadores.find(x=>x.nome===nome); if(!j) return;
            const ptsGanhos = ptsFase.derrota + bP;
            j.pts += ptsGanhos; j.jogos += 1;
            j.saldoGames = (j.saldoGames||0) + gP - gV;
            j.gamesSofridos = (j.gamesSofridos||0) + gV;
            
            atualizacoesBD.push({ nome: nome, pts_delta: ptsGanhos, vitorias_delta: 0, jogos_delta: 1, saldo_delta: gP - gV, sofridos_delta: gV });
        });

        jogo.placar = placar;
        jogo.vencedoresDupla = parseInt(winner);
        jogo.concluido = true;

        try {
            if (CAMP.id && jogo.idBD) {
                await apiPost(`/api/campeonatos/${CAMP.id}/jogos/${jogo.idBD}/resultado`, {
                    placar: placar,
                    vencedor_dupla: parseInt(winner),
                    atualizacoes: atualizacoesBD
                });
            }
            salvarEstadoCamp();
            modalResultado.classList.remove('visible');
            restaurarView(faseAbertaCtx);
            showToast('Resultado registrado!');
        } catch(e) {
            showToast('Erro ao salvar no BD: ' + e.message, 'error');
        } finally {
            btnConfirmarRes.disabled = false;
        }
    });

    function verificarConclusaoFase(faseStr) {
        if (faseStr === 'fase1') {
            const jogos = CAMP.rodadaF1 === 1 ? CAMP.jogosF1r1 : CAMP.jogosF1r2;
            const todosFeitos = jogos.every(j => j.concluido);
            if (todosFeitos && CAMP.rodadaF1 === 1) document.getElementById('camp-f1-proxima-btn').classList.remove('hidden');
            if (todosFeitos && CAMP.rodadaF1 === 2) document.getElementById('camp-f1-avancar-btn').classList.remove('hidden');
        } else if (faseStr === 'fase2') {
            if (CAMP.jogosF2.every(j => j.concluido)) document.getElementById('camp-f2-avancar-btn').classList.remove('hidden');
        } else if (faseStr === 'final') {
            if (CAMP.jogosFinal.every(j => j.concluido)) document.getElementById('camp-final-encerrar-btn').classList.remove('hidden');
        }
    }

    // --- PÓDIO ---
    function renderPodio() {
        const ranked = rankearJogadores(CAMP.jogadores);
        const top3   = ranked.slice(0,3);
        const display = document.getElementById('camp-podio-display');
        display.innerHTML = '';
        
        const ordem = [1,0,2];
        const classes = ['segundo','primeiro','terceiro'];
        const medalhas = ['🥈','🥇','🥉'];
        const nums = ['2º','1º','3º'];

        ordem.forEach((ri,vi) => {
            const j = top3[ri]; if(!j) return;
            const div = document.createElement('div');
            div.className = `camp-podio-item ${classes[vi]}`;
            div.innerHTML = `
                <div class="camp-podio-medal">${medalhas[vi]}</div>
                <div class="camp-podio-nome">${escapeHTML(j.nome)}</div>
                <div class="camp-podio-pts">${j.pts} pts</div>
                <div class="camp-podio-base">${nums[vi]}</div>`;
            display.appendChild(div);
        });

        const listFull = document.getElementById('camp-ranking-completo');
        listFull.innerHTML = '';
        ranked.forEach((j,idx) => {
            const pos = idx+1;
            const row = document.createElement('div');
            row.className = 'camp-rank-row';
            const posClass = pos===1?'gold':pos===2?'silver':pos===3?'bronze':'';
            row.innerHTML = `
                <div class="camp-rank-pos ${posClass}">${pos}º</div>
                <div class="camp-rank-nome" style="font-weight:600">${escapeHTML(j.nome)}</div>
                <div class="camp-rank-pts">${j.pts} pts</div>
                <div style="font-size:0.75rem;color:var(--c-muted)">${j.vitorias}V - ${j.jogos-j.vitorias}D</div>`;
            listFull.appendChild(row);
        });
    }

    document.getElementById('camp-novo-btn').addEventListener('click', () => {
        limparEstadoCamp();
        irParaStep('config');
        document.getElementById('camp-load-players-btn').click(); 
    });

    // ============================================================

    // ============================================================
    // PAINEL TV — REDESIGN PREMIUM COMPLETO
    // ============================================================
    const btnPainelTVOriginal = document.getElementById('nav-tela-cheia-btn');
    if (!btnPainelTVOriginal) return;
    const btnPainelTV = btnPainelTVOriginal.cloneNode(true);
    btnPainelTVOriginal.replaceWith(btnPainelTV);

    btnPainelTV.addEventListener('click', () => {
        const campSalvo = localStorage.getItem('arena_amp_torneio');
        if (!campSalvo) return showToast('Nenhum torneio ativo para exibir.', 'error');

        const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AO VIVO — Arena AMP</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700;800&family=DM+Sans:wght@400;500;700&display=swap">
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"><\/script>
<style>
:root {
    --bg: #07090d;
    --surface: rgba(255,255,255,0.04);
    --surface2: rgba(255,255,255,0.07);
    --border: rgba(255,255,255,0.08);
    --border2: rgba(255,255,255,0.14);
    --text: #f0f4ff;
    --muted: rgba(200,210,240,0.5);
    --green: #00e676;
    --green-glow: rgba(0,230,118,0.25);
    --gold: #FFD700;
    --silver: #C8D6E5;
    --bronze: #E07B39;
    --red: #ff4d6d;
    --font-disp: 'Bebas Neue', sans-serif;
    --font-cond: 'Barlow Condensed', sans-serif;
    --font-body: 'DM Sans', sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{
    font-family:var(--font-body);
    background:var(--bg);
    color:var(--text);
    display:flex;
    flex-direction:column;
    position:relative;
}
/* Fundo animado */
.bg-grid{
    position:fixed;inset:0;z-index:0;
    background-image:
        linear-gradient(rgba(0,230,118,0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,230,118,0.03) 1px, transparent 1px);
    background-size:60px 60px;
    animation:gridMove 20s linear infinite;
}
.bg-radial{
    position:fixed;inset:0;z-index:0;
    background:radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,230,118,0.08), transparent);
}
@keyframes gridMove{to{background-position:60px 60px}}

/* HEADER */
.tv-header{
    position:relative;z-index:10;
    display:flex;justify-content:space-between;align-items:center;
    padding:18px 48px;
    border-bottom:1px solid var(--border2);
    background:rgba(7,9,13,0.9);
    backdrop-filter:blur(20px);
    flex-shrink:0;
}
.tv-logo{display:flex;align-items:center;gap:16px}
.tv-logo-image{
    width:56px;
    height:56px;
    object-fit:contain;
    filter:drop-shadow(0 6px 14px rgba(0,230,118,0.22));
    flex-shrink:0;
}
.tv-logo-mark{
    font-family:var(--font-disp);font-size:2.8rem;letter-spacing:2px;line-height:1;
}
.tv-logo-mark span{color:var(--green)}
.tv-logo-cat{
    display:flex;flex-direction:column;gap:2px;
    border-left:2px solid var(--border2);padding-left:16px;
}
.tv-logo-cat .cat-label{font-size:0.65rem;font-weight:700;letter-spacing:0.12em;color:var(--muted);text-transform:uppercase}
.tv-logo-cat .cat-val{font-family:var(--font-cond);font-size:1.15rem;font-weight:700;letter-spacing:0.05em;color:var(--text)}
.tv-header-right{display:flex;align-items:center;gap:20px}
.tv-clock{font-family:var(--font-disp);font-size:2rem;letter-spacing:2px;color:var(--muted)}
.live-pill{
    display:flex;align-items:center;gap:8px;
    padding:8px 20px;border-radius:6px;
    background:var(--red);color:#fff;
    font-family:var(--font-cond);font-size:1.1rem;font-weight:800;letter-spacing:0.1em;
    animation:pulseLive 2s infinite;
}
.live-dot{width:8px;height:8px;border-radius:50%;background:#fff;animation:dotBlink 1s infinite}
@keyframes pulseLive{0%,100%{box-shadow:0 0 0 0 rgba(255,77,109,0.6)}70%{box-shadow:0 0 0 12px rgba(255,77,109,0)}}
@keyframes dotBlink{0%,100%{opacity:1}50%{opacity:0.3}}

/* Pill de fase */
.tv-fase-pill{
    font-family:var(--font-cond);font-size:0.95rem;font-weight:700;letter-spacing:0.08em;
    padding:6px 16px;border-radius:99px;
    background:var(--surface2);border:1px solid var(--border2);color:var(--muted);
}

/* LAYOUT PRINCIPAL */
.tv-body{
    position:relative;z-index:10;
    display:grid;grid-template-columns:1fr 1.6fr;
    gap:24px;flex:1;min-height:0;
    padding:24px 48px;
}

/* PAINÉIS */
.tv-panel{
    background:var(--surface);border:1px solid var(--border);
    border-radius:16px;
    display:flex;flex-direction:column;
    overflow:hidden;
}
.tv-panel-head{
    display:flex;justify-content:space-between;align-items:center;
    padding:16px 24px;
    border-bottom:1px solid var(--border);
    background:var(--surface2);
    flex-shrink:0;
}
.tv-panel-title{
    font-family:var(--font-cond);font-size:1rem;font-weight:800;
    letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);
}
.tv-panel-count{
    font-family:var(--font-disp);font-size:1.4rem;letter-spacing:1px;color:var(--green);
}
.tv-panel-body{
    flex:1;overflow-y:auto;padding:12px;
    display:flex;flex-direction:column;gap:8px;
}
.tv-panel-body::-webkit-scrollbar{width:4px}
.tv-panel-body::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}

/* RANKING */
.rank-row{
    display:grid;grid-template-columns:52px 1fr auto;
    align-items:center;gap:12px;
    padding:12px 16px;border-radius:10px;
    background:var(--surface);border:1px solid var(--border);
    transition:background 0.3s;
    animation:rowIn 0.3s ease both;
}
.rank-row.top{background:rgba(0,230,118,0.06);border-color:rgba(0,230,118,0.2)}
.rank-row.gold{background:rgba(255,215,0,0.07);border-color:rgba(255,215,0,0.25)}
.rank-row.silver{background:rgba(200,214,229,0.05);border-color:rgba(200,214,229,0.2)}
.rank-row.bronze{background:rgba(224,123,57,0.06);border-color:rgba(224,123,57,0.2)}
.rank-pos{
    font-family:var(--font-disp);font-size:2rem;text-align:center;
    color:var(--muted);line-height:1;
}
.rank-pos.gold{color:var(--gold)}
.rank-pos.silver{color:var(--silver)}
.rank-pos.bronze{color:var(--bronze)}
.rank-pos.top{color:var(--green)}
.rank-nome{font-family:var(--font-cond);font-size:1.15rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase}
.rank-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.rank-pts{font-family:var(--font-disp);font-size:1.8rem;letter-spacing:1px;color:var(--green);line-height:1}
.rank-pts.gold{color:var(--gold)}
.rank-pts.silver{color:var(--silver)}
.rank-pts.bronze{color:var(--bronze)}
.rank-sub{font-size:0.7rem;color:var(--muted);font-weight:600;letter-spacing:0.05em}

/* CONFRONTOS */
.match-card{
    border-radius:12px;border:1px solid var(--border);
    background:var(--surface);overflow:hidden;
    animation:rowIn 0.3s ease both;
}
.match-card.done{border-color:rgba(0,230,118,0.25)}
.match-head{
    display:flex;justify-content:space-between;align-items:center;
    padding:8px 16px;
    background:var(--surface2);
    border-bottom:1px solid var(--border);
    font-size:0.7rem;font-weight:700;letter-spacing:0.1em;
    text-transform:uppercase;color:var(--muted);
}
.match-status-badge{
    display:inline-flex;align-items:center;gap:5px;
    padding:3px 10px;border-radius:99px;
    font-size:0.68rem;font-weight:700;letter-spacing:0.08em;
}
.match-status-badge.pendente{background:rgba(255,255,255,0.05);color:var(--muted);border:1px solid var(--border)}
.match-status-badge.done{background:rgba(0,230,118,0.12);color:var(--green);border:1px solid rgba(0,230,118,0.3)}
.match-body{display:flex;align-items:stretch;padding:0}
.match-team{
    flex:1;display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:3px;
    padding:16px 12px;text-align:center;
}
.match-team-names{
    font-family:var(--font-cond);font-size:1.05rem;font-weight:700;
    letter-spacing:0.04em;text-transform:uppercase;line-height:1.2;
}
.match-team-names span{display:block;font-size:0.75rem;font-weight:600;color:var(--muted)}
.match-center{
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:16px 20px;border-left:1px solid var(--border);border-right:1px solid var(--border);
    gap:6px;flex-shrink:0;min-width:100px;
}
.match-vs{font-size:0.75rem;font-weight:800;letter-spacing:0.1em;color:var(--muted)}
.match-score{
    font-family:var(--font-disp);font-size:2.2rem;letter-spacing:2px;color:var(--green);line-height:1;
}
.match-score.empty{color:var(--muted);font-size:1.4rem}

/* PÓDIO */
.tv-podium-wrap{
    position:relative;z-index:10;
    flex:1;display:none;
    flex-direction:column;align-items:center;justify-content:center;
    padding:32px 48px;
}
.tv-podium-title{
    font-family:var(--font-disp);font-size:4.5rem;letter-spacing:6px;
    color:var(--gold);margin-bottom:48px;
    text-shadow:0 0 40px rgba(255,215,0,0.3);
    animation:fadeUp 1s ease both;
}
.tv-podium-stage{
    display:flex;align-items:flex-end;justify-content:center;
    gap:24px;width:100%;max-width:900px;
    animation:fadeUp 0.8s 0.3s ease both;
    opacity:0;
}
.tv-podium-item{display:flex;flex-direction:column;align-items:center;gap:12px}
.tv-podium-medal{font-size:3.5rem;line-height:1}
.tv-podium-nome{
    font-family:var(--font-cond);font-size:1.6rem;font-weight:800;
    letter-spacing:0.06em;text-transform:uppercase;text-align:center;
}
.tv-podium-pts{font-size:0.95rem;font-weight:700;color:var(--muted)}
.tv-podium-block{
    width:260px;border-radius:12px 12px 0 0;
    display:flex;align-items:center;justify-content:center;
    font-family:var(--font-disp);font-size:4rem;color:rgba(255,255,255,0.7);
}
.tv-podium-item.p1 .tv-podium-block{height:220px;background:linear-gradient(180deg,rgba(255,215,0,0.3),rgba(184,134,11,0.3));border:1px solid rgba(255,215,0,0.4);border-bottom:none}
.tv-podium-item.p2 .tv-podium-block{height:160px;background:linear-gradient(180deg,rgba(200,214,229,0.2),rgba(128,128,128,0.2));border:1px solid rgba(200,214,229,0.3);border-bottom:none}
.tv-podium-item.p3 .tv-podium-block{height:110px;background:linear-gradient(180deg,rgba(224,123,57,0.25),rgba(139,69,19,0.2));border:1px solid rgba(224,123,57,0.35);border-bottom:none}

/* Ranking completo pós-encerramento */
.tv-full-rank{
    display:flex;flex-direction:column;gap:6px;
    width:100%;max-width:700px;margin-top:32px;
    max-height:280px;overflow-y:auto;
    animation:fadeUp 0.8s 0.6s ease both;opacity:0;
}
.tv-full-rank::-webkit-scrollbar{width:4px}
.tv-full-rank::-webkit-scrollbar-thumb{background:var(--border2);border-radius:99px}
.tv-rank-final-row{
    display:grid;grid-template-columns:48px 1fr auto auto;
    gap:12px;align-items:center;
    padding:10px 16px;border-radius:8px;
    background:var(--surface);border:1px solid var(--border);
    font-family:var(--font-cond);font-size:1.05rem;font-weight:700;
}
.tv-rank-final-row .rp{font-family:var(--font-disp);font-size:1.5rem;color:var(--muted);text-align:center}
.tv-rank-final-row .rn{text-transform:uppercase;letter-spacing:0.04em}
.tv-rank-final-row .rv{font-size:0.8rem;color:var(--muted);font-weight:600}
.tv-rank-final-row .rpts{color:var(--green);font-family:var(--font-disp);font-size:1.4rem}

@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes rowIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
.hidden{display:none!important}
</style>
</head>
<body>
<div class="bg-grid"></div>
<div class="bg-radial"></div>

<header class="tv-header">
    <div class="tv-logo">
        <img id="tv-logo-img" class="tv-logo-image" alt="Logo Arena AMP">
        <div class="tv-logo-mark">ARENA <span>AMP</span></div>
        <div class="tv-logo-cat">
            <span class="cat-label">Torneio ao vivo</span>
            <span class="cat-val" id="tv-cat">Carregando...</span>
        </div>
    </div>
    <div class="tv-header-right">
        <div class="tv-fase-pill" id="tv-fase-pill">—</div>
        <div class="tv-clock" id="tv-clock">00:00</div>
        <div class="live-pill" id="tv-live-pill"><span class="live-dot"></span> AO VIVO</div>
    </div>
</header>

<!-- Vista normal (em andamento) -->
<div class="tv-body" id="tv-view-ongoing">
    <div class="tv-panel">
        <div class="tv-panel-head">
            <span class="tv-panel-title">Classificação</span>
            <span class="tv-panel-count" id="tv-rank-count">12 jogadores</span>
        </div>
        <div class="tv-panel-body" id="tv-rank"></div>
    </div>
    <div class="tv-panel">
        <div class="tv-panel-head">
            <span class="tv-panel-title" id="tv-jogos-title">Confrontos da Fase</span>
            <span class="tv-panel-count" id="tv-jogos-count">0/0</span>
        </div>
        <div class="tv-panel-body" id="tv-jogos"></div>
    </div>
</div>

<!-- Vista pódio (encerrado) -->
<div class="tv-podium-wrap" id="tv-view-podium">
    <div class="tv-podium-title">CAMPEÕES DO TORNEIO</div>
    <div class="tv-podium-stage" id="tv-podium-stage"></div>
    <div class="tv-full-rank" id="tv-full-rank"></div>
</div>

<script>
let confeteDisparado = false;
let lastRenderSignature = '';

function rankearTV(lista) {
    return [...lista].sort((a,b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.vitorias !== a.vitorias) return b.vitorias - a.vitorias;
        if ((b.saldoGames||0) !== (a.saldoGames||0)) return (b.saldoGames||0)-(a.saldoGames||0);
        return (a.gamesSofridos||0)-(b.gamesSofridos||0);
    });
}

function sanitize(str) {
    const p = document.createElement('p');
    p.appendChild(document.createTextNode(str || ''));
    return p.innerHTML;
}

function atualizarRelogio() {
    const n = new Date();
    const h = String(n.getHours()).padStart(2,'0');
    const m = String(n.getMinutes()).padStart(2,'0');
    document.getElementById('tv-clock').textContent = h + ':' + m;
}
atualizarRelogio();
setInterval(atualizarRelogio, 10000);

const FASE_LABELS = {
    fase1: 'FASE DE GRUPOS',
    fase2: 'QUARTAS DE FINAL',
    final: 'GRANDE FINAL',
    podio: 'ENCERRADO',
    encerrado: 'ENCERRADO'
};

function updateTV() {
    const saved = localStorage.getItem('arena_amp_torneio');
    if (!saved) return;
    let camp;
    try { camp = JSON.parse(saved); } catch(e) { return; }

    const logoEl = document.getElementById('tv-logo-img');
    if (logoEl && !logoEl.src) {
        logoEl.src = window.location.origin + '/logo.png?v=tv';
    }

    const renderSignature = JSON.stringify({
        step: camp.step,
        rodadaF1: camp.rodadaF1,
        modalidade: camp.modalidade,
        categoria: camp.categoria,
        jogadores: camp.jogadores,
        jogosF1r1: camp.jogosF1r1,
        jogosF1r2: camp.jogosF1r2,
        jogosF2: camp.jogosF2,
        jogosFinal: camp.jogosFinal
    });
    if (renderSignature === lastRenderSignature) return;
    lastRenderSignature = renderSignature;

    document.getElementById('tv-cat').textContent = (camp.modalidade || '') + ' · ' + (camp.categoria || '');
    document.getElementById('tv-fase-pill').textContent = FASE_LABELS[camp.step] || camp.step || '';

    const viewOngoing = document.getElementById('tv-view-ongoing');
    const viewPodium  = document.getElementById('tv-view-podium');
    const livePill    = document.getElementById('tv-live-pill');

    const ranked = rankearTV(camp.jogadores || []);

    if (camp.step === 'podio' || camp.step === 'encerrado') {
        viewOngoing.classList.add('hidden');
        viewPodium.style.display = 'flex';
        livePill.style.background = 'transparent';
        livePill.style.border = '2px solid rgba(255,215,0,0.6)';
        livePill.style.color = '#FFD700';
        livePill.style.animation = 'none';
        livePill.innerHTML = '<span style="font-size:1.2rem">🏆</span> FINALIZADO';

        const pStage = document.getElementById('tv-podium-stage');
        if (pStage.children.length === 0) {
            const top3 = ranked.slice(0, 3);
            const ordemVisual = [
                { idx: 1, cls: 'p2', medal: '🥈', num: '2º' },
                { idx: 0, cls: 'p1', medal: '🥇', num: '1º' },
                { idx: 2, cls: 'p3', medal: '🥉', num: '3º' }
            ];
            ordemVisual.forEach(function(ov) {
                const j = top3[ov.idx];
                if (!j) return;
                const el = document.createElement('div');
                el.className = 'tv-podium-item ' + ov.cls;
                el.innerHTML =
                    '<div class="tv-podium-medal">' + ov.medal + '</div>' +
                    '<div class="tv-podium-nome">' + sanitize(j.nome) + '</div>' +
                    '<div class="tv-podium-pts">' + j.pts + ' pts</div>' +
                    '<div class="tv-podium-block">' + ov.num + '</div>';
                pStage.appendChild(el);
            });
            pStage.style.opacity = '1';
            pStage.style.animation = 'none';
        }

        const fullRank = document.getElementById('tv-full-rank');
        if (fullRank.children.length === 0) {
            ranked.forEach(function(j, idx) {
                const pos = idx + 1;
                const row = document.createElement('div');
                row.className = 'tv-rank-final-row';
                const rpClass = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : '';
                const ptsColor = pos === 1 ? 'color:var(--gold)' : pos === 2 ? 'color:var(--silver)' : pos === 3 ? 'color:var(--bronze)' : '';
                row.innerHTML =
                    '<div class="rp" style="' + (rpClass === 'gold' ? 'color:var(--gold)' : rpClass === 'silver' ? 'color:var(--silver)' : rpClass === 'bronze' ? 'color:var(--bronze)' : '') + '">' + pos + 'º</div>' +
                    '<div class="rn">' + sanitize(j.nome) + '</div>' +
                    '<div class="rv">' + (j.vitorias || 0) + 'V / ' + ((j.jogos || 0) - (j.vitorias || 0)) + 'D</div>' +
                    '<div class="rpts" style="' + ptsColor + '">' + (j.pts || 0) + '</div>';
                fullRank.appendChild(row);
            });
            fullRank.style.opacity = '1';
            fullRank.style.animation = 'none';
        }

        if (!confeteDisparado && typeof confetti === 'function') {
            confeteDisparado = true;
            setTimeout(function() {
                var duration = 5000;
                var end = Date.now() + duration;
                (function frame() {
                    confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#00e676','#FFD700','#ffffff'] });
                    confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#00e676','#FFD700','#ffffff'] });
                    if (Date.now() < end) requestAnimationFrame(frame);
                }());
            }, 600);
        }
        return;
    }

    viewOngoing.classList.remove('hidden');
    viewPodium.style.display = 'none';
    confeteDisparado = false;
    livePill.style.background = '#ff2a2a';
    livePill.style.border = 'none';
    livePill.style.color = '#fff';
    livePill.style.animation = 'pulseLive 2s infinite';
    livePill.innerHTML = '<span class="live-dot"></span> AO VIVO';

    const limite = camp.step === 'fase2' ? 8 : camp.step === 'final' ? 4 : 12;
    const corte  = camp.step === 'fase2' ? 4 : camp.step === 'final' ? 2 : 8;

    document.getElementById('tv-rank-count').textContent = ranked.slice(0, limite).length + ' jogadores';

    let rHtml = '';
    ranked.slice(0, limite).forEach(function(j, i) {
        const pos = i + 1;
        const isTop = pos <= corte;
        const posClass = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : isTop ? 'top' : '';
        const rowClass = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : isTop ? 'top' : '';
        const ptsClass = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : '';
        const subText  = isTop ? '✓ CLASSIFICADO' : '✗ eliminado';
        const subColor = isTop ? 'color:rgba(0,230,118,0.6)' : 'color:rgba(255,77,109,0.6)';
        rHtml +=
            '<div class="rank-row ' + rowClass + '" style="animation-delay:' + (i * 0.04) + 's">' +
            '<div class="rank-pos ' + posClass + '">' + pos + 'º</div>' +
            '<div class="rank-nome">' + sanitize(j.nome) + '</div>' +
            '<div class="rank-right">' +
            '<div class="rank-pts ' + ptsClass + '">' + (j.pts || 0) + '<span style="font-size:1rem;opacity:0.6"> pts</span></div>' +
            '<div class="rank-sub" style="' + subColor + '">' + subText + '</div>' +
            '</div></div>';
    });
    document.getElementById('tv-rank').innerHTML = rHtml;

    let jogos = [];
    if (camp.step === 'fase1')      jogos = camp.rodadaF1 === 1 ? (camp.jogosF1r1 || []) : (camp.jogosF1r2 || []);
    else if (camp.step === 'fase2') jogos = camp.jogosF2 || [];
    else if (camp.step === 'final') jogos = camp.jogosFinal || [];

    const faseLabels = { fase1: 'RODADA ' + camp.rodadaF1 + ' DE 2', fase2: 'QUARTAS DE FINAL', final: 'GRANDE FINAL' };
    document.getElementById('tv-jogos-title').textContent = faseLabels[camp.step] || 'CONFRONTOS';

    const concluidos = jogos.filter(function(j){ return j.concluido; }).length;
    document.getElementById('tv-jogos-count').textContent = concluidos + '/' + jogos.length + ' concluídos';

    let jHtml = '';
    jogos.forEach(function(jg, idx) {
        const d1names = (jg.dupla1 || []).filter(Boolean);
        const d2names = (jg.dupla2 || []).filter(Boolean);
        const d1html = d1names.map(function(n){ return sanitize(n); }).join('<span>&amp;</span>');
        const d2html = d2names.map(function(n){ return sanitize(n); }).join('<span>&amp;</span>');
        const doneClass = jg.concluido ? ' done' : '';
        const statusBadge = jg.concluido
            ? '<span class="match-status-badge done">✓ Concluído</span>'
            : '<span class="match-status-badge pendente">Em andamento</span>';
        const scoreHtml = jg.concluido
            ? '<div class="match-score">' + sanitize(jg.placar || '') + '</div>'
            : '<div class="match-score empty">—</div>';

        jHtml +=
            '<div class="match-card' + doneClass + '" style="animation-delay:' + (idx * 0.06) + 's">' +
            '<div class="match-head"><span>Jogo ' + (idx + 1) + '</span>' + statusBadge + '</div>' +
            '<div class="match-body">' +
            '<div class="match-team"><div class="match-team-names">' + d1html + '</div></div>' +
            '<div class="match-center">' +
            '<span class="match-vs">VS</span>' +
            scoreHtml +
            '</div>' +
            '<div class="match-team"><div class="match-team-names">' + d2html + '</div></div>' +
            '</div></div>';
    });
    document.getElementById('tv-jogos').innerHTML = jHtml;
}

updateTV();
window.addEventListener('storage', function(e) {
    if (e.key === 'arena_amp_torneio') updateTV();
});
setInterval(updateTV, 10000);
<\/script>
</body>
</html>`;

        const blob = new Blob([html], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        window.open(url, '_blank');
    });

    } // initMainApp

}); // fecha o DOMContentLoaded