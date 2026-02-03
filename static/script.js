// --- ESTADO DA APLICAÇÃO ---
let studentsData = [];
let classesData = [];
let repoFilter = false; // Estado do filtro de reposição

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    
    // Define a data de hoje como padrão no formulário com segurança de fuso horário
    setTodayDate();
});

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('startDate');
    if(dateInput) dateInput.value = today;
}

// Carrega tudo (Turmas e Alunos)
async function loadAll() {
    await fetchClasses();  // Importante carregar turmas antes para saber a lotação
    await fetchStudents();
}

// --- API: BUSCAR DADOS ---
async function fetchClasses() {
    try {
        const res = await fetch('/api/classes');
        classesData = await res.json();
        renderClassGrid();
    } catch (error) { console.error("Erro ao buscar turmas:", error); }
}

async function fetchStudents() {
    try {
        const res = await fetch('/api/students');
        studentsData = await res.json();
        renderStudentTable();
        updateStats();
    } catch (error) { console.error("Erro ao buscar alunos:", error); }
}

// --- RENDERIZAÇÃO: QUADRO DE AULAS (GRID) ---
function renderClassGrid() {
    const grid = document.getElementById('classGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // Ordem correta dos dias da semana
    const daysOrder = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    
    daysOrder.forEach(day => {
        // Filtra turmas deste dia e ordena por horário
        const classesToday = classesData
            .filter(c => c.day === day)
            .sort((a,b) => a.time.localeCompare(b.time));
        
        if (classesToday.length > 0) {
            // Cria a coluna do dia
            const col = document.createElement('div');
            col.className = 'day-column';
            col.innerHTML = `<h3 style="color:#64748b; font-size:0.85rem; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">${day}</h3>`;
            
            // Cria os cards das turmas
            classesToday.forEach(c => {
                const percent = (c.student_count / c.capacity) * 100;
                const isFull = c.student_count >= c.capacity;
                const statusColor = isFull ? 'var(--danger)' : 'var(--success)';
                
                col.innerHTML += `
                <div class="class-card">
                    <div class="btn-del-class" onclick="deleteClass(${c.id})" title="Excluir Turma">
                        <i class="fa-solid fa-trash"></i>
                    </div>
                    
                    <div class="class-header">
                        <span class="class-time">${c.time}</span>
                        <span class="class-prof">${c.professor}</span>
                    </div>
                    
                    <div class="class-meta">
                        <span><i class="fa-solid fa-user-group"></i> ${c.student_count}/${c.capacity}</span>
                        <span style="color:${statusColor}; font-weight:600; font-size:0.75rem">
                            ${isFull ? 'LOTADO' : 'DISPONÍVEL'}
                        </span>
                    </div>
                    
                    <div class="progress-bar">
                        <div class="progress-fill ${isFull ? 'full' : ''}" style="width: ${Math.min(percent, 100)}%"></div>
                    </div>
                </div>`;
            });
            grid.appendChild(col);
        }
    });
}

// --- RENDERIZAÇÃO: TABELA DE ALUNOS ---
function renderStudentTable() {
    const tbody = document.getElementById('studentTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let list = studentsData;
    
    // 1. Filtro de Texto (Busca)
    const searchInput = document.getElementById('search');
    if (searchInput && searchInput.value) {
        const term = searchInput.value.toLowerCase();
        list = list.filter(s => s.name.toLowerCase().includes(term));
    }
    
    // 2. Filtro de Reposição (Toggle)
    if (repoFilter) {
        list = list.filter(s => s.reposicoes_count > 0);
        // Ordena por quem expira primeiro (Proteção adicionada com ?.)
        list.sort((a,b) => {
            const expA = a.reposicoes_details?.[0]?.expires || '9999-99-99';
            const expB = b.reposicoes_details?.[0]?.expires || '9999-99-99';
            return expA.localeCompare(expB);
        });
    }

    list.forEach(s => {
        // Lógica visual da reposição (Proteção contra array vazio)
        let repoHtml = '';
        const details = s.reposicoes_details?.[0]; // Pega o primeiro detalhe se existir
        
        if (repoFilter && s.reposicoes_count > 0 && details) {
            const exp = details.expires.split('-');
            repoHtml = `<span class="repo-alert"><i class="fa-regular fa-clock"></i> Vence: ${exp[2]}/${exp[1]}</span>`;
        } else if (repoFilter && s.reposicoes_count > 0) {
             // Caso tenha contagem mas não tenha data (erro de dados), mostra genérico
             repoHtml = `<span class="repo-alert">Pendente</span>`;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong style="color:var(--dark)">${s.name}</strong>
                ${repoHtml}
            </td>
            <td>
                <div style="font-size:0.85rem; color:#334155; font-weight:500">
                    ${s.classes_desc ? s.classes_desc : '<span style="color:#94a3b8">Sem turma fixa</span>'}
                </div>
                <div style="font-size:0.75rem; color:#64748b;">${s.plan}</div>
            </td>
            <td class="hide-mobile">
                ${formatDate(s.nextPayment)}
            </td>
            <td>
                <div class="repo-box">
                    <button class="btn-mini" onclick="changeRepo(${s.id}, -1)">-</button>
                    <strong style="color:${s.reposicoes_count > 0 ? 'var(--danger)' : 'var(--dark)'}">${s.reposicoes_count}</strong>
                    <button class="btn-mini" onclick="changeRepo(${s.id}, 1)">+</button>
                </div>
            </td>
            <td style="text-align:right;">
                <button onclick="deleteStudent(${s.id})" style="border:none; background:none; color:#cbd5e1; cursor:pointer; padding:5px;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- MODAL: POPULAR CHECKBOXES DE TURMAS ---
function openStudentModal() {
    const container = document.getElementById('classSelector');
    container.innerHTML = '';
    
    if (classesData.length === 0) {
        container.innerHTML = '<div style="padding:10px; color:gray; font-size:0.8rem">Nenhuma turma cadastrada. Crie turmas no Quadro de Aulas primeiro.</div>';
    }

    // Ordena as opções por dia para ficar organizado
    const daysOrder = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const sortedClasses = [...classesData].sort((a,b) => {
        return daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day) || a.time.localeCompare(b.time);
    });

    sortedClasses.forEach(c => {
        const isFull = c.student_count >= c.capacity;
        const statusText = isFull ? `<span style="color:red; font-weight:bold">(${c.student_count}/${c.capacity})</span>` : `(${c.student_count}/${c.capacity})`;
        
        container.innerHTML += `
            <label class="check-item" style="${isFull ? 'background:#fff1f2' : ''}">
                <input type="checkbox" value="${c.id}" name="selectedClasses">
                <div>
                    <span style="font-weight:600; font-size:0.8rem">${c.day} - ${c.time}</span>
                    <div style="font-size:0.75rem; color:#64748b">${c.professor} ${statusText}</div>
                </div>
            </label>
        `;
    });
    
    document.getElementById('modalStudent').style.display = 'flex';
}

// --- ENVIAR FORMULÁRIO DE ALUNO ---
document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    try {
        // 1. Captura Turmas Selecionadas e CONVERTE PARA NÚMERO
        const checkboxes = document.querySelectorAll('input[name="selectedClasses"]:checked');
        const classIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

        // 2. Calcula Datas
        const startInput = document.getElementById('startDate').value;
        if (!startInput) throw new Error("A data de início é obrigatória.");
        
        const start = new Date(startInput);
        const plan = document.getElementById('plan').value;
        const months = plan === 'Mensal' ? 1 : plan === 'Trimestral' ? 3 : 6;
        
        const end = new Date(start);
        end.setMonth(end.getMonth() + months);
        
        const nextPay = new Date(start);
        nextPay.setMonth(nextPay.getMonth() + 1);

        // 3. Monta Objeto
        const data = {
            name: document.getElementById('name').value,
            plan: plan,
            price: document.getElementById('price').value,
            startDate: start.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0],
            nextPayment: nextPay.toISOString().split('T')[0],
            classIds: classIds 
        };

        // 4. Envia
        const response = await fetch('/api/students', { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify(data)
        });

        if (!response.ok) throw new Error("Erro no servidor ao salvar aluno.");

        closeModals();
        loadAll(); 
        
        // Reset Limpo e Seguro
        e.target.reset();
        setTodayDate(); // Re-aplica a data de hoje corretamente
        
        alert("Aluno salvo com sucesso!"); 

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar: " + error.message);
    }
});

// --- ENVIAR FORMULÁRIO DE TURMA ---
document.getElementById('classForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const data = {
        day: document.getElementById('classDay').value,
        time: document.getElementById('classTime').value,
        capacity: document.getElementById('classCapacity').value,
        professor: document.getElementById('classProf').value
    };
    
    await fetch('/api/classes', { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify(data)
    });
    
    closeModals();
    fetchClasses(); // Atualiza só as turmas
    e.target.reset();
});

