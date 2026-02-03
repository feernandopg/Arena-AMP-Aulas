from app import app, db, User
import os

if os.path.exists('arena.db'):
    os.remove('arena.db')
    print("Banco antigo removido.")

with app.app_context():
    db.create_all()
    
    # Cria Admin
    admin = User(username='admin')
    admin.set_password('admin123')
    db.session.add(admin)
    db.session.commit()
    print("Novo Sistema 2.0 Iniciado! Login: admin / admin123")