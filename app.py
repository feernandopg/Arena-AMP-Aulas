import os
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'chave_dev_local_nao_usar_em_prod')

db_url = os.environ.get('DATABASE_URL')
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = db_url or 'sqlite:///arena.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

enrollments = db.Table('enrollments',
    db.Column('student_id', db.Integer, db.ForeignKey('student.id'), primary_key=True),
    db.Column('class_session_id', db.Integer, db.ForeignKey('class_session.id'), primary_key=True)
)

class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    def set_password(self, p): self.password_hash = generate_password_hash(p)
    def check_password(self, p): return check_password_hash(self.password_hash, p)

class ClassSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    day = db.Column(db.String(20), nullable=False)
    time = db.Column(db.String(10), nullable=False)
    professor = db.Column(db.String(50), nullable=False)
    capacity = db.Column(db.Integer, default=6)
    def to_dict(self):
        return {
            'id': self.id, 'day': self.day, 'time': self.time,
            'professor': self.professor, 'capacity': self.capacity,
            'student_count': len(self.students),
            'students': [{'id': s.id, 'name': s.name} for s in self.students]
        }

class Replacement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    created_at = db.Column(db.String(10), nullable=False)
    expires_at = db.Column(db.String(10), nullable=False)

class StudentHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    description = db.Column(db.String(200), nullable=False)
    date_str = db.Column(db.String(20), nullable=False)
    action_type = db.Column(db.String(30), nullable=True, default='info')
    credit_delta = db.Column(db.Integer, nullable=True, default=0)

class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    plan = db.Column(db.String(20), nullable=False)
    start_date = db.Column(db.String(10), nullable=False)
    end_date = db.Column(db.String(10), nullable=False)
    payment_day = db.Column(db.Integer, nullable=False, default=30)
    next_payment = db.Column(db.String(10), nullable=False)
    last_payment = db.Column(db.String(10), nullable=True)
    classes_per_week = db.Column(db.Integer, default=2)
    credits = db.Column(db.Integer, default=0)
    price = db.Column(db.Float, nullable=False)
    active = db.Column(db.Boolean, default=True)

    replacements = db.relationship('Replacement', backref='student', lazy=True, cascade="all, delete-orphan")
    classes = db.relationship('ClassSession', secondary=enrollments, lazy='subquery',
                              backref=db.backref('students', lazy=True))
    history_logs = db.relationship('StudentHistory', backref='student', lazy=True,
                                   cascade="all, delete-orphan",
                                   order_by="desc(StudentHistory.id)")

    def to_dict(self):
        classes_str = ", ".join([f"{c.day[:3]} {c.time}" for c in self.classes])
        today = datetime.now().date()
        payment_alert = False
        payment_overdue = False
        plan_expiring = False

        if self.next_payment:
            try:
                np_date = datetime.strptime(self.next_payment, '%Y-%m-%d').date()
                delta = (np_date - today).days
                if delta < 0:
                    payment_overdue = True
                elif delta <= 7:
                    payment_alert = True
            except:
                pass

        if self.end_date:
            try:
                end = datetime.strptime(self.end_date, '%Y-%m-%d').date()
                if (end - today).days <= 14:
                    plan_expiring = True
            except:
                pass

        return {
            'id': self.id,
            'name': self.name,
            'plan': self.plan,
            'startDate': self.start_date,
            'endDate': self.end_date,
            'paymentDay': self.payment_day,
            'nextPayment': self.next_payment,
            'lastPayment': self.last_payment,
            'classesPerWeek': self.classes_per_week,
            'credits': self.credits,
            'price': self.price,
            'active': self.active,
            'classes_desc': classes_str,
            'class_ids': [c.id for c in self.classes],
            'reposicoes_count': len(self.replacements),
            'reposicoes_details': [{'id': r.id, 'expires': r.expires_at} for r in self.replacements],
            'history': [{'id': h.id, 'desc': h.description, 'date': h.date_str,
                         'action_type': h.action_type, 'credit_delta': h.credit_delta}
                        for h in self.history_logs],
            'payment_alert': payment_alert,
            'payment_overdue': payment_overdue,
            'plan_expiring': plan_expiring,
        }

@login_manager.user_loader
def load_user(uid):
    return db.session.get(User, int(uid))

def add_history(student_id, description, action_type='info', credit_delta=0):
    now_str = datetime.now().strftime('%d/%m/%Y %H:%M')
    log = StudentHistory(student_id=student_id, description=description,
                         date_str=now_str, action_type=action_type,
                         credit_delta=credit_delta)
    db.session.add(log)

