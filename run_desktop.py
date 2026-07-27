r"""
run_desktop.py — Ponto de entrada do app instalável Arena AMP.

Abre o sistema numa JANELA NATIVA própria (pywebview) — sem a barra do Edge,
título com o nome da arena e ícone da marca. Se o pywebview não estiver
disponível/empacotado (ou falhar em runtime), cai automaticamente pro Microsoft
Edge em modo --app, que é o caminho antigo e robusto. No pior caso, abre igual
antes — o cliente nunca fica sem janela.

Sequência:
  1. Sobe o Flask local (127.0.0.1) numa porta livre.
  2. Abre a janela na "portaria" de licença (/_gate), que valida ANTES de liberar.
       - sem chave  → tela de ativação
       - cortada    → tela de bloqueio
       - ok         → entra no sistema
Os dados ficam no PC, em %APPDATA%\ArenaAMP\arena.db.
"""
import os
import socket
import threading
import time
import subprocess
import tempfile
import urllib.request
import webbrowser

from flask import jsonify, request
from flask_login import logout_user

import license_client
from app import app as flask_app, db, User, _local_data_dir
try:
    from version import APP_VERSION
except Exception:
    APP_VERSION = '999'

# Nome do mutex — precisa BATER com o AppMutex do installer.iss, pra o
# instalador conseguir fechar o app antes de sobrescrever os arquivos.
APP_MUTEX = 'ArenaAMP_Running_Mutex'

# Contato exibido na tela de bloqueio.
SUPPORT_CONTACT = "Fernando · WhatsApp (11) 97244-7927 · fehgodinho98@gmail.com"

_flask_started = False
_base_url = None
_last_beat = time.time()


