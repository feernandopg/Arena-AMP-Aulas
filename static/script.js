// ─── STATE ────────────────────────────────────────────────────────────────────
let studentsData = [];
let classesData = [];
let repoFilter = false;
let alertFilter = null; // 'overdue' | 'soon' | null

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    setTodayDate();
});

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('startDate');
    const paymentDateInput = document.getElementById('paymentDate');
    if (dateInput) { dateInput.value = today; autoCalculateStudentData(); }
    if (paymentDateInput) paymentDateInput.value = today;
}

// ─── AUTO-CALCULATE ───────────────────────────────────────────────────────────
function autoCalculateStudentData() {
    const startInput = document.getElementById('startDate').value;
    const plan = document.getElementById('plan').value;
    const aulasSemana = parseInt(document.getElementById('classesPerWeek').value) || 2;
    const paymentDay = parseInt(document.getElementById('paymentDay').value) || 30;

    let months = 1;
    if (plan === 'Mensal')      { months = 1; }
    if (plan === 'Trimestral')  { months = 3; }
    if (plan === 'Semestral')   { months = 6; }

    const semanas = months * 4;
    document.getElementById('saldoAulas').value = aulasSemana * semanas;

    if (startInput) {
        const start = new Date(startInput + 'T12:00:00');

        // End date
        const endObj = new Date(start);
        endObj.setMonth(endObj.getMonth() + months);
        document.getElementById('endDate').value = endObj.toISOString().split('T')[0];

        // Next payment = next occurrence of the fixed day after start
        const nextPay = computeNextPaymentJS(paymentDay, start);
        document.getElementById('nextPayment').value = nextPay;
    }
}

function computeNextPaymentJS(paymentDay, referenceDate) {
    const day = Math.min(paymentDay, 28);
    let candidate = new Date(referenceDate);
    candidate.setDate(day);
    if (candidate <= referenceDate) {
        candidate.setMonth(candidate.getMonth() + 1);
        candidate.setDate(day);
    }
    return candidate.toISOString().split('T')[0];
}

