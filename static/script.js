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
        autoCalculateDates(); // Já calcula o vencimento automático
    }
}

// Calcula o vencimento 1 mês pra frente, mas deixa o usuário editar
function autoCalculateDates() {
    const startInput = document.getElementById('startDate').value;
    if (!startInput) return;
    
    const start = new Date(startInput);
    const nextObj = new Date(start);
    nextObj.setMonth(nextObj.getMonth() + 1);
    
    document.getElementById('nextPayment').value = nextObj.toISOString().split('T')[0];
}

// Trava o limite de aulas por semana
function enforceClassLimit(checkbox) {
    const max = parseInt(document.getElementById('classesPerWeek').value) || 2;
    const checkedCount = document.querySelectorAll('input[name="selectedClasses"]:checked').length;
    
    if (checkedCount > max) {
        alert(`O plano deste aluno permite apenas ${max} aula(s) por semana!`);
        checkbox.checked = false; // Desmarca automaticamente
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
    } catch (error) { console.error("Erro turmas:", error); }
}

async function fetchStudents() {
    try {
        const res = await fetch('/api/students');
        studentsData = await res.json();
        renderStudentTable();
        updateStats();
    } catch (error) { console.error("Erro alunos:", error); }
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
    
    const searchInput = document.getElementById('search');
    if (searchInput && searchInput.value) {
        const term = searchInput.value.toLowerCase();
        list = list.filter(s => s.name.toLowerCase().includes(term));
    }
    
    if (repoFilter) list = list.filter(s => s.reposicoes_count > 0);

    list.forEach(s => {
        let repoHtml = repoFilter && s.reposicoes_count > 0 ? `<span class="repo-alert">Pendente</span>` : '';
        const lastPayText = s.lastPayment ? formatDate(s.lastPayment) : '<span style="color:#cbd5e1; font-size:0.75rem;">Sem registro</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong style="color:var(--dark)">${s.name}</strong> ${repoHtml}
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
                <div style="display:flex; gap: 15px;">
                    <div style="text-align: center;">
                        <div style="font-size:0.7rem; color:#64748b; margin-bottom:2px">Créditos</div>
                        <div class="repo-box" style="background: #f0fdf4; border-color: #bbf7d0;">
                            <button class="btn-mini" onclick="changeCredits(${s.id}, -1)" style="color:#16a34a">-</button>
                            <strong style="color:#16a34a">${s.credits || 0}</strong>
                            <button class="btn-mini" onclick="changeCredits(${s.id}, 1)" style="color:#16a34a">+</button>
                        </div>
                    </div>
                    
                    <div style="text-align: center;">
                        <div style="font-size:0.7rem; color:#64748b; margin-bottom:2px">Reposições</div>
                        <div class="repo-box">
                            <button class="btn-mini" onclick="changeRepo(${s.id}, -1)">-</button>
                            <strong style="color:${s.reposicoes_count > 0 ? 'var(--danger)' : 'var(--dark)'}">${s.reposicoes_count}</strong>
                            <button class="btn-mini" onclick="changeRepo(${s.id}, 1)">+</button>
                        </div>
                    </div>
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

function editStudent(id) {
    const student = studentsData.find(s => s.id === id);
    if (!student) return;

    openStudentModal(); 
    
    document.getElementById('studentId').value = student.id; 
    document.getElementById('name').value = student.name;
    document.getElementById('plan').value = student.plan;
    document.getElementById('startDate').value = student.startDate;
    document.getElementById('price').value = student.price;
    
    // PREENCHE OS CAMPOS NOVOS
    document.getElementById('classesPerWeek').value = student.classesPerWeek || 2;
    document.getElementById('lastPayment').value = student.lastPayment || '';
    document.getElementById('nextPayment').value = student.nextPayment || '';
    
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

document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const id = document.getElementById('studentId').value;
        const isEdit = id ? true : false; 
        const classIds = Array.from(document.querySelectorAll('input[name="selectedClasses"]:checked')).map(cb => parseInt(cb.value));

        const startInput = document.getElementById('startDate').value;
        const plan = document.getElementById('plan').value;
        
        // Mantém a regra do Fim de Contrato (invisível pro usuário, só pra controle)
        const start = new Date(startInput);
        const months = plan === 'Mensal' ? 1 : plan === 'Trimestral' ? 3 : 6;
        const endObj = new Date(start);
        endObj.setMonth(endObj.getMonth() + months);
        const endDate = endObj.toISOString().split('T')[0];

        // DADOS ENVIADOS PARA O APP.PY (Com os campos novos)
        const data = {
            name: document.getElementById('name').value,
            plan: plan,
            price: document.getElementById('price').value,
            startDate: startInput,
            endDate: endDate,
            nextPayment: document.getElementById('nextPayment').value,     // MANUAL
            lastPayment: document.getElementById('lastPayment').value,     // NOVO
            classesPerWeek: document.getElementById('classesPerWeek').value, // NOVO
            classIds: classIds 
        };

        const url = isEdit ? `/api/students/${id}/update` : '/api/students';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await fetch(url, { method: method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
        if (!response.ok) throw new Error("Erro no servidor.");

        closeModals();
        loadAll(); 
        e.target.reset();
        setTodayDate();
        alert(isEdit ? "Aluno atualizado!" : "Aluno cadastrado!"); 

    } catch (error) { alert("Erro: " + error.message); }
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

async function changeRepo(id, change) {
    await fetch(`/api/students/${id}/reposicao`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({change}) });
    fetchStudents();
}

async function changeCredits(id, change) {
    await fetch(`/api/students/${id}/credits`, { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({change}) 
    });
    fetchStudents(); // Atualiza a tabela na hora
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

function updatePrice() {
    const p = document.getElementById('plan').value;
    const i = document.getElementById('price');
    if(p==='Mensal') i.value=300; 
    if(p==='Trimestral') i.value=280; 
    if(p==='Semestral') i.value=250;
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