def _log(msg):
    """Registra passos da inicialização em %APPDATA%\\ArenaAMP\\launcher.log."""
    try:
        with open(os.path.join(_local_data_dir(), 'launcher.log'), 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S') + '  ' + msg + '\n')
    except Exception:
        pass


_mutex_handle = None
def _create_mutex():
    """Cria o mutex nomeado (Windows) que o instalador (AppMutex no installer.iss)
    usa pra detectar o app aberto e fechá-lo antes de atualizar. Mantido vivo
    enquanto o processo existir."""
    global _mutex_handle
    if os.name != 'nt':
        return
    try:
        import ctypes
        _mutex_handle = ctypes.windll.kernel32.CreateMutexW(None, False, APP_MUTEX)
    except Exception as e:
        _log('não foi possível criar o mutex: ' + repr(e))


def _free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _ensure_admin():
    with flask_app.app_context():
        db.create_all()
        admin = User.query.filter_by(username='admin').first()
        if not admin:
            admin = User(username='admin', role='adm', perms='aulas,ranking,comandas')
            admin.set_password('admin123')
            db.session.add(admin)
            db.session.commit()
        elif not getattr(admin, 'is_adm', False):
            admin.role = 'adm'
            db.session.commit()
    # backup automático semanal do banco inteiro (%APPDATA%\ArenaAMP\backups)
    try:
        from app import auto_backup
        auto_backup()
    except Exception:
        pass


def _start_flask_once():
    global _flask_started, _base_url
    if _flask_started:
        return _base_url
    port = _free_port()
    _base_url = f'http://127.0.0.1:{port}/'
    _ensure_admin()

    def run():
        flask_app.run(host='127.0.0.1', port=port,
                      threaded=True, use_reloader=False, debug=False)

    threading.Thread(target=run, daemon=True).start()
    for _ in range(60):
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    _flask_started = True
    return _base_url


# ── Portaria de licença servida pelo Flask ────────────────────────────────────
@flask_app.route('/_gate')
def _gate_page():
    # Por padrão força logout a cada abertura (PC compartilhado não pode abrir
    # já logado como quem usou por último). MAS se o usuário marcou "Manter
    # conectado neste computador", respeita: não desloga, e ele entra direto.
    try:
        from app import get_setting
        keep = (get_setting('remember_login', '') == '1')
    except Exception:
        keep = False
    if not keep:
        logout_user()
    return GATE_HTML.replace('__TITLEBAR__', '').replace('__SUPPORT__', SUPPORT_CONTACT)


@flask_app.route('/_gate/state')
def _gate_state():
    return jsonify(license_client.check_license())


@flask_app.route('/_gate/activate', methods=['POST'])
def _gate_activate():
    key = (request.get_json(silent=True) or {}).get('key', '')
    return jsonify(license_client.activate(key))


@flask_app.route('/_gate/update', methods=['POST'])
def _gate_update():
    """Baixa o instalador da atualização (URL vem ASSINADA pelo servidor) e o
    executa, encerrando o app pra liberar os arquivos. Só roda quando a
    checagem de licença retornou status 'update_required'."""
    st = license_client.check_license()
    if st.get('status') != 'update_required':
        return jsonify({'ok': False, 'reason': 'sem_atualizacao'})
    url = (st.get('download_url') or '').strip()
    if not url:
        return jsonify({'ok': False, 'reason': 'sem_url'})
    try:
        dest = os.path.join(tempfile.gettempdir(), 'ArenaAMP-Setup.exe')
        req = urllib.request.Request(url, headers={'User-Agent': 'ArenaAMP-Updater'})
        with urllib.request.urlopen(req, timeout=license_client.NETWORK_TIMEOUT) as r, \
                open(dest, 'wb') as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                f.write(chunk)
        _log('atualização baixada em ' + dest + ' — lançando instalador')
    except Exception as e:
        _log('falha ao baixar atualização: ' + repr(e))
        return jsonify({'ok': False, 'reason': 'download_falhou'})
    # Lança o instalador e encerra o app (libera os arquivos pra sobrescrever).
    try:
        subprocess.Popen([dest])
    except Exception as e:
        _log('falha ao lançar instalador: ' + repr(e))
        return jsonify({'ok': False, 'reason': 'exec_falhou'})
    threading.Timer(1.0, lambda: os._exit(0)).start()
    return jsonify({'ok': True})


# ── "Batimento" janela↔servidor: mantém o backend vivo só enquanto a janela existe ──
@flask_app.route('/_beat')
def _beat():
    global _last_beat
    _last_beat = time.time()
    return ''


@flask_app.after_request
def _inject_beat(resp):
    try:
        if resp.content_type and resp.content_type.startswith('text/html'):
            html = resp.get_data(as_text=True)
            if '</body>' in html:
                tag = "<script>setInterval(function(){fetch('/_beat').catch(function(){})},3000);</script>"
                resp.set_data(html.replace('</body>', tag + '</body>'))
    except Exception:
        pass
    return resp


def _watchdog():
    # Espera a janela carregar (inclui o cold-start de ~30s da licença) antes de vigiar.
    time.sleep(40)
    while True:
        if time.time() - _last_beat > 12:
            _log('watchdog: sem batimento — janela fechada, encerrando')
            os._exit(0)
        time.sleep(3)


# ── Janela do app ─────────────────────────────────────────────────────────────
# Preferência: janela NATIVA própria (pywebview) — sem a barra do Edge, título
# com o nome da arena, ícone da marca. Se o pywebview não estiver disponível ou
# falhar (ex.: empacotamento/WebView2), cai automaticamente pro Edge --app, que
# é o caminho antigo e robusto. Assim, no pior caso, o app abre igual antes.
def _window_title():
    try:
        from app import get_setting
        with flask_app.app_context():
            nome = (get_setting('arena_name', '') or '').strip()
        return nome or 'Arena AMP'
    except Exception:
        return 'Arena AMP'


def _find_edge():
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.join(os.environ.get('LOCALAPPDATA', ''), r"Microsoft\Edge\Application\msedge.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def _open_window_edge(url):
    """Abre via Edge --app e retorna imediatamente (fire-and-forget). O watchdog
    cuida do fim (batimento /_beat). É o fallback robusto."""
    # O watchdog só faz sentido no caminho Edge (fire-and-forget). Na janela
    # nativa NÃO usamos ele — senão, ao minimizar, os beats poderiam parar e o
    # app se encerraria sozinho. Lá o webview.start() já cuida do fechar.
    threading.Thread(target=_watchdog, daemon=True).start()
    edge = _find_edge()
    if edge:
        profile = os.path.join(_local_data_dir(), 'edge-profile')
        _log('abrindo janela via Edge: ' + edge)
        try:
            subprocess.Popen([
                edge, f'--app={url}',
                f'--user-data-dir={profile}',
                '--no-first-run', '--no-default-browser-check',
                '--window-size=1180,800',
            ])
            return
        except Exception as e:
            _log('falha ao abrir Edge (' + repr(e) + '), usando navegador padrão')
    else:
        _log('Edge não encontrado, usando navegador padrão')
    try:
        webbrowser.open(url)
    except Exception as e:
        _log('falha ao abrir navegador: ' + repr(e))


def _open_window(url):
    """Abre a janela do app via Edge --app (janela dedicada, sem abas/barra de
    endereço). É o caminho único e robusto — o pywebview foi descartado porque
    depende do pythonnet, que não empacota de forma confiável com o Nuitka."""
    _open_window_edge(url)




GATE_HTML = """
<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0A1420">
<title>Arena AMP</title>
<style>
  *{box-sizing:border-box;} body{margin:0;font-family:system-ui,Segoe UI,sans-serif;
    background:linear-gradient(160deg,#0f172a,#1e293b);color:#e2e8f0;height:100vh;
    display:grid;place-items:center;}
  .box{width:min(420px,90vw);background:#1e293b;border:1px solid #334155;border-radius:16px;
    padding:2.2rem;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);}
  h1{font-size:1.5rem;margin:.2rem 0 .1rem;} .sub{color:#94a3b8;font-size:.9rem;margin-bottom:1.5rem;transition:opacity .3s;}
  .logo{font-size:2.4rem;}
  input{width:100%;padding:13px;border-radius:10px;border:1px solid #475569;background:#0f172a;
    color:#fff;font-size:1.1rem;text-align:center;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;}
  button{width:100%;padding:13px;border:none;border-radius:10px;background:#f97316;color:#fff;
    font-weight:700;font-size:1rem;cursor:pointer;} button:disabled{opacity:.5;cursor:default;}
  .msg{margin-top:12px;font-size:.9rem;min-height:20px;}
  .err{color:#f87171;} .contact{color:#fbbf24;font-weight:600;margin-top:8px;}
  .spin{display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;
    border-radius:50%;animation:s .7s linear infinite;vertical-align:middle;} @keyframes s{to{transform:rotate(360deg)}}
  .spin.big{width:44px;height:44px;border-width:4px;border-color:#f97316;border-top-color:transparent;}
</style></head><body>
__TITLEBAR__
<div class="box" id="box">
  <div class="logo" id="logo"><span class="spin big"></span></div>
  <h1 id="title">Verificando licença…</h1>
  <div class="sub" id="subtitle">Conectando ao servidor…</div>
  <div id="form" style="display:none;">
    <input id="key" placeholder="AMP-XXXX-XXXX-XXXX" maxlength="19" autocomplete="off">
    <button id="btn" onclick="doActivate()">Ativar sistema</button>
  </div>
  <div id="retry" style="display:none;"><button onclick="init()">Tentar novamente</button></div>
  <div id="update" style="display:none;"><button id="upbtn" onclick="doUpdate()">Baixar e instalar atualização</button></div>
  <div class="msg" id="msg"></div>
</div>
<script>
  const $ = id => document.getElementById(id);
  const SUPPORT = "__SUPPORT__";
  let _timers = [];
  function clearTimers(){ _timers.forEach(clearTimeout); _timers = []; }
  function setSub(t){ const el=$('subtitle'); el.style.opacity=0; setTimeout(()=>{el.textContent=t; el.style.opacity=1;},150); }
  function startWaitHints(){
    clearTimers();
    _timers.push(setTimeout(()=>setSub('O servidor está iniciando — a 1ª conexão pode levar até 30 segundos…'),4000));
    _timers.push(setTimeout(()=>setSub('Quase lá, aguarde só mais um instante…'),18000));
  }
  function show(el,on){ $(el).style.display = on?'block':'none'; }

  async function init(){
    $('box').classList.remove('blocked');
    $('logo').innerHTML='<span class="spin big"></span>';
    $('title').textContent='Verificando licença…';
    $('subtitle').textContent='Conectando ao servidor…'; $('msg').textContent='';
    show('form',false); show('retry',false); show('update',false);
    startWaitHints();
    try {
      const st = await (await fetch('/_gate/state')).json();
      clearTimers(); render(st);
    } catch(e){
      clearTimers();
      $('logo').textContent='⚠️'; $('title').textContent='Não foi possível verificar';
      $('subtitle').textContent='Houve um problema ao validar a licença. Tente novamente.';
      show('retry',true);
    }
  }

  function render(st){
    if(st.status==='ok'){
      $('logo').textContent='✅'; $('title').textContent='Acesso liberado';
      $('subtitle').textContent='Abrindo o sistema…';
      location.href='/'; return;
    }
    if(st.status==='need_key'){
      $('logo').textContent='🔑'; $('title').textContent='Ativar Arena AMP';
      $('subtitle').textContent='Digite a chave de licença que você recebeu.';
      show('form',true); $('key').focus(); return;
    }
    if(st.status==='update_required'){
      $('logo').textContent='⬆️'; $('title').textContent='Atualização obrigatória';
      $('subtitle').innerHTML='Há uma nova versão do sistema.<br>Atualize para continuar usando.';
      $('upbtn').disabled=false; $('upbtn').textContent='Baixar e instalar atualização';
      show('update',true); return;
    }
    $('logo').textContent = st.status==='offline_blocked' ? '📡' : '🔒';
    if(st.status==='offline_blocked'){
      $('title').textContent='Sem conexão';
      $('subtitle').textContent='Conecte-se à internet para validar a licença e continuar usando.';
    } else {
      $('title').textContent='Acesso suspenso';
      $('subtitle').innerHTML='Este sistema está temporariamente desativado.<br>Entre em contato para regularizar:';
      $('msg').innerHTML='<div class="contact">'+SUPPORT+'</div>';
    }
    show('retry',true);
  }

  async function doActivate(){
    const key = $('key').value.trim();
    if(!key){ $('msg').innerHTML='<span class="err">Digite a chave.</span>'; return; }
    $('btn').disabled=true; $('btn').innerHTML='<span class="spin"></span> Validando…'; $('msg').textContent='';
    setSub('Validando sua licença…'); startWaitHints();
    let st;
    try {
      st = await (await fetch('/_gate/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})})).json();
    } catch(e){
      clearTimers(); $('btn').disabled=false; $('btn').textContent='Ativar sistema';
      $('msg').innerHTML='<span class="err">Erro ao validar. Tente novamente.</span>'; return;
    }
    clearTimers(); $('btn').disabled=false; $('btn').textContent='Ativar sistema';
    if(st.status==='ok'){ render(st); return; }
    if(st.status==='update_required'){ render(st); return; }
    if(st.status==='need_key'){ $('msg').innerHTML='<span class="err">Chave inválida.</span>'; return; }
    if(st.status==='offline_blocked'){ $('msg').innerHTML='<span class="err">Sem internet para validar. Conecte-se e tente de novo.</span>'; return; }
    $('msg').innerHTML='<span class="err">Licença não reconhecida ou suspensa.</span>';
  }

  async function doUpdate(){
    $('upbtn').disabled=true; $('upbtn').innerHTML='<span class="spin"></span> Baixando atualização…';
    $('msg').textContent='Isso pode levar um minuto. Não feche o sistema.';
    let r;
    try {
      r = await (await fetch('/_gate/update',{method:'POST'})).json();
    } catch(e){
      // O app pode encerrar no meio (esperado) — se a resposta sumir, é porque
      // o instalador já abriu. Só mostramos erro se claramente falhou antes.
      $('msg').innerHTML='<span class="err">Se o instalador não abrir, verifique sua internet e tente de novo.</span>';
      $('upbtn').disabled=false; $('upbtn').textContent='Baixar e instalar atualização'; return;
    }
    if(r && r.ok){
      $('logo').textContent='⬇️'; $('title').textContent='Instalando…';
      $('subtitle').textContent='O instalador vai abrir. Siga os passos para concluir.';
      show('update',false); $('msg').textContent='';
      return;
    }
    $('upbtn').disabled=false; $('upbtn').textContent='Tentar novamente';
    $('msg').innerHTML='<span class="err">Não foi possível baixar a atualização. Verifique a internet.</span>';
  }

  document.addEventListener('input', e=>{
    if(e.target.id!=='key') return;
    let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(v.startsWith('AMP')) v=v.slice(3);
    let out='AMP',i=0; while(i<v.length){ out+='-'+v.slice(i,i+4); i+=4; }
    e.target.value=out;
  });
  init();
</script>
</body></html>
"""


def main():
    _log('=== iniciando Arena AMP ===')
    _create_mutex()
    base = _start_flask_once()
    _log('flask no ar em ' + base)
    # OBS: o watchdog é iniciado dentro de _open_window_edge (só no fallback Edge).
    # Na janela nativa (pywebview) ele não roda — o webview.start() controla o fim.
    _open_window(base + '_gate')
    _log('janela solicitada; mantendo servidor vivo')
    # Mantém o processo vivo enquanto a janela estiver aberta.
    # O watchdog encerra sozinho quando os "batimentos" param (janela fechada).
    while True:
        time.sleep(1)


if __name__ == '__main__':
    main()