function enforceClassLimit(checkbox) {
    const max = parseInt(document.getElementById('classesPerWeek').value) || 2;
    const checkedCount = document.querySelectorAll('input[name="selectedClasses"]:checked').length;
    if (checkedCount > max) {
        alert(`O plano permite apenas ${max} aula(s) por semana!`);
        checkbox.checked = false;
    }
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────
async function loadAll() {
    await fetchClasses();
    await fetchStudents();
    await fetchAlerts();
}

async function fetchClasses() {
    try {
        const res = await fetch('/api/classes');
        classesData = await res.json();
        renderClassGrid();
    } catch (e) { console.error(e); }
}

async function fetchStudents() {
    try {
        const res = await fetch('/api/students');
        studentsData = await res.json();
        renderStudentTable();
        updateStats();
    } catch (e) { console.error(e); }
}

async function fetchAlerts() {
    try {
        const res = await fetch('/api/alerts');
        const data = await res.json();
        const overdueEl = document.getElementById('countOverdue');
        const soonEl = document.getElementById('countSoon');
        const overdueCard = document.getElementById('alertOverdueCard');
        const soonCard = document.getElementById('alertSoonCard');

        if (overdueEl) overdueEl.innerText = data.overdue.length;
        if (soonEl) soonEl.innerText = data.due_soon.length;

        if (overdueCard) overdueCard.style.display = data.overdue.length > 0 ? 'flex' : 'none';
        if (soonCard) soonCard.style.display = data.due_soon.length > 0 ? 'flex' : 'none';
    } catch (e) { console.error(e); }
}

// ─── RENDER CLASS GRID ────────────────────────────────────────────────────────
function renderClassGrid() {
    const grid = document.getElementById('classGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const daysOrder = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

    daysOrder.forEach(day => {
        const classesToday = classesData.filter(c => c.day === day).sort((a, b) => a.time.localeCompare(b.time));
        if (classesToday.length > 0) {
            const col = document.createElement('div');
            col.className = 'day-column';
            col.innerHTML = `<h3 style="color:#64748b; font-size:0.85rem; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">${day}</h3>`;
            classesToday.forEach(c => {
                const percent = (c.student_count / c.capacity) * 100;
                const isFull = c.student_count >= c.capacity;
                const statusColor = isFull ? 'var(--danger)' : 'var(--success)';
                col.innerHTML += `
                <div class="class-card" onclick="openClassDetails(${c.id})" style="cursor:pointer;">
                    <div class="btn-del-class" onclick="event.stopPropagation(); deleteClass(${c.id}, this)"><i class="fa-solid fa-trash"></i></div>
                    <div class="class-header"><span class="class-time">${c.time}</span><span class="class-prof">${c.professor}</span></div>
                    <div class="class-meta">
                        <span><i class="fa-solid fa-user-group"></i> ${c.student_count}/${c.capacity}</span>
                        <span style="color:${statusColor}; font-weight:600; font-size:0.75rem">${isFull ? 'LOTADO' : 'DISPONÍVEL'}</span>
                    </div>
                    <div class="progress-bar"><div class="progress-fill ${isFull ? 'full' : ''}" style="width:${Math.min(percent, 100)}%"></div></div>
                </div>`;
            });
            grid.appendChild(col);
        }
    });
}

// ─── RENDER STUDENT TABLE ─────────────────────────────────────────────────────
function renderStudentTable() {
    const tbody = document.getElementById('studentTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    let list = [...studentsData];

    const searchVal = document.getElementById('search')?.value?.toLowerCase();
    if (searchVal) list = list.filter(s => s.name.toLowerCase().includes(searchVal));
    if (repoFilter) list = list.filter(s => s.reposicoes_count > 0);
    if (alertFilter === 'overdue') list = list.filter(s => s.payment_overdue);
    if (alertFilter === 'soon') list = list.filter(s => s.payment_alert && !s.payment_overdue);

    list.sort((a, b) => (a.active === b.active) ? 0 : a.active ? -1 : 1);

    list.forEach(s => {
        const opacityStyle = s.active ? '1' : '0.5';
        const activeBadge = s.active ? '' : '<span style="background:#ef4444; color:white; font-size:0.6rem; padding:2px 5px; border-radius:4px; margin-left:5px;">INATIVO</span>';

        // Payment status badge
        let paymentBadge = '';
        let rowBg = '';
        if (s.payment_overdue) {
            paymentBadge = '<span class="badge badge-danger">VENCIDO</span>';
            rowBg = 'background: #fff5f5;';
        } else if (s.payment_alert) {
            paymentBadge = '<span class="badge badge-warning">⚠️ Vence em breve</span>';
            rowBg = 'background: #fffbeb;';
        }

        // Plan expiry
        const planExpiryBadge = s.plan_expiring ? '<span class="badge badge-warning" style="margin-left:4px;">Plano expirando</span>' : '';

        // Format price
        const priceFormatted = formatPrice(s.price);

        // Payment info
        const lastPayText = s.lastPayment
            ? `<div style="font-size:0.75rem; color:#64748b; margin-top:2px;">Pago: ${formatDate(s.lastPayment)}</div>`
            : '<div style="font-size:0.72rem; color:#cbd5e1; margin-top:2px;">Sem pagamento</div>';

        const tr = document.createElement('tr');
        tr.style.cssText = opacityStyle !== '1' ? `opacity:${opacityStyle}; ${rowBg}` : rowBg;
        tr.innerHTML = `
            <td>
                <strong style="color:var(--dark)">${s.name}</strong>${activeBadge}
                ${paymentBadge}${planExpiryBadge}
                ${s.reposicoes_count > 0 && s.active ? `<span class="repo-alert">${s.reposicoes_count} reposição(ões) pendente(s)</span>` : ''}
            </td>
            <td>
                <div style="font-size:0.85rem; color:#334155; font-weight:500">${s.classes_desc || '<span style="color:#94a3b8">Sem turma fixa</span>'}</div>
                <div style="font-size:0.75rem; color:#64748b;">${s.plan} · ${s.classesPerWeek || 2}x/sem · <strong>${priceFormatted}</strong></div>
            </td>
            <td class="hide-mobile">
                <div style="font-weight:bold; color:var(--dark); font-size:0.9rem;">
                    Vence: ${formatDate(s.nextPayment)}
                    ${s.paymentDay ? `<span style="font-size:0.72rem; color:#94a3b8; font-weight:400;"> (todo dia ${s.paymentDay})</span>` : ''}
                </div>
                ${lastPayText}
                <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">
                    ${s.startDate ? `Início: ${formatDate(s.startDate)}` : ''}
                    ${s.endDate ? ` · Fim: ${formatDate(s.endDate)}` : ''}
                </div>
                <button onclick="openPaymentModal(${s.id})" class="btn-pay" style="margin-top:6px;">
                    <i class="fa-solid fa-money-bill-wave"></i> Registrar Pgto
                </button>
            </td>
            <td>
                <div style="display:flex; align-items:center; justify-content:space-between; background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid #e2e8f0;">
                    <div>
                        <div style="font-size:0.8rem; font-weight:bold; color:#475569;">Saldo: <span style="font-size:1rem; color:#16a34a;">${s.credits || 0}</span></div>
                        ${s.reposicoes_count > 0 ? `<div style="font-size:0.75rem; color:#ef4444; font-weight:bold;">+${s.reposicoes_count} repos.</div>` : ''}
                    </div>
                    <button class="btn-primary" style="background:var(--dark); padding:6px 12px; font-size:0.8rem;" onclick="openActionModal(${s.id})">
                        <i class="fa-solid fa-list-check"></i> Gerenciar
                    </button>
                </div>
            </td>
            <td style="text-align:right; min-width:90px;">
                <button onclick="toggleStudentStatus(${s.id}, this)" title="${s.active ? 'Inativar' : 'Ativar'}" style="border:none; background:none; color:${s.active ? '#16a34a' : '#94a3b8'}; cursor:pointer; padding:5px; font-size:1.1rem;">
                    <i class="fa-solid fa-toggle-${s.active ? 'on' : 'off'}"></i>
                </button>
                <button onclick="editStudent(${s.id})" style="border:none; background:none; color:var(--primary); cursor:pointer; padding:5px;">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button onclick="deleteStudent(${s.id}, this)" style="border:none; background:none; color:#cbd5e1; cursor:pointer; padding:5px;">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ─── ACTION MODAL ─────────────────────────────────────────────────────────────
function openActionModal(id) {
    const s = studentsData.find(st => st.id === id);
    if (!s) return;
    renderActionModalContent(s);
    document.getElementById('modalActions').style.display = 'flex';
}

function renderActionModalContent(s) {
    const body = document.getElementById('actionModalBody');

    let historyHtml = '<div style="text-align:center; padding:10px; color:#94a3b8; font-size:0.8rem;">Nenhum histórico ainda.</div>';
    if (s.history && s.history.length > 0) {
        historyHtml = s.history.map(h => {
            const canUndo = ['presenca', 'falta_aviso', 'falta_sem_aviso', 'usar_reposicao', 'anular_reposicao'].includes(h.action_type);
            return `
            <div style="border-bottom:1px solid #f1f5f9; padding:8px 0; display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div style="flex:1;">
                    <span style="font-size:0.7rem; color:#94a3b8; font-weight:bold; display:block;"><i class="fa-regular fa-clock"></i> ${h.date}</span>
                    <span style="font-size:0.85rem; color:#334155;">${h.desc}</span>
                </div>
                ${canUndo ? `
                <button onclick="undoHistoryEntry(${s.id}, ${h.id}, this)" title="Desfazer / Apagar este registro"
                    style="flex-shrink:0; background:none; border:1px solid #fecaca; border-radius:6px; color:#ef4444; cursor:pointer; padding:4px 8px; font-size:0.75rem; transition:0.2s;"
                    onmouseover="this.style.background='#fef2f2'" onmouseout="this.style.background='none'">
                    <i class="fa-solid fa-rotate-left"></i> Desfazer
                </button>` : ''}
            </div>`;
        }).join('');
    }

    const priceFormatted = formatPrice(s.price);
    const disabled = !s.active ? 'disabled' : '';
    const disabledStyle = !s.active ? 'opacity:0.5; pointer-events:none;' : '';

    body.innerHTML = `
        <div style="text-align:center; margin-bottom:20px;">
            <h4 style="color:var(--dark); font-size:1.2rem; margin-bottom:4px;">${s.name}</h4>
            <span style="display:inline-block; background:#e2e8f0; color:#475569; padding:3px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">
                ${s.plan} · ${s.classesPerWeek}x/sem · ${priceFormatted}
            </span>
            <div style="font-size:0.78rem; color:#64748b; margin-top:6px;">
                📅 ${s.startDate ? formatDate(s.startDate) : '—'} → ${s.endDate ? formatDate(s.endDate) : '—'}
                &nbsp;|&nbsp; Venc. todo dia <strong>${s.paymentDay || 30}</strong>
            </div>
            ${s.payment_overdue ? `<div style="background:#fef2f2; color:#b91c1c; border-radius:8px; padding:6px 10px; margin-top:8px; font-size:0.82rem; font-weight:600;">⚠️ Pagamento VENCIDO desde ${formatDate(s.nextPayment)}</div>` : ''}
            ${s.payment_alert && !s.payment_overdue ? `<div style="background:#fff7ed; color:#c2410c; border-radius:8px; padding:6px 10px; margin-top:8px; font-size:0.82rem; font-weight:600;">🔔 Pagamento vence em breve: ${formatDate(s.nextPayment)}</div>` : ''}
        </div>

        <div style="display:flex; gap:10px; margin-bottom:20px;">
            <div style="flex:1; text-align:center; background:#f0fdf4; padding:15px; border-radius:8px; border:1px solid #bbf7d0;">
                <span style="display:block; font-size:0.8rem; color:#15803d; font-weight:bold; text-transform:uppercase;">Saldo de Aulas</span>
                <strong style="font-size:2rem; color:#16a34a;">${s.credits || 0}</strong>
            </div>
            <div style="flex:1; text-align:center; background:${s.reposicoes_count > 0 ? '#fef2f2' : '#f8fafc'}; padding:15px; border-radius:8px; border:1px solid ${s.reposicoes_count > 0 ? '#fecaca' : '#e2e8f0'};">
                <span style="display:block; font-size:0.8rem; color:${s.reposicoes_count > 0 ? '#b91c1c' : '#64748b'}; font-weight:bold; text-transform:uppercase;">Reposições</span>
                <strong style="font-size:2rem; color:${s.reposicoes_count > 0 ? '#ef4444' : '#94a3b8'};">${s.reposicoes_count}</strong>
            </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px; ${disabledStyle}">

            <button onclick="studentAction(this, ${s.id}, 'presenca')" ${disabled}
                style="width:100%; background:#fff; border:1px solid #e2e8f0; padding:12px 15px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:0.2s;">
                <div style="display:flex; align-items:center; gap:10px; color:#16a34a; font-weight:bold; font-size:0.95rem;">
                    <i class="fa-solid fa-circle-check" style="font-size:1.2rem;"></i> Presença Normal
                </div>
                <span style="background:#dcfce7; color:#15803d; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:bold;">-1 Aula</span>
            </button>

            <button onclick="studentAction(this, ${s.id}, 'falta_com_reposicao')" ${disabled}
                style="width:100%; background:#fff; border:1px solid #e2e8f0; padding:12px 15px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:0.2s;">
                <div style="display:flex; align-items:center; gap:10px; color:#d97706; font-weight:bold; font-size:0.95rem;">
                    <i class="fa-solid fa-user-clock" style="font-size:1.2rem;"></i> Falta com Aviso Prévio
                </div>
                <div style="text-align:right;">
                    <span style="display:block; font-size:0.75rem; color:#64748b; font-weight:bold;">-1 Aula</span>
                    <span style="display:block; font-size:0.75rem; color:#b91c1c; font-weight:bold;">+1 Reposição</span>
                </div>
            </button>

            <button onclick="studentAction(this, ${s.id}, 'falta_sem_aviso')" ${disabled}
                style="width:100%; background:#fff7ed; border:1px solid #fed7aa; padding:12px 15px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:0.2s;">
                <div style="display:flex; align-items:center; gap:10px; color:#c2410c; font-weight:bold; font-size:0.95rem;">
                    <i class="fa-solid fa-ban" style="font-size:1.2rem;"></i> Falta SEM Aviso Prévio
                </div>
                <span style="background:#fed7aa; color:#c2410c; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:bold;">Perde aula</span>
            </button>

            ${s.reposicoes_count > 0 ? `
            <div style="height:1px; background:#e2e8f0; margin:5px 0;"></div>
            <button onclick="studentAction(this, ${s.id}, 'usar_reposicao')" ${disabled}
                style="width:100%; background:#e0f2fe; border:1px solid #bae6fd; padding:12px 15px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:0.2s;">
                <div style="display:flex; align-items:center; gap:10px; color:#0369a1; font-weight:bold; font-size:0.95rem;">
                    <i class="fa-solid fa-hand-sparkles" style="font-size:1.2rem;"></i> Usar Reposição
                </div>
                <span style="background:#bae6fd; color:#0369a1; padding:3px 8px; border-radius:6px; font-size:0.75rem; font-weight:bold;">-1 Reposição</span>
            </button>
            <button onclick="studentAction(this, ${s.id}, 'anular_reposicao')" ${disabled}
                style="width:100%; background:#f1f5f9; border:1px solid #cbd5e1; padding:10px 15px; border-radius:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:0.2s;">
                <div style="display:flex; align-items:center; gap:10px; color:#64748b; font-weight:bold; font-size:0.9rem;">
                    <i class="fa-solid fa-xmark" style="font-size:1.1rem;"></i> Anular Reposição (falta na repos.)
                </div>
            </button>` : ''}
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
            <h5 style="color:#475569; margin-bottom:8px; font-size:0.85rem;"><i class="fa-solid fa-clock-rotate-left"></i> Histórico do Aluno</h5>
            <div style="max-height:200px; overflow-y:auto; padding-right:4px;">
                ${historyHtml}
            </div>
        </div>
    `;
}

// ─── UNDO HISTORY ENTRY ───────────────────────────────────────────────────────
async function undoHistoryEntry(studentId, historyId, btnEl) {
    if (!confirm('Desfazer este registro? O saldo de aulas será revertido se aplicável.')) return;
    btnEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnEl.disabled = true;
    try {
        const res = await fetch(`/api/students/${studentId}/history/${historyId}/delete`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            await fetchStudents();
            const updated = studentsData.find(st => st.id === studentId);
            if (updated) renderActionModalContent(updated);
        }
    } catch (e) {
        alert('Erro ao desfazer.');
        btnEl.disabled = false;
    }
}

// ─── PAYMENT MODAL ────────────────────────────────────────────────────────────
function openPaymentModal(studentId) {
    const s = studentsData.find(st => st.id === studentId);
    if (!s) return;
    document.getElementById('paymentStudentId').value = s.id;
    document.getElementById('paymentStudentName').value = s.name;
    document.getElementById('paymentAmount').value = formatPriceInput(s.price);
    document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('modalPayment').style.display = 'flex';
}

async function confirmPayment() {
    const id = document.getElementById('paymentStudentId').value;
    const amount = document.getElementById('paymentAmount').value;
    const date = document.getElementById('paymentDate').value;
    if (!id || !date) return;

    const btn = document.querySelector('#modalPayment .btn-primary');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    btn.disabled = true;

    try {
        await fetch(`/api/students/${id}/register_payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentDate: date, amount: amount })
        });
        closeModals();
        await loadAll();
    } catch (e) {
        alert('Erro ao registrar pagamento.');
    } finally {
        btn.innerHTML = 'Confirmar Pagamento';
        btn.disabled = false;
    }
}

