// --- ESTADO DA APLICAÇÃO ---
let studentsData = [];
let classesData = [];
let repoFilter = false;

document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    setTodayDate();
});

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('startDate');
    if(dateInput) {
        dateInput.value = today;
        autoCalculateStudentData();
    }
}

function autoCalculateStudentData() {
    const startInput = document.getElementById('startDate').value;
    if (startInput) {
        const start = new Date(startInput);
        const nextObj = new Date(start);
        nextObj.setMonth(nextObj.getMonth() + 1);
        document.getElementById('nextPayment').value = nextObj.toISOString().split('T')[0];
    }
    
    const plan = document.getElementById('plan').value;
    const aulasSemana = parseInt(document.getElementById('classesPerWeek').value) || 2;
    let semanas = 4;
    
    const i = document.getElementById('price');
    if(plan === 'Mensal') { semanas = 4; i.value = 300; }
    if(plan === 'Trimestral') { semanas = 12; i.value = 280; }
    if(plan === 'Semestral') { semanas = 24; i.value = 250; }
    
    document.getElementById('saldoAulas').value = aulasSemana * semanas;
}

function enforceClassLimit(checkbox) {
    const max = parseInt(document.getElementById('classesPerWeek').value) || 2;
    const checkedCount = document.querySelectorAll('input[name="selectedClasses"]:checked').length;
    if (checkedCount > max) {
        alert(`O plano permite apenas ${max} aula(s) por semana!`);
        checkbox.checked = false; 
    }
}

async function loadAll() {
    await fetchClasses();
    await fetchStudents();
}

async function fetchClasses() {
    try {
        const res = await fetch('/api/classes');
        classesData = await res.json();
        renderClassGrid();
    } catch (error) { console.error(error); }
}

async function fetchStudents() {
    try {
        const res = await fetch('/api/students');
        studentsData = await res.json();
        renderStudentTable();
        updateStats();
    } catch (error) { console.error(error); }
}