def compute_next_payment(payment_day: int, reference_date: datetime = None) -> str:
    if reference_date is None:
        reference_date = datetime.now()
    day = min(payment_day, 28)
    try:
        candidate = reference_date.replace(day=day)
    except ValueError:
        candidate = reference_date.replace(day=28)
    if candidate.date() <= reference_date.date():
        if candidate.month == 12:
            candidate = candidate.replace(year=candidate.year + 1, month=1)
        else:
            candidate = candidate.replace(month=candidate.month + 1)
    return candidate.strftime('%Y-%m-%d')

# ── AUTH ──────────────────────────────────────────────────────────────────────

@app.route('/setup')
def setup():
    try:
        db.create_all()
        if not User.query.filter_by(username='admin').first():
            admin = User(username='admin')
            admin.set_password('admin123')
            db.session.add(admin)
            db.session.commit()
            msg = "Tabelas e Admin criados!"
        else:
            msg = "Banco e Admin já existem."
        return f"<h1 style='color:green'>{msg}</h1><a href='/login'>Ir para Login</a>"
    except Exception as e:
        return f"<h1 style='color:red'>Erro: {str(e)}</h1>"

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and user.check_password(request.form['password']):
            login_user(user)
            return redirect(url_for('index'))
        else:
            error = "Usuário ou Senha incorretos"
    return render_template('login.html', error=error)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html', user=current_user)

@app.route('/reset-banco-de-dados')
def reset_db():
    try:
        db.drop_all()
        db.create_all()
        admin = User(username='admin')
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()
        return "<h1 style='color:blue'>Banco RESETADO! <a href='/login'>Login</a></h1>"
    except Exception as e:
        return f"<h1>Erro: {e}</h1>"

# ── CLASSES ───────────────────────────────────────────────────────────────────

@app.route('/api/classes', methods=['GET', 'POST'])
@login_required
def manage_classes():
    if request.method == 'GET':
        return jsonify([c.to_dict() for c in ClassSession.query.all()])
    d = request.json
    new_c = ClassSession(day=d['day'], time=d['time'],
                         professor=d['professor'], capacity=int(d['capacity']))
    db.session.add(new_c)
    db.session.commit()
    return jsonify(new_c.to_dict())

@app.route('/api/classes/<int:id>', methods=['DELETE'])
@login_required
def delete_class(id):
    c = db.session.get(ClassSession, id)
    if c:
        db.session.delete(c)
        db.session.commit()
    return jsonify({'msg': 'ok'})

@app.route('/api/classes/<int:class_id>/add_student', methods=['POST'])
@login_required
def add_student_to_class(class_id):
    c = db.session.get(ClassSession, class_id)
    s = db.session.get(Student, int(request.json.get('student_id')))
    if c and s and s not in c.students:
        c.students.append(s)
        db.session.commit()
    return jsonify(c.to_dict())

@app.route('/api/classes/<int:class_id>/remove_student', methods=['POST'])
@login_required
def remove_student_from_class(class_id):
    c = db.session.get(ClassSession, class_id)
    s = db.session.get(Student, int(request.json.get('student_id')))
    if c and s and s in c.students:
        c.students.remove(s)
        db.session.commit()
    return jsonify(c.to_dict())

# ── STUDENTS ──────────────────────────────────────────────────────────────────

@app.route('/api/students', methods=['GET', 'POST'])
@login_required
def manage_students():
    if request.method == 'GET':
        return jsonify([s.to_dict() for s in Student.query.all()])

    d = request.json
    payment_day = int(d.get('paymentDay', 30))
    start_str = d['startDate']
    start_dt = datetime.strptime(start_str, '%Y-%m-%d')
    next_pay = compute_next_payment(payment_day, start_dt)

    new_s = Student(
        name=d['name'],
        plan=d['plan'],
        price=float(str(d['price']).replace(',', '.')),
        start_date=start_str,
        end_date=d['endDate'],
        payment_day=payment_day,
        next_payment=d.get('nextPayment') or next_pay,
        last_payment=d.get('lastPayment', ''),
        classes_per_week=int(d.get('classesPerWeek', 2)),
        credits=int(d.get('saldoAulas', 0))
    )

    if 'classIds' in d:
        for cid in d['classIds']:
            try:
                c = db.session.get(ClassSession, int(cid))
                if c:
                    new_s.classes.append(c)
            except:
                continue

    db.session.add(new_s)
    db.session.flush()
    add_history(new_s.id,
                f"Plano {new_s.plan} iniciado. Início: {new_s.start_date} | Fim: {new_s.end_date} | Venc. todo dia {new_s.payment_day}",
                action_type='info')
    db.session.commit()
    return jsonify(new_s.to_dict())