// ─── TOGGLE STATUS ────────────────────────────────────────────────────────────
async function toggleStudentStatus(id, btnElement) {
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btnElement.disabled = true;
    try {
        await fetch(`/api/students/${id}/toggle_status`, { method: 'POST' });
        await fetchStudents();
        await fetchAlerts();
    } catch (e) {
        alert('Erro ao alterar status!');
        btnElement.disabled = false;
    }
}

// ─── STUDENT ACTION ───────────────────────────────────────────────────────────
let isProcessingAction = false;
async function studentAction(btnElement, id, actionStr) {
    if (isProcessingAction) return;
    isProcessingAction = true;
    const originalContent = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';
    btnElement.style.opacity = '0.5';
    try {
        await fetch(`/api/students/${id}/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: actionStr })
        });
        await fetchStudents();
        const updatedStudent = studentsData.find(st => st.id === id);
        if (updatedStudent && document.getElementById('modalActions').style.display === 'flex') {
            renderActionModalContent(updatedStudent);
        }
    } catch (e) {
        alert('Erro na conexão!');
        btnElement.innerHTML = originalContent;
        btnElement.style.opacity = '1';
    } finally {
        isProcessingAction = false;
    }
}

// ─── EDIT STUDENT ─────────────────────────────────────────────────────────────
function editStudent(id) {
    const student = studentsData.find(s => s.id === id);
    if (!student) return;

    openStudentModal();

    document.getElementById('studentId').value = student.id;
    document.getElementById('name').value = student.name;
    document.getElementById('plan').value = student.plan;
    document.getElementById('startDate').value = student.startDate;
    document.getElementById('endDate').value = student.endDate || '';
    document.getElementById('price').value = formatPriceInput(student.price);
    document.getElementById('classesPerWeek').value = student.classesPerWeek || 2;
    document.getElementById('lastPayment').value = student.lastPayment || '';
    document.getElementById('nextPayment').value = student.nextPayment || '';
    document.getElementById('saldoAulas').value = student.credits || 0;
    if (document.getElementById('paymentDay')) {
        document.getElementById('paymentDay').value = student.paymentDay || 30;
    }

    document.getElementById('studentModalTitle').innerText = 'Editar Aluno';

    if (student.class_ids) {
        student.class_ids.forEach(clsId => {
            const cb = document.querySelector(`input[name="selectedClasses"][value="${clsId}"]`);
            if (cb) cb.checked = true;
        });
    }
}

// ─── OPEN STUDENT MODAL ───────────────────────────────────────────────────────
function openStudentModal() {
    const container = document.getElementById('classSelector');
    container.innerHTML = '';

    document.getElementById('studentId').value = '';
    document.getElementById('studentModalTitle').innerText = 'Novo Aluno';
    document.getElementById('studentForm').reset();
    setTodayDate();

    const daysOrder = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const sortedClasses = [...classesData].sort((a, b) =>
        daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day) || a.time.localeCompare(b.time)
    );

    sortedClasses.forEach(c => {
        const isFull = c.student_count >= c.capacity;
        const statusText = isFull
            ? `<span style="color:red; font-weight:bold">(${c.student_count}/${c.capacity} LOTADO)</span>`
            : `(${c.student_count}/${c.capacity})`;
        container.innerHTML += `
            <label class="check-item" style="${isFull ? 'background:#fff1f2' : ''}">
                <input type="checkbox" value="${c.id}" name="selectedClasses" onchange="enforceClassLimit(this)">
                <div>
                    <span style="font-weight:600; font-size:0.8rem">${c.day} - ${c.time}</span>
                    <div style="font-size:0.75rem; color:#64748b">${c.professor} ${statusText}</div>
                </div>
            </label>`;
    });

    document.getElementById('modalStudent').style.display = 'flex';
}

// ─── CLASS DETAILS MODAL ──────────────────────────────────────────────────────
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
        list.innerHTML += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;">
                <span style="font-weight:600;">${s.name}</span>
                <button onclick="removeStudentFromClass(${s.id}, this)" style="color:#ef4444; background:none; border:none; cursor:pointer;">
                    <i class="fa-solid fa-user-minus"></i>
                </button>
            </div>`;
    });
}