// --- AÇÕES (BOTOES) ---

// Reposição (+ ou -)
async function changeRepo(id, change) {
    await fetch(`/api/students/${id}/reposicao`, { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({change}) 
    });
    fetchStudents(); // Atualiza tabela
}

// Deletar Aluno
async function deleteStudent(id) { 
    if(confirm('Tem certeza que deseja remover este aluno? As vagas nas turmas serão liberadas.')) { 
        await fetch(`/api/students/${id}/delete`, {method:'DELETE'}); 
        loadAll(); 
    } 
}

// Deletar Turma
async function deleteClass(id) { 
    if(confirm('Tem certeza que deseja excluir esta turma?')) { 
        await fetch(`/api/classes/${id}`, {method:'DELETE'}); 
        loadAll(); 
    } 
}

// --- FUNÇÕES DE INTERFACE (UI) ---

// Alternar Abas (Versão Robusta)
function switchTab(tab) {
    // 1. Esconde todas as seções
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    
    // 2. Mostra a selecionada
    const targetSection = document.getElementById(`view-${tab}`);
    if(targetSection) targetSection.classList.add('active');

    // 3. Atualiza os botões do menu com base no atributo onclick
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        // Verifica se o onclick do botão contém o nome da aba (ex: 'students')
        const clickAttr = btn.getAttribute('onclick');
        if (clickAttr && clickAttr.includes(tab)) {
            btn.classList.add('active');
        }
    });
}