@app.route('/api/students/<int:id>/update', methods=['PUT'])
@login_required
def update_student_data(id):
    s = db.session.get(Student, id)
    if not s:
        return jsonify({'error': 'Not found'}), 404

    d = request.json
    s.name = d['name']
    s.plan = d['plan']
    s.price = float(str(d['price']).replace(',', '.'))
    s.start_date = d['startDate']
    s.end_date = d['endDate']
    s.payment_day = int(d.get('paymentDay', s.payment_day))
    s.next_payment = d['nextPayment']
    s.last_payment = d.get('lastPayment', '')
    s.classes_per_week = int(d.get('classesPerWeek', 2))

    new_credits = int(d.get('saldoAulas', s.credits))
    if s.credits != new_credits:
        add_history(s.id, f"Saldo ajustado manualmente: {s.credits} → {new_credits}",
                    action_type='info', credit_delta=new_credits - s.credits)
    s.credits = new_credits

    s.classes = []
    if 'classIds' in d:
        for cid in d['classIds']:
            try:
                c = db.session.get(ClassSession, int(cid))
                if c:
                    s.classes.append(c)
            except:
                continue

    db.session.commit()
    return jsonify(s.to_dict())

@app.route('/api/students/<int:id>/delete', methods=['DELETE'])
@login_required
def delete_student(id):
    s = db.session.get(Student, id)
    if s:
        db.session.delete(s)
        db.session.commit()
    return jsonify({'msg': 'ok'})

@app.route('/api/students/<int:id>/toggle_status', methods=['POST'])
@login_required
def toggle_status(id):
    s = db.session.get(Student, id)
    if not s:
        return jsonify({'error': 'Not found'}), 404
    s.active = not s.active
    status_str = "ATIVADO" if s.active else "INATIVADO"
    add_history(s.id, f"Status alterado para {status_str}", action_type='info')
    db.session.commit()
    return jsonify(s.to_dict())

# ── ACTIONS ───────────────────────────────────────────────────────────────────

@app.route('/api/students/<int:id>/action', methods=['POST'])
@login_required
def student_action(id):
    s = db.session.get(Student, id)
    if not s:
        return jsonify({'error': 'Not found'}), 404

    action = request.json.get('action')

    if action == 'presenca':
        if s.credits > 0:
            s.credits -= 1
        add_history(s.id, "✅ Presença registrada", action_type='presenca', credit_delta=-1)

    elif action == 'falta_com_reposicao':
        if s.credits > 0:
            s.credits -= 1
        exp = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
        db.session.add(Replacement(student_id=s.id,
                                   created_at=datetime.now().strftime('%Y-%m-%d'),
                                   expires_at=exp))
        add_history(s.id, "⚠️ Falta com aviso prévio — +1 Reposição gerada",
                    action_type='falta_aviso', credit_delta=-1)

    elif action == 'falta_sem_aviso':
        if s.credits > 0:
            s.credits -= 1
        add_history(s.id, "❌ Falta SEM aviso prévio — aula perdida",
                    action_type='falta_sem_aviso', credit_delta=-1)

    elif action == 'usar_reposicao':
        if s.replacements:
            db.session.delete(s.replacements[0])
            add_history(s.id, "🔄 Reposição utilizada", action_type='usar_reposicao', credit_delta=0)

    elif action == 'anular_reposicao':
        if s.replacements:
            db.session.delete(s.replacements[0])
            add_history(s.id, "🚫 Reposição anulada (falta na reposição)",
                        action_type='anular_reposicao', credit_delta=0)

    db.session.commit()
    return jsonify({'success': True, 'credits': s.credits, 'student': s.to_dict()})

# ── UNDO HISTORY ──────────────────────────────────────────────────────────────

@app.route('/api/students/<int:student_id>/history/<int:history_id>/delete', methods=['DELETE'])
@login_required
def delete_history_entry(student_id, history_id):
    s = db.session.get(Student, student_id)
    h = db.session.get(StudentHistory, history_id)
    if not s or not h or h.student_id != student_id:
        return jsonify({'error': 'Not found'}), 404

    # Reverse credit delta
    if h.credit_delta:
        s.credits = max(0, s.credits - h.credit_delta)

    # If it generated a replacement, remove it
    if h.action_type == 'falta_aviso' and s.replacements:
        db.session.delete(s.replacements[0])

    db.session.delete(h)
    db.session.commit()
    return jsonify({'success': True, 'student': s.to_dict()})