function renderStudentSelect(cls) {
    const select = document.getElementById('studentToAdd');
    select.innerHTML = '<option value="">Selecione um aluno...</option>';
    const enrolledIds = cls.students ? cls.students.map(s => s.id) : [];
    [...studentsData].sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
        if (!enrolledIds.includes(s.id))
            select.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
}

// ─── FORM SUBMISSIONS ─────────────────────────────────────────────────────────
document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    submitBtn.style.opacity = '0.7';

    try {
        const id = document.getElementById('studentId').value;
        const isEdit = !!id;
        const classIds = Array.from(document.querySelectorAll('input[name="selectedClasses"]:checked')).map(cb => parseInt(cb.value));
        const startInput = document.getElementById('startDate').value;
        const endInput = document.getElementById('endDate').value;
        const plan = document.getElementById('plan').value;
        const paymentDay = parseInt(document.getElementById('paymentDay').value) || 30;

        // Calculate end date if not set
        let endDate = endInput;
        if (!endDate) {
            const start = new Date(startInput + 'T12:00:00');
            const months = plan === 'Mensal' ? 1 : plan === 'Trimestral' ? 3 : 6;
            const endObj = new Date(start);
            endObj.setMonth(endObj.getMonth() + months);
            endDate = endObj.toISOString().split('T')[0];
        }

        const data = {
            name: document.getElementById('name').value,
            plan,
            price: document.getElementById('price').value,
            startDate: startInput,
            endDate,
            paymentDay,
            nextPayment: document.getElementById('nextPayment').value,
            lastPayment: document.getElementById('lastPayment').value,
            classesPerWeek: document.getElementById('classesPerWeek').value,
            saldoAulas: document.getElementById('saldoAulas').value,
            classIds
        };

        const url = isEdit ? `/api/students/${id}/update` : '/api/students';
        const method = isEdit ? 'PUT' : 'POST';
        await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        closeModals();
        await loadAll();
        e.target.reset();
        setTodayDate();
    } catch (error) {
        alert('Erro: ' + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
        submitBtn.style.opacity = '1';
    }
});