function renderClassGrid() {
    const grid = document.getElementById('classGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const daysOrder = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    
    daysOrder.forEach(day => {
        const classesToday = classesData.filter(c => c.day === day).sort((a,b) => a.time.localeCompare(b.time));
        if (classesToday.length > 0) {
            const col = document.createElement('div');
            col.className = 'day-column';
            col.innerHTML = `<h3 style="color:#64748b; font-size:0.85rem; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">${day}</h3>`;
            
            classesToday.forEach(c => {
                const percent = (c.student_count / c.capacity) * 100;
                const isFull = c.student_count >= c.capacity;
                const statusColor = isFull ? 'var(--danger)' : 'var(--success)';
                
                col.innerHTML += `
                <div class="class-card" onclick="openClassDetails(${c.id})" style="cursor: pointer;">
                    <div class="btn-del-class" onclick="event.stopPropagation(); deleteClass(${c.id})"><i class="fa-solid fa-trash"></i></div>
                    <div class="class-header"><span class="class-time">${c.time}</span><span class="class-prof">${c.professor}</span></div>
                    <div class="class-meta">
                        <span><i class="fa-solid fa-user-group"></i> ${c.student_count}/${c.capacity}</span>
                        <span style="color:${statusColor}; font-weight:600; font-size:0.75rem">${isFull ? 'LOTADO' : 'DISPONÍVEL'}</span>
                    </div>
                    <div class="progress-bar"><div class="progress-fill ${isFull ? 'full' : ''}" style="width: ${Math.min(percent, 100)}%"></div></div>
                </div>`;
            });
            grid.appendChild(col);
        }
    });
}

function renderStudentTable() {
    const tbody = document.getElementById('studentTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let list = studentsData;
    
    if (document.getElementById('search')?.value) {
        list = list.filter(s => s.name.toLowerCase().includes(document.getElementById('search').value.toLowerCase()));
    }
    if (repoFilter) list = list.filter(s => s.reposicoes_count > 0);

    list.forEach(s => {
        const lastPayText = s.lastPayment ? formatDate(s.lastPayment) : '<span style="color:#cbd5e1; font-size:0.75rem;">Sem registro</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong style="color:var(--dark)">${s.name}</strong> 
                ${s.reposicoes_count > 0 ? `<span class="repo-alert" style="margin-left:5px;">${s.reposicoes_count} pendente(s)</span>` : ''}
            </td>
            <td>
                <div style="font-size:0.85rem; color:#334155; font-weight:500">${s.classes_desc || '<span style="color:#94a3b8">Sem turma fixa</span>'}</div>
                <div style="font-size:0.75rem; color:#64748b;">${s.plan} (${s.classesPerWeek || 2}x na sem)</div>
            </td>
            <td class="hide-mobile">
                <div style="font-weight:bold; color:var(--dark)">Vence: ${formatDate(s.nextPayment)}</div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:3px;">Último: ${lastPayText}</div>
            </td>
            <td>
                <div style="display: flex; align-items: center; justify-content: space-between; background: #f8fafc; padding: 8px 12px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <div>
                        <div style="font-size: 0.8rem; font-weight: bold; color: #475569;">Saldo: <span style="font-size: 1rem; color: #16a34a;">${s.credits || 0}</span></div>
                        ${s.reposicoes_count > 0 ? `<div style="font-size: 0.75rem; color: #ef4444; font-weight: bold;">+${s.reposicoes_count} Reposições</div>` : ''}
                    </div>
                    <button class="btn-primary" style="background: var(--dark); padding: 6px 12px; font-size: 0.8rem;" onclick="openActionModal(${s.id})">
                        <i class="fa-solid fa-list-check"></i> Gerenciar
                    </button>
                </div>
            </td>
            <td style="text-align:right;">
                <button onclick="editStudent(${s.id})" style="border:none; background:none; color:var(--primary); cursor:pointer; padding:5px; margin-right:5px;"><i class="fa-solid fa-pen"></i></button>
                <button onclick="deleteStudent(${s.id})" style="border:none; background:none; color:#cbd5e1; cursor:pointer; padding:5px;"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- NOVO: LÓGICA DO MODAL MODERNO DE AÇÕES ---
function openActionModal(id) {
    const s = studentsData.find(st => st.id === id);
    if (!s) return;
    renderActionModalContent(s);
    document.getElementById('modalActions').style.display = 'flex';
}

function renderActionModalContent(s) {
    const body = document.getElementById('actionModalBody');
    body.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <h4 style="color: var(--dark); font-size: 1.2rem; margin-bottom: 2px;">${s.name}</h4>
            <span style="display: inline-block; background: #e2e8f0; color: #475569; padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold;">${s.plan} (${s.classesPerWeek}x/sem)</span>
        </div>
        
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <div style="flex: 1; text-align: center; background: #f0fdf4; padding: 15px; border-radius: 8px; border: 1px solid #bbf7d0;">
                <span style="display: block; font-size: 0.8rem; color: #15803d; font-weight: bold; text-transform: uppercase;">Saldo de Aulas</span>
                <strong style="font-size: 2rem; color: #16a34a;">${s.credits || 0}</strong>
            </div>
            <div style="flex: 1; text-align: center; background: ${s.reposicoes_count > 0 ? '#fef2f2' : '#f8fafc'}; padding: 15px; border-radius: 8px; border: 1px solid ${s.reposicoes_count > 0 ? '#fecaca' : '#e2e8f0'};">
                <span style="display: block; font-size: 0.8rem; color: ${s.reposicoes_count > 0 ? '#b91c1c' : '#64748b'}; font-weight: bold; text-transform: uppercase;">Reposições</span>
                <strong style="font-size: 2rem; color: ${s.reposicoes_count > 0 ? '#ef4444' : '#94a3b8'};">${s.reposicoes_count}</strong>
            </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 8px;">
            <button onclick="studentAction(this, ${s.id}, 'presenca')" style="width: 100%; background: #fff; border: 1px solid #e2e8f0; padding: 12px 15px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: 0.2s;">
                <div style="display: flex; align-items: center; gap: 10px; color: #16a34a; font-weight: bold; font-size: 0.95rem;">
                    <i class="fa-solid fa-circle-check" style="font-size: 1.2rem;"></i> Presença Normal
                </div>
                <span style="background: #dcfce7; color: #15803d; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold;">-1 Aula</span>
            </button>
            
            <button onclick="studentAction(this, ${s.id}, 'falta_com_reposicao')" style="width: 100%; background: #fff; border: 1px solid #e2e8f0; padding: 12px 15px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: 0.2s;">
                <div style="display: flex; align-items: center; gap: 10px; color: #d97706; font-weight: bold; font-size: 0.95rem;">
                    <i class="fa-solid fa-user-clock" style="font-size: 1.2rem;"></i> Falta com Aviso
                </div>
                <div style="text-align: right;">
                    <span style="display: block; font-size: 0.75rem; color: #64748b; font-weight: bold;">-1 Aula</span>
                    <span style="display: block; font-size: 0.75rem; color: #b91c1c; font-weight: bold;">+1 Reposição</span>
                </div>
            </button>

            ${s.reposicoes_count > 0 ? `
                <div style="height: 1px; background: #e2e8f0; margin: 5px 0;"></div>
                <button onclick="studentAction(this, ${s.id}, 'usar_reposicao')" style="width: 100%; background: #e0f2fe; border: 1px solid #bae6fd; padding: 12px 15px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: 0.2s;">
                    <div style="display: flex; align-items: center; gap: 10px; color: #0369a1; font-weight: bold; font-size: 0.95rem;">
                        <i class="fa-solid fa-hand-sparkles" style="font-size: 1.2rem;"></i> Usar Reposição
                    </div>
                    <span style="background: #bae6fd; color: #0369a1; padding: 3px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: bold;">-1 Reposição</span>
                </button>
                <button onclick="studentAction(this, ${s.id}, 'anular_reposicao')" style="width: 100%; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px 15px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: 0.2s;">
                    <div style="display: flex; align-items: center; gap: 10px; color: #64748b; font-weight: bold; font-size: 0.9rem;">
                        <i class="fa-solid fa-ban" style="font-size: 1.1rem;"></i> Anular Reposição (Falta)
                    </div>
                </button>
            ` : ''}
        </div>
    `;
}

async function studentAction(btnElement, id, actionStr) {
    // 1. EFEITO VISUAL DE CARREGANDO (Bloqueia múltiplos cliques)
    const originalContent = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';
    btnElement.style.opacity = '0.7';
    btnElement.style.pointerEvents = 'none';

    try {
        await fetch(`/api/students/${id}/action`, { 
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({action: actionStr}) 
        });
        await fetchStudents(); // Atualiza os dados silenciosamente
        
        // Se o modal ainda estiver aberto, atualiza a tela dele na mesma hora
        const updatedStudent = studentsData.find(st => st.id === id);
        if (updatedStudent && document.getElementById('modalActions').style.display === 'flex') {
            renderActionModalContent(updatedStudent);
        }
    } catch (e) {
        alert("Erro na conexão!");
        btnElement.innerHTML = originalContent; // Restaura se der erro
        btnElement.style.opacity = '1';
        btnElement.style.pointerEvents = 'auto';
    }
}

function editStudent(id) {
    const student = studentsData.find(s => s.id === id);
    if (!student) return;

    openStudentModal(); 
    
    document.getElementById('studentId').value = student.id; 
    document.getElementById('name').value = student.name;
    document.getElementById('plan').value = student.plan;
    document.getElementById('startDate').value = student.startDate;
    document.getElementById('price').value = student.price;
    document.getElementById('classesPerWeek').value = student.classesPerWeek || 2;
    document.getElementById('lastPayment').value = student.lastPayment || '';
    document.getElementById('nextPayment').value = student.nextPayment || '';
    document.getElementById('saldoAulas').value = student.credits || 0;
    
    document.querySelector('#modalStudent h3').innerText = "Editar Aluno";

    if (student.class_ids && student.class_ids.length > 0) {
        student.class_ids.forEach(clsId => {
            const checkbox = document.querySelector(`input[name="selectedClasses"][value="${clsId}"]`);
            if (checkbox) checkbox.checked = true;
        });
    }
}

function openStudentModal() {
    const container = document.getElementById('classSelector');
    container.innerHTML = '';
    
    document.getElementById('studentId').value = ''; 
    document.querySelector('#modalStudent h3').innerText = "Novo Aluno";
    document.getElementById('studentForm').reset();
    setTodayDate();

    const daysOrder = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const sortedClasses = [...classesData].sort((a,b) => {
        return daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day) || a.time.localeCompare(b.time);
    });

    sortedClasses.forEach(c => {
        const isFull = c.student_count >= c.capacity;
        const statusText = isFull ? `<span style="color:red; font-weight:bold">(${c.student_count}/${c.capacity})</span>` : `(${c.student_count}/${c.capacity})`;
        
        container.innerHTML += `
            <label class="check-item" style="${isFull ? 'background:#fff1f2' : ''}">
                <input type="checkbox" value="${c.id}" name="selectedClasses" onchange="enforceClassLimit(this)">
                <div>
                    <span style="font-weight:600; font-size:0.8rem">${c.day} - ${c.time}</span>
                    <div style="font-size:0.75rem; color:#64748b">${c.professor} ${statusText}</div>
                </div>
            </label>
        `;
    });
    
    document.getElementById('modalStudent').style.display = 'flex';
}

function openClassDetails(classId) {
    const cls = classesData.find(c => c.id === classId);
    if (!cls) return;
    document.getElementById('currentClassId').value = cls.id;
    document.getElementById('detailClassTitle').innerText = `${cls.day} - ${cls.time} (${cls.professor})`;
    renderEnrolledList(cls);
    renderStudentSelect(cls);
    document.getElementById('modalClassDetails').style.display = 'flex';
}

function renderEnrolledList(cls) {
    const list = document.getElementById('enrolledList');
    list.innerHTML = '';
    if (!cls.students || cls.students.length === 0) {
        list.innerHTML = '<div style="color:#94a3b8; font-size:0.85rem; text-align:center; padding:10px;">Nenhum aluno.</div>';
        return;
    }
    cls.students.forEach(s => {
        list.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;">
            <span style="font-weight:600;">${s.name}</span>
            <button onclick="removeStudentFromClass(${s.id})" style="color:#ef4444; background:none; border:none; cursor:pointer;"><i class="fa-solid fa-user-minus"></i></button>
        </div>`;
    });
}

function renderStudentSelect(cls) {
    const select = document.getElementById('studentToAdd');
    select.innerHTML = '<option value="">Selecione um aluno...</option>';
    const enrolledIds = cls.students ? cls.students.map(s => s.id) : [];
    [...studentsData].sort((a,b) => a.name.localeCompare(b.name)).forEach(s => {
        if (!enrolledIds.includes(s.id)) select.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
}

// --- PROTEÇÃO CONTRA CADASTRO DUPLO AQUI ---
document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Trava o botão de salvar
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    submitBtn.style.opacity = '0.7';

    try {
        const id = document.getElementById('studentId').value;
        const isEdit = id ? true : false; 
        const classIds = Array.from(document.querySelectorAll('input[name="selectedClasses"]:checked')).map(cb => parseInt(cb.value));

        const startInput = document.getElementById('startDate').value;
        const plan = document.getElementById('plan').value;
        
        const start = new Date(startInput);
        const months = plan === 'Mensal' ? 1 : plan === 'Trimestral' ? 3 : 6;
        const endObj = new Date(start);
        endObj.setMonth(endObj.getMonth() + months);
        const endDate = endObj.toISOString().split('T')[0];

        const data = {
            name: document.getElementById('name').value,
            plan: plan,
            price: document.getElementById('price').value,
            startDate: startInput,
            endDate: endDate,
            nextPayment: document.getElementById('nextPayment').value,     
            lastPayment: document.getElementById('lastPayment').value,     
            classesPerWeek: document.getElementById('classesPerWeek').value, 
            saldoAulas: document.getElementById('saldoAulas').value,
            classIds: classIds 
        };

        const url = isEdit ? `/api/students/${id}/update` : '/api/students';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await fetch(url, { method: method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
        if (!response.ok) throw new Error("Erro no servidor.");

        closeModals();
        await loadAll(); 
        e.target.reset();
        setTodayDate();

    } catch (error) { 
        alert("Erro: " + error.message); 
    } finally {
        // Destrava o botão aconteça o que acontecer
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
        submitBtn.style.opacity = '1';
    }
});

document.getElementById('classForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        day: document.getElementById('classDay').value,
        time: document.getElementById('classTime').value,
        capacity: document.getElementById('classCapacity').value,
        professor: document.getElementById('classProf').value
    };
    await fetch('/api/classes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    closeModals();
    fetchClasses(); 
    e.target.reset();
});

async function addStudentToCurrentClass() {
    const classId = document.getElementById('currentClassId').value;
    const studentId = document.getElementById('studentToAdd').value;
    if (!studentId) return;
    await fetch(`/api/classes/${classId}/add_student`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ student_id: studentId }) });
    await loadAll(); 
    const updatedClass = classesData.find(c => c.id == classId);
    if (updatedClass) { renderEnrolledList(updatedClass); renderStudentSelect(updatedClass); }
}

async function removeStudentFromClass(studentId) {
    if(!confirm("Remover da aula?")) return;
    const classId = document.getElementById('currentClassId').value;
    await fetch(`/api/classes/${classId}/remove_student`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ student_id: studentId }) });
    await loadAll();
    const updatedClass = classesData.find(c => c.id == classId);
    if (updatedClass) { renderEnrolledList(updatedClass); renderStudentSelect(updatedClass); }
}

