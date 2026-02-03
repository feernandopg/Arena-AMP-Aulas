import os
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'chave_dev_local_nao_usar_em_prod')

# Banco de Dados
db_url = os.environ.get('DATABASE_URL')
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = db_url or 'sqlite:///arena.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# --- TABELA DE ASSOCIAÇÃO (Aluno <-> Turma) ---
enrollments = db.Table('enrollments',
    db.Column('student_id', db.Integer, db.ForeignKey('student.id'), primary_key=True),
    db.Column('class_session_id', db.Integer, db.ForeignKey('class_session.id'), primary_key=True)
)

# --- MODELOS ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    def set_password(self, p): self.password_hash = generate_password_hash(p)
    def check_password(self, p): return check_password_hash(self.password_hash, p)

class ClassSession(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    day = db.Column(db.String(20), nullable=False) # Segunda, Terça...
    time = db.Column(db.String(10), nullable=False) # 19:00
    professor = db.Column(db.String(50), nullable=False)
    capacity = db.Column(db.Integer, default=6)
    
    def to_dict(self):
        return {
            'id': self.id, 'day': self.day, 'time': self.time,
            'professor': self.professor, 'capacity': self.capacity,
            'student_count': len(self.students) # Conta quantos alunos tem nesta turma
        }

class Replacement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    created_at = db.Column(db.String(10), nullable=False)
    expires_at = db.Column(db.String(10), nullable=False)

class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    plan = db.Column(db.String(20), nullable=False)
    start_date = db.Column(db.String(10), nullable=False)
    end_date = db.Column(db.String(10), nullable=False)
    next_payment = db.Column(db.String(10), nullable=False)
    price = db.Column(db.Float, nullable=False)
    
    # Relacionamentos
    replacements = db.relationship('Replacement', backref='student', lazy=True, cascade="all, delete-orphan")
    classes = db.relationship('ClassSession', secondary=enrollments, lazy='subquery',
                              backref=db.backref('students', lazy=True))

    def to_dict(self):
        # Cria string bonita das turmas (Ex: "Seg 19h, Qua 20h")
        classes_str = ", ".join([f"{c.day[:3]} {c.time}" for c in self.classes])
        
        return {
            'id': self.id, 'name': self.name, 'plan': self.plan,
            'startDate': self.start_date, 'endDate': self.end_date,
            'nextPayment': self.next_payment, 'price': self.price,
            'classes_desc': classes_str,
            'class_ids': [c.id for c in self.classes],
            'reposicoes_count': len(self.replacements),
            'reposicoes_details': [{'id': r.id, 'expires': r.expires_at} for r in self.replacements]
        }

@login_manager.user_loader
def load_user(uid): 
    return db.session.get(User, int(uid)) # Correção do Warning Legacy

# --- ROTAS ---
@app.route('/setup') # Rota de emergência
def setup():
    db.create_all()
    return "Banco atualizado."

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and user.check_password(request.form['password']):
            login_user(user)
            return redirect(url_for('index'))
        else: error = "Inválido"
    return render_template('login.html', error=error)

@app.route('/logout')
@login_required
def logout(): logout_user(); return redirect(url_for('login'))

@app.route('/')
@login_required
def index(): return render_template('index.html', user=current_user)

# --- API TURMAS (ESTA PARTE ESTAVA FALTANDO OU ERRADA) ---
@app.route('/api/classes', methods=['GET', 'POST'])
@login_required
def manage_classes():
    if request.method == 'GET':
        # Ordenar dias logicamente seria ideal, mas vamos simplificar
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

# --- API ALUNOS ---
@app.route('/api/students', methods=['GET', 'POST'])
@login_required
def manage_students():
    if request.method == 'GET':
        students = Student.query.all()
        return jsonify([s.to_dict() for s in students])
    
    d = request.json
    new_s = Student(
        name=d['name'], plan=d['plan'], price=float(d['price']),
        start_date=d['startDate'], end_date=d['endDate'], next_payment=d['nextPayment']
    )
    
    # Vincular turmas (Segurança: verifica se classIds existe)
    if 'classIds' in d:
        for cid in d['classIds']:
            # GARANTIA: Converte para int antes de buscar no banco
            try:
                class_id_int = int(cid) 
                c = db.session.get(ClassSession, class_id_int)
                if c: new_s.classes.append(c)
            except:
                continue # Se der erro no ID, pula

    db.session.add(new_s)
    db.session.commit()
    return jsonify(new_s.to_dict())

@app.route('/api/students/<int:id>/reposicao', methods=['POST'])
@login_required
def update_reposicao(id):
    s = db.session.get(Student, id)
    if not s: return jsonify({'error': 'Not found'}), 404
    
    change = request.json.get('change', 0)
    if change > 0:
        val = datetime.now() + timedelta(days=30)
        db.session.add(Replacement(student_id=s.id, created_at=datetime.now().strftime('%Y-%m-%d'), expires_at=val.strftime('%Y-%m-%d')))
    elif change < 0:
        rep = Replacement.query.filter_by(student_id=id).order_by(Replacement.expires_at.asc()).first()
        if rep: db.session.delete(rep)
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

if __name__ == '__main__':
    with app.app_context(): db.create_all()
    app.run(debug=True)