document.getElementById('classForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    const orig = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Criando...';
    submitBtn.style.opacity = '0.7';
    try {
        const data = {
            day: document.getElementById('classDay').value,
            time: document.getElementById('classTime').value,
            capacity: document.getElementById('classCapacity').value,
            professor: document.getElementById('classProf').value
        };
        await fetch('/api/classes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        closeModals();
        await fetchClasses();
        e.target.reset();
    } catch (error) {
        alert('Erro ao criar turma.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = orig;
        submitBtn.style.opacity = '1';
    }
});

// ─── CLASS STUDENT MANAGEMENT ─────────────────────────────────────────────────
let isAddingStudent = false;
async function addStudentToCurrentClass() {
    if (isAddingStudent) return;
    const classId = document.getElementById('currentClassId').value;
    const studentId = document.getElementById('studentToAdd').value;
    if (!studentId) return;
    isAddingStudent = true;
    const btn = document.querySelector('#modalClassDetails .btn-primary');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
        await fetch(`/api/classes/${classId}/add_student`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: studentId })
        });
        await loadAll();
        const updated = classesData.find(c => c.id == classId);
        if (updated) { renderEnrolledList(updated); renderStudentSelect(updated); }
    } finally {
        isAddingStudent = false;
        btn.innerHTML = orig;
    }
}

