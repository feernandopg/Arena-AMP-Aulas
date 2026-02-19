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

# --- NOVO: TABELA DE HISTÓRICO ---
class StudentHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    description = db.Column(db.String(200), nullable=False)
    date_str = db.Column(db.String(20), nullable=False)

class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    plan = db.Column(db.String(20), nullable=False)
    start_date = db.Column(db.String(10), nullable=False)
    end_date = db.Column(db.String(10), nullable=False)
    next_payment = db.Column(db.String(10), nullable=False)
    last_payment = db.Column(db.String(10), nullable=True) 
    classes_per_week = db.Column(db.Integer, default=2) 
    credits = db.Column(db.Integer, default=0) 
    price = db.Column(db.Float, nullable=False)
    
    # --- NOVO: STATUS DO ALUNO ---
    active = db.Column(db.Boolean, default=True)
    
    replacements = db.relationship('Replacement', backref='student', lazy=True, cascade="all, delete-orphan")
    classes = db.relationship('ClassSession', secondary=enrollments, lazy='subquery', backref=db.backref('students', lazy=True))
    # Relacionamento com Histórico
    history_logs = db.relationship('StudentHistory', backref='student', lazy=True, cascade="all, delete-orphan", order_by="desc(StudentHistory.id)")

    def to_dict(self):
        classes_str = ", ".join([f"{c.day[:3]} {c.time}" for c in self.classes])
        return {
            'id': self.id, 'name': self.name, 'plan': self.plan,
            'startDate': self.start_date, 'endDate': self.end_date,
            'nextPayment': self.next_payment, 'lastPayment': self.last_payment,
            'classesPerWeek': self.classes_per_week,
            'credits': self.credits, 
            'price': self.price,
            'active': self.active, # NOVO
            'classes_desc': classes_str,
            'class_ids': [c.id for c in self.classes],
            'reposicoes_count': len(self.replacements),
            'reposicoes_details': [{'id': r.id, 'expires': r.expires_at} for r in self.replacements],
            'history': [{'desc': h.description, 'date': h.date_str} for h in self.history_logs] # NOVO
        }

@login_manager.user_loader
def load_user(uid): 
    return db.session.get(User, int(uid))

# --- FUNÇÃO AUXILIAR PARA CRIAR HISTÓRICO ---
def add_history(student_id, description):
    now_str = datetime.now().strftime('%d/%m/%Y %H:%M')
    log = StudentHistory(student_id=student_id, description=description, date_str=now_str)
    db.session.add(log)

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
        else: msg = "Banco e Admin já existem."
        return f"<h1 style='color:green'>{msg}</h1><a href='/login'>Ir para Login</a>"
    except Exception as e: return f"<h1 style='color:red'>Erro: {str(e)}</h1>"

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and user.check_password(request.form['password']):
            login_user(user)
            return redirect(url_for('index'))
        else: error = "Usuário ou Senha incorretos"
    return render_template('login.html', error=error)

@app.route('/logout')
@login_required
def logout(): logout_user(); return redirect(url_for('login'))

@app.route('/')
@login_required
def index(): return render_template('index.html', user=current_user)

@app.route('/reset-banco-de-dados')
def reset_db():
    try:
        db.drop_all()
        db.create_all()
        admin = User(username='admin')
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()
        return "<h1 style='color:blue'>Banco de Dados RESETADO com sucesso! <a href='/login'>Ir para Login</a></h1>"
    except Exception as e: return f"<h1>Erro: {e}</h1>"

@app.route('/api/classes', methods=['GET', 'POST'])
@login_required
def manage_classes():
    if request.method == 'GET':
        classes = ClassSession.query.all()
        return jsonify([c.to_dict() for c in classes])
    d = request.json
    new_c = ClassSession(day=d['day'], time=d['time'], professor=d['professor'], capacity=int(d['capacity']))
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
    return jsonify({'msg':'ok'})

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