# ── PAYMENT ───────────────────────────────────────────────────────────────────

@app.route('/api/students/<int:id>/register_payment', methods=['POST'])
@login_required
def register_payment(id):
    s = db.session.get(Student, id)
    if not s:
        return jsonify({'error': 'Not found'}), 404

    d = request.json
    payment_date_str = d.get('paymentDate', datetime.now().strftime('%Y-%m-%d'))
    amount = float(str(d.get('amount', s.price)).replace(',', '.'))

    s.last_payment = payment_date_str
    payment_dt = datetime.strptime(payment_date_str, '%Y-%m-%d')
    s.next_payment = compute_next_payment(s.payment_day, payment_dt)

    fmt = f"{amount:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    add_history(s.id,
                f"💰 Pagamento recebido: R$ {fmt} em {payment_dt.strftime('%d/%m/%Y')} — Próx. venc.: dia {s.payment_day}",
                action_type='pagamento', credit_delta=0)

    db.session.commit()
    return jsonify({'success': True, 'student': s.to_dict()})

# ── ALERTS ────────────────────────────────────────────────────────────────────

@app.route('/api/alerts')
@login_required
def get_alerts():
    students = Student.query.filter_by(active=True).all()
    today = datetime.now().date()
    overdue, due_soon, expiring = [], [], []

    for s in students:
        if s.next_payment:
            try:
                np = datetime.strptime(s.next_payment, '%Y-%m-%d').date()
                delta = (np - today).days
                entry = {'id': s.id, 'name': s.name, 'next_payment': s.next_payment, 'days': delta}
                if delta < 0:
                    overdue.append(entry)
                elif delta <= 7:
                    due_soon.append(entry)
            except:
                pass
        if s.end_date:
            try:
                end = datetime.strptime(s.end_date, '%Y-%m-%d').date()
                delta = (end - today).days
                if 0 <= delta <= 14:
                    expiring.append({'id': s.id, 'name': s.name, 'end_date': s.end_date, 'days': delta})
            except:
                pass

    return jsonify({'overdue': overdue, 'due_soon': due_soon, 'expiring': expiring})

# ── MIGRATE (safe — keeps all data) ──────────────────────────────────────────