async function removeStudentFromClass(studentId, btnElement) {
    if (!confirm('Remover da aula?')) return;
    btnElement.style.opacity = '0.3';
    btnElement.style.pointerEvents = 'none';
    const classId = document.getElementById('currentClassId').value;
    await fetch(`/api/classes/${classId}/remove_student`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: studentId })
    });
    await loadAll();
    const updated = classesData.find(c => c.id == classId);
    if (updated) { renderEnrolledList(updated); renderStudentSelect(updated); }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────
async function deleteStudent(id, btnElement) {
    if (confirm('Excluir aluno definitivamente?')) {
        btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        await fetch(`/api/students/${id}/delete`, { method: 'DELETE' });
        loadAll();
    }
}

async function deleteClass(id, btnElement) {
    if (confirm('Excluir esta turma?')) {
        btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        await fetch(`/api/classes/${id}`, { method: 'DELETE' });
        loadAll();
    }
}

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`view-${tab}`);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick')?.includes(tab)) btn.classList.add('active');
    });
}

function toggleRepoFilter() {
    repoFilter = !repoFilter;
    alertFilter = null;
    const card = document.getElementById('repoFilterCard');
    card.style.border = repoFilter ? '2px solid var(--primary)' : '1px solid transparent';
    card.style.background = repoFilter ? '#fff7ed' : 'var(--light)';
    switchTab('students');
    renderStudentTable();
}