// Alternar Filtro de Reposição
function toggleRepoFilter() {
    repoFilter = !repoFilter;
    const card = document.getElementById('repoFilterCard');
    
    if (repoFilter) {
        card.style.border = '2px solid var(--primary)';
        card.style.background = '#fff7ed';
    } else {
        card.style.border = '1px solid transparent';
        card.style.background = 'var(--light)';
    }
    
    // Força ir para a aba de alunos e renderiza
    switchTab('students');
    renderStudentTable();
}

// Atualiza Números do Topo
function updateStats() {
    if(!studentsData) return;
    const totalRepos = studentsData.reduce((acc,s) => acc + (s.reposicoes_count || 0), 0);
    const el = document.getElementById('totalReposicoes');
    if(el) el.innerText = totalRepos;
}

// Sugestão de Preço
function updatePrice() {
    const p = document.getElementById('plan').value;
    const i = document.getElementById('price');
    if(p==='Mensal') i.value=300; 
    if(p==='Trimestral') i.value=280; 
    if(p==='Semestral') i.value=250;
}

// Utilitários
function formatDate(d) { 
    if(!d) return '-'; 
    const p = d.split('-'); 
    // Garante que array tenha 3 partes (YYYY-MM-DD)
    if(p.length < 3) return d;
    return `${p[2]}/${p[1]}`; // Retorna Dia/Mês
}

// Menu Mobile
function toggleMenu() { 
    const sb = document.getElementById('sidebar');
    if(sb) sb.classList.toggle('active'); 
}

function openClassModal() { 
    document.getElementById('modalClass').style.display = 'flex'; 
}

function closeModals() { 
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display='none'); 
}

function filterStudents() { 
    renderStudentTable(); 
}

// Fecha modal ao clicar fora
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModals();
    });
});