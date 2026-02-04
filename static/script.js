// --- ESTADO DA APLICAÇÃO ---
let studentsData = [];
let classesData = [];
let repoFilter = false; // Estado do filtro de reposição

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    setTodayDate();
});

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('startDate');
    if(dateInput) dateInput.value = today;
}

// Carrega tudo
async function loadAll() {
    await fetchClasses();
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

    const daysOrder = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    
    daysOrder.forEach(day => {
        const classesToday = classesData
            .filter(c => c.day === day)
            .sort((a,b) => a.time.localeCompare(b.time));
        
        if (classesToday.length > 0) {
            const col = document.createElement('div');
            col.className = 'day-column';
            col.innerHTML = `<h3 style="color:#64748b; font-size:0.85rem; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">${day}</h3>`;
            
            classesToday.forEach(c => {
                const percent = (c.student_count / c.capacity) * 100;
                const isFull = c.student_count >= c.capacity;
                const statusColor = isFull ? 'var(--danger)' : 'var(--success)';
                
                // AQUI ESTÁ A CORREÇÃO DO CARD CLICÁVEL:
                col.innerHTML += `
                <div class="class-card" onclick="openClassDetails(${c.id})" style="cursor: pointer;">
                    <div class="btn-del-class" onclick="event.stopPropagation(); deleteClass(${c.id})" title="Excluir Turma">
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
    
    const searchInput = document.getElementById('search');
    if (searchInput && searchInput.value) {
        const term = searchInput.value.toLowerCase();
        list = list.filter(s => s.name.toLowerCase().includes(term));
    }
    
    if (repoFilter) {
        list = list.filter(s => s.reposicoes_count > 0);
        list.sort((a,b) => {
            const expA = a.reposicoes_details?.[0]?.expires || '9999-99-99';
            const expB = b.reposicoes_details?.[0]?.expires || '9999-99-99';
            return expA.localeCompare(expB);
        });
    }

    list.forEach(s => {
        let repoHtml = '';
        const details = s.reposicoes_details?.[0]; 
        
        if (repoFilter && s.reposicoes_count > 0 && details) {
            const exp = details.expires.split('-');
            repoHtml = `<span class="repo-alert"><i class="fa-regular fa-clock"></i> Vence: ${exp[2]}/${exp[1]}</span>`;
        } else if (repoFilter && s.reposicoes_count > 0) {
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
                <button onclick="editStudent(${s.id})" style="border:none; background:none; color:var(--primary); cursor:pointer; padding:5px; margin-right:5px;" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="deleteStudent(${s.id})" style="border:none; background:none; color:#cbd5e1; cursor:pointer; padding:5px;" title="Excluir">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- FUNÇÃO DE EDITAR ALUNO (CORRIGIDA) ---
function editStudent(id) {
    const student = studentsData.find(s => s.id === id);
    if (!student) return;

    // 1. PRIMEIRO abre o modal (que limpa os campos)
    openStudentModal(); 
    
    // 2. DEPOIS preenche os dados (agora não serão apagados)
    document.getElementById('studentId').value = student.id; 
    document.getElementById('name').value = student.name;
    document.getElementById('plan').value = student.plan;
    document.getElementById('startDate').value = student.startDate;
    document.getElementById('price').value = student.price;
    
    // Muda título para "Editar"
    document.querySelector('#modalStudent h3').innerText = "Editar Aluno";

    // Marca os checkboxes
    if (student.class_ids && student.class_ids.length > 0) {
        student.class_ids.forEach(clsId => {
            const checkbox = document.querySelector(`input[name="selectedClasses"][value="${clsId}"]`);
            if (checkbox) checkbox.checked = true;
        });
    }
}

// --- MODAL: POPULAR CHECKBOXES DE TURMAS ---
function openStudentModal() {
    const container = document.getElementById('classSelector');
    container.innerHTML = '';
    
    // Reset IMPORTANTE
    document.getElementById('studentId').value = ''; 
    document.querySelector('#modalStudent h3').innerText = "Novo Aluno";
    document.getElementById('studentForm').reset();
    setTodayDate();

    if (classesData.length === 0) {
        container.innerHTML = '<div style="padding:10px; color:gray; font-size:0.8rem">Nenhuma turma cadastrada.</div>';
    }

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

// --- LOGICA DO MODAL DE DETALHES DA TURMA ---
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
        list.innerHTML = '<div style="color:#94a3b8; font-size:0.85rem; text-align:center; padding:10px;">Nenhum aluno nesta turma.</div>';
        return;
    }

    cls.students.forEach(s => {
        list.innerHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:white; border:1px solid #e2e8f0; border-radius:6px;">
                <span style="font-weight:600; color:var(--dark)">${s.name}</span>
                <button onclick="removeStudentFromClass(${s.id})" style="color:#ef4444; background:none; border:none; cursor:pointer;" title="Remover da aula">
                    <i class="fa-solid fa-user-minus"></i>
                </button>
            </div>
        `;
    });
}

function renderStudentSelect(cls) {
    const select = document.getElementById('studentToAdd');
    select.innerHTML = '<option value="">Selecione um aluno...</option>';
    
    const enrolledIds = cls.students ? cls.students.map(s => s.id) : [];
    const sortedStudents = [...studentsData].sort((a,b) => a.name.localeCompare(b.name));

    sortedStudents.forEach(s => {
        if (!enrolledIds.includes(s.id)) {
            select.innerHTML += `<option value="${s.id}">${s.name}</option>`;
        }
    });
}

// --- ENVIAR FORMULÁRIO DE ALUNO (CRIAR OU EDITAR) ---
document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    try {
        const id = document.getElementById('studentId').value;
        const isEdit = id ? true : false; // Verifica se tem ID

        const checkboxes = document.querySelectorAll('input[name="selectedClasses"]:checked');
        const classIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

        const startInput = document.getElementById('startDate').value;
        const plan = document.getElementById('plan').value;
        const start = new Date(startInput);
        
        const months = plan === 'Mensal' ? 1 : plan === 'Trimestral' ? 3 : 6;
        const endObj = new Date(start);
        endObj.setMonth(endObj.getMonth() + months);
        const endDate = endObj.toISOString().split('T')[0];

        const nextObj = new Date(start);
        nextObj.setMonth(nextObj.getMonth() + 1);
        const nextPay = nextObj.toISOString().split('T')[0];

        const data = {
            name: document.getElementById('name').value,
            plan: plan,
            price: document.getElementById('price').value,
            startDate: startInput,
            endDate: endDate,
            nextPayment: nextPay,
            classIds: classIds 
        };

        const url = isEdit ? `/api/students/${id}/update` : '/api/students';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await fetch(url, { 
            method: method, 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify(data)
        });

        if (!response.ok) throw new Error("Erro no servidor.");

        closeModals();
        loadAll(); 
        e.target.reset();
        setTodayDate();
        alert(isEdit ? "Aluno atualizado!" : "Aluno cadastrado!"); 

    } catch (error) {
        console.error(error);
        alert("Erro: " + error.message);
    }
});

// --- AÇÕES DIVERSAS ---

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
    fetchClasses(); 
    e.target.reset();
});