function toggleAlertFilter(type) {
    alertFilter = alertFilter === type ? null : type;
    repoFilter = false;
    const repoCard = document.getElementById('repoFilterCard');
    repoCard.style.border = '1px solid transparent';
    repoCard.style.background = 'var(--light)';
    ['overdue', 'soon'].forEach(t => {
        const card = document.getElementById(t === 'overdue' ? 'alertOverdueCard' : 'alertSoonCard');
        if (card) {
            card.style.outline = alertFilter === t ? '2px solid #ef4444' : 'none';
        }
    });
    switchTab('students');
    renderStudentTable();
}

function updateStats() {
    if (!studentsData) return;
    const totalRepos = studentsData.reduce((acc, s) => acc + (s.reposicoes_count || 0), 0);
    const el = document.getElementById('totalReposicoes');
    if (el) el.innerText = totalRepos;
}

function formatDate(d) {
    if (!d) return '-';
    const p = d.split('-');
    if (p.length < 3) return d;
    return `${p[2]}/${p[1]}`;
}

function formatPrice(val) {
    if (val === undefined || val === null) return '';
    const n = parseFloat(val);
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPriceInput(val) {
    if (val === undefined || val === null) return '';
    const n = parseFloat(val);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toggleMenu() { document.getElementById('sidebar')?.classList.toggle('active'); }
function openClassModal() { document.getElementById('modalClass').style.display = 'flex'; }
function closeModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); }
function filterStudents() { renderStudentTable(); }

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModals(); });
});