@app.route('/api/students', methods=['GET', 'POST'])
@login_required
def manage_students():
    if request.method == 'GET':
        students = Student.query.all()
        return jsonify([s.to_dict() for s in students])
    
    d = request.json
    saldo_aulas = int(d.get('saldoAulas', 0))

    new_s = Student(
        name=d['name'], plan=d['plan'], price=float(d['price']),
        start_date=d['startDate'], end_date=d['endDate'], 
        next_payment=d['nextPayment'], last_payment=d.get('lastPayment', ''),         
        classes_per_week=int(d.get('classesPerWeek', 2)), credits=saldo_aulas 
    )
    
    if 'classIds' in d:
        for cid in d['classIds']:
            try:
                c = db.session.get(ClassSession, int(cid))
                if c: new_s.classes.append(c)
            except: continue 

    db.session.add(new_s)
    db.session.flush() # Para gerar o ID antes do commit
    
    # Registra no Histórico
    add_history(new_s.id, f"Plano {new_s.plan} iniciado. Início: {new_s.start_date} | Fim: {new_s.end_date}")

    db.session.commit()
    return jsonify(new_s.to_dict())

@app.route('/api/students/<int:id>/update', methods=['PUT'])
@login_required
def update_student_data(id):
    s = db.session.get(Student, id)
    if not s: return jsonify({'error': 'Not found'}), 404
    
    d = request.json
    s.name = d['name']
    s.plan = d['plan']
    s.price = float(d['price'])
    s.start_date = d['startDate']
    s.end_date = d['endDate']
    s.next_payment = d['nextPayment']
    s.last_payment = d.get('lastPayment', '')        
    s.classes_per_week = int(d.get('classesPerWeek', 2)) 
    
    if s.credits != int(d.get('saldoAulas', s.credits)):
        add_history(s.id, f"Saldo de aulas ajustado manualmente de {s.credits} para {d.get('saldoAulas')}")
    s.credits = int(d.get('saldoAulas', s.credits))

    s.classes = [] 
    if 'classIds' in d:
        for cid in d['classIds']:
            try:
                c = db.session.get(ClassSession, int(cid))
                if c: s.classes.append(c)
            except: continue

    db.session.commit()
    return jsonify(s.to_dict())

@app.route('/api/students/<int:id>/delete', methods=['DELETE'])
@login_required
def delete_student(id):
    s = db.session.get(Student, id)
    if s:
        db.session.delete(s)
        db.session.commit()
    return jsonify({'msg':'ok'})

# --- NOVO: ALTERAR STATUS (ATIVO/INATIVO) ---
@app.route('/api/students/<int:id>/toggle_status', methods=['POST'])
@login_required
def toggle_status(id):
    s = db.session.get(Student, id)
    if not s: return jsonify({'error': 'Not found'}), 404
    
    s.active = not s.active
    status_str = "ATIVADO" if s.active else "INATIVADO"
    add_history(s.id, f"Status do aluno alterado para {status_str}")
    
    db.session.commit()
    return jsonify(s.to_dict())

@app.route('/api/students/<int:id>/action', methods=['POST'])
@login_required
def student_action(id):
    s = db.session.get(Student, id)
    if not s: return jsonify({'error': 'Not found'}), 404
    
    action = request.json.get('action')
    
    if action == 'presenca':
        if s.credits > 0: s.credits -= 1
        add_history(s.id, "Aula Normal - Presença Registrada")
            
    elif action == 'falta_com_reposicao':
        if s.credits > 0: s.credits -= 1
        exp = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
        db.session.add(Replacement(student_id=s.id, created_at=datetime.now().strftime('%Y-%m-%d'), expires_at=exp))
        add_history(s.id, "Falta com Aviso - (+1 Reposição Gerada)")
        
    elif action == 'usar_reposicao':
        if s.replacements:
            db.session.delete(s.replacements[0])
            add_history(s.id, "Reposição Utilizada")
            
    elif action == 'anular_reposicao':
        if s.replacements:
            db.session.delete(s.replacements[0])
            add_history(s.id, "Reposição Anulada (Falta na Reposição)")
            
    db.session.commit()
    return jsonify({'success': True, 'credits': s.credits})

if __name__ == '__main__':
    with app.app_context(): db.create_all()
    app.run(host='0.0.0.0', debug=True)