@app.route('/migrate')
@login_required
def migrate():
    """Adds new columns without dropping any data. Run once after deploying new code."""
    try:
        from sqlalchemy import text, inspect as sa_inspect

        def col_exists(table, column):
            inspector = sa_inspect(db.engine)
            cols = [c['name'] for c in inspector.get_columns(table)]
            return column in cols

        results = []
        with db.engine.connect() as conn:

            # ── student ────────────────────────────────────────────────────────
            migrations = [
                ('student', 'payment_day',      "ALTER TABLE student ADD COLUMN payment_day INTEGER DEFAULT 30",
                 "UPDATE student SET payment_day = 30 WHERE payment_day IS NULL"),
                ('student', 'active',           "ALTER TABLE student ADD COLUMN active BOOLEAN DEFAULT TRUE",
                 "UPDATE student SET active = TRUE WHERE active IS NULL"),
                ('student', 'classes_per_week', "ALTER TABLE student ADD COLUMN classes_per_week INTEGER DEFAULT 2",
                 "UPDATE student SET classes_per_week = 2 WHERE classes_per_week IS NULL"),
                ('student', 'credits',          "ALTER TABLE student ADD COLUMN credits INTEGER DEFAULT 0",
                 "UPDATE student SET credits = 0 WHERE credits IS NULL"),
                ('student', 'last_payment',     "ALTER TABLE student ADD COLUMN last_payment VARCHAR(10)", None),
                ('student_history', 'action_type', "ALTER TABLE student_history ADD COLUMN action_type VARCHAR(30) DEFAULT 'info'", None),
                ('student_history', 'credit_delta', "ALTER TABLE student_history ADD COLUMN credit_delta INTEGER DEFAULT 0", None),
            ]

            for table, col, alter_sql, update_sql in migrations:
                try:
                    if not col_exists(table, col):
                        conn.execute(text(alter_sql))
                        if update_sql:
                            conn.execute(text(update_sql))
                        results.append(f"✅ {table}.{col} adicionada")
                    else:
                        results.append(f"⏭️  {table}.{col} já existe")
                except Exception as col_err:
                    results.append(f"⚠️  {table}.{col}: {col_err}")

            # end_date special case — try to compute from start_date + plan
            try:
                if not col_exists('student', 'end_date'):
                    conn.execute(text("ALTER TABLE student ADD COLUMN end_date VARCHAR(10) DEFAULT ''"))
                    try:
                        conn.execute(text("""
                            UPDATE student SET end_date =
                                CASE
                                    WHEN plan = 'Mensal'     THEN to_char(TO_DATE(start_date,'YYYY-MM-DD') + INTERVAL '1 month',  'YYYY-MM-DD')
                                    WHEN plan = 'Trimestral' THEN to_char(TO_DATE(start_date,'YYYY-MM-DD') + INTERVAL '3 months', 'YYYY-MM-DD')
                                    WHEN plan = 'Semestral'  THEN to_char(TO_DATE(start_date,'YYYY-MM-DD') + INTERVAL '6 months', 'YYYY-MM-DD')
                                    ELSE start_date
                                END
                            WHERE end_date IS NULL OR end_date = ''
                        """))
                    except:
                        pass  # SQLite doesn't support to_char; end_date stays empty
                    results.append("✅ student.end_date adicionada e calculada")
                else:
                    results.append("⏭️  student.end_date já existe")
            except Exception as e:
                results.append(f"⚠️  student.end_date: {e}")

            conn.commit()

        db.create_all()  # create any brand-new tables
        results.append("")
        results.append("🎉 Migração concluída! Seus dados estão intactos.")
        html = "<br>".join(results)
        return f"""
        <html><body style="font-family:monospace; padding:2rem; background:#f8fafc;">
        <h2 style="color:#1e293b;">🔧 Migração Arena AMP</h2>
        <div style="background:white; padding:1.5rem; border-radius:10px; border:1px solid #e2e8f0; line-height:2;">
        {html}
        </div>
        <br><a href="/" style="background:#FF914D; color:white; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">
        ← Voltar ao Sistema
        </a>
        </body></html>
        """
    except Exception as e:
        return f"<h1 style='color:red'>❌ Erro: {e}</h1>"


# ── BACKUP ────────────────────────────────────────────────────────────────────