async function deleteStudent(id) { 
    if(confirm('Excluir aluno?')) { await fetch(`/api/students/${id}/delete`, {method:'DELETE'}); loadAll(); } 
}
async function deleteClass(id) { 
    if(confirm('Excluir turma?')) { await fetch(`/api/classes/${id}`, {method:'DELETE'}); loadAll(); } 
}

function switchTab(tab) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const targetSection = document.getElementById(`view-${tab}`);
    if(targetSection) targetSection.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick')?.includes(tab)) btn.classList.add('active');
    });
}

function toggleRepoFilter() {
    repoFilter = !repoFilter;
    const card = document.getElementById('repoFilterCard');
    if (repoFilter) { card.style.border = '2px solid var(--primary)'; card.style.background = '#fff7ed'; } 
    else { card.style.border = '1px solid transparent'; card.style.background = 'var(--light)'; }
    switchTab('students');
    renderStudentTable();
}

function updateStats() {
    if(!studentsData) return;
    const totalRepos = studentsData.reduce((acc,s) => acc + (s.reposicoes_count || 0), 0);
    const el = document.getElementById('totalReposicoes');
    if(el) el.innerText = totalRepos;
}

function formatDate(d) { 
    if(!d) return '-'; 
    const p = d.split('-'); 
    if(p.length < 3) return d;
    return `${p[2]}/${p[1]}`;
}

function toggleMenu() { document.getElementById('sidebar')?.classList.toggle('active'); }
function openClassModal() { document.getElementById('modalClass').style.display = 'flex'; }
function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display='none'); }
function filterStudents() { renderStudentTable(); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModals(); });
});