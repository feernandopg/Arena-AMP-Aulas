@echo off
REM ============================================================
REM  Testar o Arena AMP LOCAL (modo dev, sem instalar, sem licenca).
REM  Abre no navegador: Hub + Aulas + Ranking. Login: admin / admin123
REM ============================================================
cd /d "%~dp0"

if not exist ".venv-build312\" (
    echo Criando ambiente de teste (Python 3.12)...
    py -3.12 -m venv .venv-build312
    call .venv-build312\Scripts\activate.bat
    python -m pip install --upgrade pip >nul
    python -m pip install flask flask-sqlalchemy flask-login werkzeug cryptography
) else (
    call .venv-build312\Scripts\activate.bat
)

python run_dev.py
pause