async function addStudentToCurrentClass() {
    const classId = document.getElementById('currentClassId').value;
    const studentId = document.getElementById('studentToAdd').value;
    if (!studentId) return alert("Selecione um aluno primeiro.");

    await fetch(`/api/classes/${classId}/add_student`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ student_id: studentId })
    });

    await loadAll(); 
    const updatedClass = classesData.find(c => c.id == classId);
    if (updatedClass) {
        renderEnrolledList(updatedClass);
        renderStudentSelect(updatedClass);
    }
}

async function removeStudentFromClass(studentId) {
    if(!confirm("Remover este aluno desta aula específica?")) return;
    const classId = document.getElementById('currentClassId').value;

    await fetch(`/api/classes/${classId}/remove_student`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ student_id: studentId })
    });

    await loadAll();
    const updatedClass = classesData.find(c => c.id == classId);
    if (updatedClass) {
        renderEnrolledList(updatedClass);
        renderStudentSelect(updatedClass);
    }
}

async function changeRepo(id, change) {
    await fetch(`/api/students/${id}/reposicao`, { 
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({change}) 
    });
    fetchStudents();
}

async function deleteStudent(id) { 
    if(confirm('Tem certeza que deseja remover este aluno?')) { 
        await fetch(`/api/students/${id}/delete`, {method:'DELETE'}); 
        loadAll(); 
    } 
}

async function deleteClass(id) { 
    if(confirm('Tem certeza que deseja excluir esta turma?')) { 
        await fetch(`/api/classes/${id}`, {method:'DELETE'}); 
        loadAll(); 
    } 
}

// --- UI UTILS ---

function switchTab(tab) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const targetSection = document.getElementById(`view-${tab}`);
    if(targetSection) targetSection.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        const clickAttr = btn.getAttribute('onclick');
        if (clickAttr && clickAttr.includes(tab)) btn.classList.add('active');
    });

    const sb = document.getElementById('sidebar');
    if (window.innerWidth <= 768 && sb.classList.contains('active')) {
        sb.classList.remove('active');
    }
}

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

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModals();
    });
});