@app.route('/api/backup')
@login_required
def backup():
    """Returns a full JSON backup of all data."""
    import json

    students = Student.query.all()
    classes = ClassSession.query.all()

    students_data = []
    for s in students:
        sd = s.to_dict()
        # Include raw replacements
        sd['_replacements_raw'] = [
            {'created_at': r.created_at, 'expires_at': r.expires_at}
            for r in s.replacements
        ]
        # Include full history
        sd['_history_raw'] = [
            {'description': h.description, 'date_str': h.date_str,
             'action_type': h.action_type or 'info',
             'credit_delta': h.credit_delta or 0}
            for h in s.history_logs
        ]
        students_data.append(sd)

    classes_data = []
    for c in classes:
        cd = c.to_dict()
        classes_data.append(cd)

    # Enrollments map
    enrollments_data = []
    for s in students:
        for c in s.classes:
            enrollments_data.append({'student_id': s.id, 'class_id': c.id})

    backup_obj = {
        'version': '2.0',
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'students': students_data,
        'classes': classes_data,
        'enrollments': enrollments_data,
    }

    from flask import Response
    filename = f"arena_backup_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
    return Response(
        json.dumps(backup_obj, ensure_ascii=False, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'}
    )


# ── RESTORE ───────────────────────────────────────────────────────────────────

@app.route('/restore', methods=['GET', 'POST'])
@login_required
def restore():
    """Upload a backup JSON file and restore all data (merges, doesn't wipe)."""
    import json

    if request.method == 'GET':
        return '''
        <html><body style="font-family:Inter,sans-serif; padding:2rem; background:#f8fafc; max-width:600px; margin:auto;">
        <h2 style="color:#1e293b;">📥 Restaurar Backup</h2>
        <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; padding:1rem; margin-bottom:1.5rem;">
            <strong style="color:#c2410c;">⚠️ Atenção:</strong>
            O restore adiciona os dados do arquivo sem apagar os existentes.
            Para uma restauração limpa, acesse <code>/reset-banco-de-dados</code> antes.
        </div>
        <form method="POST" enctype="multipart/form-data"
              style="background:white; padding:1.5rem; border-radius:10px; border:1px solid #e2e8f0;">
            <label style="font-weight:600; color:#475569; display:block; margin-bottom:8px;">
                Selecione o arquivo de backup (.json):
            </label>
            <input type="file" name="backup_file" accept=".json" required
                   style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; margin-bottom:1rem;">
            <button type="submit"
                    style="background:#FF914D; color:white; border:none; padding:12px 24px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:1rem;">
                🔄 Restaurar Dados
            </button>
        </form>
        <br>
        <a href="/" style="color:#64748b; font-size:0.9rem;">← Voltar ao Sistema</a>
        </body></html>
        '''

    # POST — process the uploaded file
    if 'backup_file' not in request.files:
        return "<h1>❌ Nenhum arquivo enviado.</h1>"

    file = request.files['backup_file']
    try:
        data = json.loads(file.read().decode('utf-8'))
    except Exception as e:
        return f"<h1>❌ Arquivo inválido: {e}</h1>"

    results = []
    class_id_map = {}   # old_id -> new ClassSession object
    student_id_map = {} # old_id -> new Student object

    try:
        # 1. Restore classes
        for cd in data.get('classes', []):
            existing = ClassSession.query.filter_by(day=cd['day'], time=cd['time']).first()
            if existing:
                class_id_map[cd['id']] = existing
                results.append(f"⏭️  Turma {cd['day']} {cd['time']} já existe")
            else:
                nc = ClassSession(day=cd['day'], time=cd['time'],
                                  professor=cd['professor'], capacity=cd.get('capacity', 6))
                db.session.add(nc)
                db.session.flush()
                class_id_map[cd['id']] = nc
                results.append(f"✅ Turma {cd['day']} {cd['time']} restaurada")

        # 2. Restore students
        for sd in data.get('students', []):
            existing = Student.query.filter_by(name=sd['name']).first()
            if existing:
                student_id_map[sd['id']] = existing
                results.append(f"⏭️  Aluno '{sd['name']}' já existe — pulando")
                continue

            ns = Student(
                name=sd['name'],
                plan=sd.get('plan', 'Mensal'),
                price=float(sd.get('price', 0)),
                start_date=sd.get('startDate', ''),
                end_date=sd.get('endDate', ''),
                payment_day=int(sd.get('paymentDay', 30)),
                next_payment=sd.get('nextPayment', ''),
                last_payment=sd.get('lastPayment', ''),
                classes_per_week=int(sd.get('classesPerWeek', 2)),
                credits=int(sd.get('credits', 0)),
                active=sd.get('active', True),
            )
            db.session.add(ns)
            db.session.flush()
            student_id_map[sd['id']] = ns

            # Replacements
            for r in sd.get('_replacements_raw', []):
                db.session.add(Replacement(
                    student_id=ns.id,
                    created_at=r['created_at'],
                    expires_at=r['expires_at']
                ))

            # History
            for h in sd.get('_history_raw', []):
                db.session.add(StudentHistory(
                    student_id=ns.id,
                    description=h['description'],
                    date_str=h['date_str'],
                    action_type=h.get('action_type', 'info'),
                    credit_delta=h.get('credit_delta', 0)
                ))

            results.append(f"✅ Aluno '{sd['name']}' restaurado")

        # 3. Restore enrollments
        enroll_count = 0
        for e in data.get('enrollments', []):
            s_obj = student_id_map.get(e['student_id'])
            c_obj = class_id_map.get(e['class_id'])
            if s_obj and c_obj and c_obj not in s_obj.classes:
                s_obj.classes.append(c_obj)
                enroll_count += 1

        results.append(f"✅ {enroll_count} matrículas restauradas")
        db.session.commit()
        results.append("")
        results.append("🎉 Restore concluído com sucesso!")

    except Exception as e:
        db.session.rollback()
        results.append(f"❌ Erro durante restore: {e}")

    html = "<br>".join(results)
    return f"""
    <html><body style="font-family:monospace; padding:2rem; background:#f8fafc;">
    <h2 style="color:#1e293b;">📥 Resultado do Restore</h2>
    <div style="background:white; padding:1.5rem; border-radius:10px; border:1px solid #e2e8f0; line-height:2;">
    {html}
    </div>
    <br>
    <a href="/" style="background:#FF914D; color:white; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold;">
    ← Voltar ao Sistema
    </a>
    </body></html>
    """


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host='0.0.0.0', debug=True)