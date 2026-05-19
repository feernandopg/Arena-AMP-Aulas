"""
migrate.py — Migração segura do banco de dados Arena AMP
Adiciona colunas novas sem apagar dados existentes.

Como usar:
  Localmente:  python migrate.py
  No Render:   Adicione uma rota /migrate no app.py (já incluída abaixo)
"""

import os
import sys

# ── Detecta se está rodando standalone ou importado pelo Flask ────────────────
STANDALONE = __name__ == '__main__'

if STANDALONE:
    # Configura o ambiente para rodar fora do Flask
    from app import app, db
    ctx = app.app_context()
    ctx.push()

try:
    from sqlalchemy import text, inspect
    engine = db.engine if not STANDALONE else db.engine

    def column_exists(table, column):
        inspector = inspect(db.engine)
        cols = [c['name'] for c in inspector.get_columns(table)]
        return column in cols

    def run_migration():
        results = []
        
        with db.engine.connect() as conn:
            
            # ── student table ──────────────────────────────────────────────────
            
            # payment_day (dia fixo de vencimento)
            if not column_exists('student', 'payment_day'):
                conn.execute(text("ALTER TABLE student ADD COLUMN payment_day INTEGER DEFAULT 30"))
                conn.execute(text("UPDATE student SET payment_day = 30 WHERE payment_day IS NULL"))
                results.append("✅ Coluna 'payment_day' adicionada na tabela student")
            else:
                results.append("⏭️  Coluna 'payment_day' já existe — pulando")

            # end_date (já existe como end_date no modelo antigo? Verifica)
            if not column_exists('student', 'end_date'):
                conn.execute(text("ALTER TABLE student ADD COLUMN end_date VARCHAR(10) DEFAULT ''"))
                # Tenta calcular end_date a partir do start_date + plano
                conn.execute(text("""
                    UPDATE student SET end_date = 
                        CASE 
                            WHEN plan = 'Mensal' THEN 
                                to_char((TO_DATE(start_date, 'YYYY-MM-DD') + INTERVAL '1 month'), 'YYYY-MM-DD')
                            WHEN plan = 'Trimestral' THEN 
                                to_char((TO_DATE(start_date, 'YYYY-MM-DD') + INTERVAL '3 months'), 'YYYY-MM-DD')
                            WHEN plan = 'Semestral' THEN 
                                to_char((TO_DATE(start_date, 'YYYY-MM-DD') + INTERVAL '6 months'), 'YYYY-MM-DD')
                            ELSE start_date
                        END
                    WHERE end_date IS NULL OR end_date = ''
                """))
                results.append("✅ Coluna 'end_date' adicionada e calculada automaticamente")
            else:
                results.append("⏭️  Coluna 'end_date' já existe — pulando")

            # active
            if not column_exists('student', 'active'):
                conn.execute(text("ALTER TABLE student ADD COLUMN active BOOLEAN DEFAULT TRUE"))
                conn.execute(text("UPDATE student SET active = TRUE WHERE active IS NULL"))
                results.append("✅ Coluna 'active' adicionada na tabela student")
            else:
                results.append("⏭️  Coluna 'active' já existe — pulando")

            # classes_per_week
            if not column_exists('student', 'classes_per_week'):
                conn.execute(text("ALTER TABLE student ADD COLUMN classes_per_week INTEGER DEFAULT 2"))
                conn.execute(text("UPDATE student SET classes_per_week = 2 WHERE classes_per_week IS NULL"))
                results.append("✅ Coluna 'classes_per_week' adicionada na tabela student")
            else:
                results.append("⏭️  Coluna 'classes_per_week' já existe — pulando")

            # credits
            if not column_exists('student', 'credits'):
                conn.execute(text("ALTER TABLE student ADD COLUMN credits INTEGER DEFAULT 0"))
                conn.execute(text("UPDATE student SET credits = 0 WHERE credits IS NULL"))
                results.append("✅ Coluna 'credits' adicionada na tabela student")
            else:
                results.append("⏭️  Coluna 'credits' já existe — pulando")

            # last_payment
            if not column_exists('student', 'last_payment'):
                conn.execute(text("ALTER TABLE student ADD COLUMN last_payment VARCHAR(10)"))
                results.append("✅ Coluna 'last_payment' adicionada na tabela student")
            else:
                results.append("⏭️  Coluna 'last_payment' já existe — pulando")

            # ── student_history table ──────────────────────────────────────────
            
            # action_type
            if not column_exists('student_history', 'action_type'):
                conn.execute(text("ALTER TABLE student_history ADD COLUMN action_type VARCHAR(30) DEFAULT 'info'"))
                results.append("✅ Coluna 'action_type' adicionada em student_history")
            else:
                results.append("⏭️  Coluna 'action_type' já existe — pulando")

            # credit_delta
            if not column_exists('student_history', 'credit_delta'):
                conn.execute(text("ALTER TABLE student_history ADD COLUMN credit_delta INTEGER DEFAULT 0"))
                results.append("✅ Coluna 'credit_delta' adicionada em student_history")
            else:
                results.append("⏭️  Coluna 'credit_delta' já existe — pulando")

            conn.commit()

        # Cria tabelas novas que podem não existir ainda
        db.create_all()
        results.append("✅ Tabelas novas criadas (se não existiam)")
        results.append("")
        results.append("🎉 Migração concluída! Seus dados estão intactos.")
        return results

    if STANDALONE:
        for line in run_migration():
            print(line)
        ctx.pop()

except Exception as e:
    print(f"❌ Erro na migração: {e}")
    if STANDALONE:
        sys.exit(1)