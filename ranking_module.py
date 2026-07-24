"""
Módulo Ranking — migrado de FastAPI/Supabase para Flask/SQLite.
Registrado no app do ecossistema em /ranking (frontend) e /ranking/api/... (dados).
Autenticação: usa o login único do ecossistema (flask-login).
"""
import os
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, send_from_directory, abort
from flask_login import login_required, login_user, logout_user, current_user


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def register(app, db, User, resource_path):
    if getattr(app, '_ranking_registered', False):
        return
    app._ranking_registered = True
    RK_DIR = resource_path('ranking_static')

    # ── MODELOS ────────────────────────────────────────────────────────────────
    class Jogador(db.Model):
        __tablename__ = 'jogadores'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(120), nullable=False)
        modalidade = db.Column(db.String(20), nullable=False)
        categoria = db.Column(db.String(20), nullable=False)
        pontuacao = db.Column(db.Integer, default=0)
        partidas = db.Column(db.Integer, default=0)
        vitorias = db.Column(db.Integer, default=0)
        idade = db.Column(db.String(10))
        telefone = db.Column(db.String(30))

        def to_dict(self):
            return {'id': self.id, 'nome': self.nome, 'modalidade': self.modalidade,
                    'categoria': self.categoria, 'pontuacao': self.pontuacao or 0,
                    'partidas': self.partidas or 0, 'vitorias': self.vitorias or 0,
                    'idade': self.idade, 'telefone': self.telefone}

    class Partida(db.Model):
        __tablename__ = 'partidas'
        id = db.Column(db.Integer, primary_key=True)
        modalidade = db.Column(db.String(20))
        categoria = db.Column(db.String(20))
        tipo = db.Column(db.String(20))
        placar = db.Column(db.String(20))
        vencedores = db.Column(db.JSON)
        perdedores = db.Column(db.JSON)
        created_at = db.Column(db.String(40), default=_now_iso)

    class ParticipantePartida(db.Model):
        __tablename__ = 'participantes_partida'
        id = db.Column(db.Integer, primary_key=True)
        partida_id = db.Column(db.Integer, db.ForeignKey('partidas.id'))
        nome = db.Column(db.String(120))
        resultado = db.Column(db.String(20))
        pontos = db.Column(db.Integer, default=0)

    class Campeonato(db.Model):
        __tablename__ = 'campeonatos'
        id = db.Column(db.Integer, primary_key=True)
        modalidade = db.Column(db.String(20))
        categoria = db.Column(db.String(20))
        status = db.Column(db.String(20), default='em_andamento')
        fase = db.Column(db.String(20), default='fase1')
        rodada_f1 = db.Column(db.Integer, default=1)
        created_at = db.Column(db.String(40), default=_now_iso)
        encerrado_at = db.Column(db.String(40))

    class CampeonatoJogador(db.Model):
        __tablename__ = 'campeonato_jogadores'
        id = db.Column(db.Integer, primary_key=True)
        campeonato_id = db.Column(db.Integer, db.ForeignKey('campeonatos.id'))
        nome = db.Column(db.String(120))
        pts = db.Column(db.Integer, default=0)
        vitorias = db.Column(db.Integer, default=0)
        jogos = db.Column(db.Integer, default=0)
        saldo_games = db.Column(db.Integer, default=0)
        games_sofridos = db.Column(db.Integer, default=0)

    class CampeonatoJogo(db.Model):
        __tablename__ = 'campeonato_jogos'
        id = db.Column(db.Integer, primary_key=True)
        campeonato_id = db.Column(db.Integer, db.ForeignKey('campeonatos.id'))
        fase = db.Column(db.String(20))
        dupla1 = db.Column(db.JSON)
        dupla2 = db.Column(db.JSON)
        placar = db.Column(db.String(20))
        vencedor_dupla = db.Column(db.Integer)
        concluido = db.Column(db.Boolean, default=False)

        def to_dict(self):
            return {'id': self.id, 'campeonato_id': self.campeonato_id, 'fase': self.fase,
                    'dupla1': self.dupla1 or [], 'dupla2': self.dupla2 or [],
                    'placar': self.placar, 'vencedor_dupla': self.vencedor_dupla,
                    'concluido': bool(self.concluido)}

    def log(desc, category='ranking'):
        """Registra no log global do ecossistema (ActivityLog do app principal)."""
        try:
            fn = getattr(app, 'add_activity', None)
            if fn:
                fn(desc, category=category, action_type=category, system='ranking')
        except Exception:
            pass

    bp = Blueprint('ranking', __name__)

    @bp.before_request
    def rk_guard():
        """Barra acesso de quem não tem permissão pro módulo (URL direta)."""
        if not current_user.is_authenticated:
            return None  # cada rota já exige login
        if getattr(current_user, 'is_adm', False) or current_user.can('ranking'):
            return None
        if request.path.startswith('/ranking/api'):
            return jsonify({'detail': 'Acesso restrito: sem permissão para o Ranking.'}), 403
        from flask import render_template
        return render_template('nao_autorizado.html'), 403

    # ── FRONTEND ────────────────────────────────────────────────────────────────
    @bp.route('/')
    @login_required
    def rk_index():
        return send_from_directory(RK_DIR, 'index.html')

    @bp.route('/<path:fname>')
    @login_required
    def rk_asset(fname):
        if fname.startswith('api/'):
            abort(404)
        return send_from_directory(RK_DIR, fname)

    # ── AUTH (usa o login do ecossistema) ──────────────────────────────────────
    @bp.route('/api/auth/me')
    def rk_me():
        if current_user.is_authenticated:
            return jsonify({'user': {'id': current_user.id, 'username': current_user.username}})
        return jsonify({'user': None})

    @bp.route('/api/auth/login', methods=['POST'])
    def rk_login():
        d = request.get_json(silent=True) or {}
        u = User.query.filter_by(username=(d.get('username') or '').strip()).first()
        if u and u.check_password(d.get('password') or ''):
            login_user(u)
            return jsonify({'user': {'id': u.id, 'username': u.username}})
        return jsonify({'detail': 'Usuário ou senha inválidos.'}), 401

    @bp.route('/api/auth/logout', methods=['POST'])
    def rk_logout():
        logout_user()
        return jsonify({'ok': True})

    # ── CONTAS (gerencia os usuários do login único do ecossistema) ─────────────
    @bp.route('/api/contas/', methods=['GET'])
    @login_required
    def rk_contas_list():
        return jsonify([{'id': u.id, 'username': u.username, 'created_at': ''}
                        for u in User.query.order_by(User.username).all()])

    @bp.route('/api/contas/', methods=['POST'])
    @login_required
    def rk_contas_create():
        d = request.get_json(silent=True) or {}
        uname = (d.get('username') or '').strip()
        pwd = d.get('password') or ''
        if not uname or not pwd:
            return jsonify({'detail': 'Usuário e senha obrigatórios.'}), 400
        if User.query.filter_by(username=uname).first():
            return jsonify({'detail': 'Este nome de usuário já existe.'}), 400
        nu = User(username=uname)
        nu.set_password(pwd)
        db.session.add(nu)
        db.session.commit()
        return jsonify({'id': nu.id, 'username': nu.username, 'created_at': ''})

    @bp.route('/api/contas/<int:uid>', methods=['DELETE'])
    @login_required
    def rk_contas_delete(uid):
        if User.query.count() <= 1:
            return jsonify({'detail': 'Não é possível remover o último usuário.'}), 400
        u = db.session.get(User, uid)
        if not u:
            return jsonify({'detail': 'Usuário não encontrado.'}), 400
        db.session.delete(u)
        db.session.commit()
        if current_user.is_authenticated and current_user.id == uid:
            logout_user()
        return jsonify({'ok': True})

    # ── JOGADORES ───────────────────────────────────────────────────────────────
    @bp.route('/api/jogadores/', methods=['GET'])
    @login_required
    def rk_jog_list():
        mod = request.args.get('modalidade')
        cat = request.args.get('categoria')
        q = Jogador.query
        if mod:
            q = q.filter_by(modalidade=mod)
        if cat:
            q = q.filter_by(categoria=cat)
        jogs = q.order_by(Jogador.pontuacao.desc()).all()
        return jsonify([j.to_dict() for j in jogs])

    @bp.route('/api/jogadores/', methods=['POST'])
    @login_required
    def rk_jog_create():
        d = request.get_json(silent=True) or {}
        nome = (d.get('nome') or '').upper()
        if Jogador.query.filter_by(nome=nome, modalidade=d.get('modalidade'),
                                   categoria=d.get('categoria')).first():
            return jsonify({'detail': f"Jogador '{d.get('nome')}' já existe nesta categoria."}), 400
        j = Jogador(nome=nome, modalidade=d.get('modalidade'), categoria=d.get('categoria'),
                    pontuacao=int(d.get('pontuacao', 0) or 0), partidas=int(d.get('partidas', 0) or 0),
                    vitorias=int(d.get('vitorias', 0) or 0),
                    idade=(d.get('idade') or None), telefone=(d.get('telefone') or None))
        db.session.add(j)
        log(f"Jogador '{nome}' cadastrado ({d.get('modalidade')}/{d.get('categoria')})", 'jogador')
        db.session.commit()
        return jsonify(j.to_dict())

    @bp.route('/api/jogadores/<int:jid>', methods=['PUT'])
    @login_required
    def rk_jog_update(jid):
        j = db.session.get(Jogador, jid)
        if not j:
            return jsonify({'detail': 'Jogador não encontrado.'}), 404
        d = request.get_json(silent=True) or {}
        j.nome = (d.get('nome') or j.nome).upper()
        j.modalidade = d.get('modalidade', j.modalidade)
        j.categoria = d.get('categoria', j.categoria)
        j.pontuacao = int(d.get('pontuacao', j.pontuacao) or 0)
        j.partidas = int(d.get('partidas', j.partidas) or 0)
        j.vitorias = int(d.get('vitorias', j.vitorias) or 0)
        j.idade = d.get('idade') or None
        j.telefone = d.get('telefone') or None
        db.session.commit()
        return jsonify(j.to_dict())

    @bp.route('/api/jogadores/<int:jid>', methods=['DELETE'])
    @login_required
    def rk_jog_delete(jid):
        j = db.session.get(Jogador, jid)
        if j:
            log(f"Jogador '{j.nome}' excluído", 'exclusao')
            db.session.delete(j)
            db.session.commit()
        return jsonify({'status': 'success'})

    @bp.route('/api/jogadores/<int:jid>/historico', methods=['DELETE'])
    @login_required
    def rk_jog_reset_hist(jid):
        j = db.session.get(Jogador, jid)
        if not j:
            return jsonify({'detail': 'Jogador não encontrado.'}), 404
        camp_ids = [c.id for c in Campeonato.query.filter_by(
            modalidade=j.modalidade, categoria=j.categoria).all()]
        if camp_ids:
            CampeonatoJogador.query.filter(
                CampeonatoJogador.nome == j.nome,
                CampeonatoJogador.campeonato_id.in_(camp_ids)).delete(synchronize_session=False)
            db.session.commit()
        return jsonify({'status': 'success'})

    # ── PARTIDAS ────────────────────────────────────────────────────────────────
    @bp.route('/api/partidas/', methods=['GET'])
    @login_required
    def rk_part_list():
        mod = request.args.get('modalidade')
        cat = request.args.get('categoria')
        nome = request.args.get('nome')
        q = Partida.query
        if mod:
            q = q.filter_by(modalidade=mod)
        if cat:
            q = q.filter_by(categoria=cat)
        partidas = q.order_by(Partida.created_at.desc()).all()
        out = []
        for p in partidas:
            parts = ParticipantePartida.query.filter_by(partida_id=p.id).all()
            pl = [{'id': x.id, 'nome': x.nome, 'resultado': x.resultado, 'pontos': x.pontos} for x in parts]
            if nome and not any(x['nome'] == nome.upper() for x in pl):
                continue
            out.append({'id': p.id, 'modalidade': p.modalidade, 'categoria': p.categoria,
                        'tipo': p.tipo, 'placar': p.placar, 'vencedores': p.vencedores or [],
                        'perdedores': p.perdedores or [], 'created_at': p.created_at,
                        'participantes_partida': pl})
        return jsonify(out)

    @bp.route('/api/partidas/', methods=['POST'])
    @login_required
    def rk_part_create():
        p = request.get_json(silent=True) or {}
        partida = Partida(modalidade=p.get('modalidade'), categoria=p.get('categoria'),
                          tipo=p.get('tipo'), placar=p.get('placar'),
                          vencedores=p.get('vencedores', []), perdedores=p.get('perdedores', []))
        db.session.add(partida)
        db.session.flush()
        for part in p.get('participantes', []):
            nome_u = (part.get('nome') or '').upper()
            db.session.add(ParticipantePartida(partida_id=partida.id, nome=nome_u,
                                               resultado=part.get('resultado'), pontos=part.get('pontos', 0)))
            jg = Jogador.query.filter_by(nome=nome_u, modalidade=p.get('modalidade'),
                                         categoria=p.get('categoria')).first()
            if jg:
                jg.partidas = (jg.partidas or 0) + 1
                jg.pontuacao = (jg.pontuacao or 0) + int(part.get('pontos', 0) or 0)
                jg.vitorias = (jg.vitorias or 0) + (1 if part.get('resultado') == 'vitoria' else 0)
        venc = ' & '.join(p.get('vencedores') or []) or '—'
        log(f"Partida registrada ({p.get('modalidade')}/{p.get('categoria')}) — vitória de {venc} [{p.get('placar') or 's/ placar'}]", 'partida')
        db.session.commit()
        return jsonify({'status': 'success', 'partida_id': partida.id})

    # ── CAMPEONATOS ─────────────────────────────────────────────────────────────
    @bp.route('/api/campeonatos/', methods=['POST'])
    @login_required
    def rk_camp_create():
        d = request.get_json(silent=True) or {}
        camp = Campeonato(modalidade=d.get('modalidade'), categoria=d.get('categoria'),
                          status='em_andamento', fase='fase1', rodada_f1=1)
        db.session.add(camp)
        db.session.flush()
        for nome in d.get('jogadores', []):
            db.session.add(CampeonatoJogador(campeonato_id=camp.id, nome=nome.upper(),
                                             pts=0, vitorias=0, jogos=0, saldo_games=0, games_sofridos=0))
        log(f"Torneio criado ({camp.modalidade}/{camp.categoria}) com {len(d.get('jogadores', []))} jogadores", 'torneio')
        db.session.commit()
        return jsonify({'id': camp.id, 'modalidade': camp.modalidade, 'categoria': camp.categoria,
                        'status': camp.status, 'fase': camp.fase, 'rodada_f1': camp.rodada_f1})

    @bp.route('/api/campeonatos/historico/jogador', methods=['GET'])
    @login_required
    def rk_camp_hist():
        nome = (request.args.get('nome') or '').upper()
        participacoes = CampeonatoJogador.query.filter_by(nome=nome).all()
        resultado = []
        for p in participacoes:
            camp = db.session.get(Campeonato, p.campeonato_id)
            if not camp or camp.status != 'encerrado':
                continue
            jogos = CampeonatoJogo.query.filter_by(campeonato_id=camp.id).all()
            jdet = [j.to_dict() for j in jogos
                    if nome in ((j.dupla1 or []) + (j.dupla2 or [])) and j.concluido]
            resultado.append({'campeonato_id': camp.id, 'modalidade': camp.modalidade,
                              'categoria': camp.categoria, 'created_at': camp.created_at or '',
                              'pts': p.pts or 0, 'vitorias': p.vitorias or 0, 'jogos': p.jogos or 0,
                              'saldo_games': p.saldo_games or 0, 'jogos_detalhes': jdet})
        resultado.sort(key=lambda x: x['created_at'] or '', reverse=True)
        return jsonify(resultado)

    @bp.route('/api/campeonatos/<int:cid>/jogos', methods=['POST'])
    @login_required
    def rk_camp_jogos(cid):
        jogos = request.get_json(silent=True) or []
        if jogos:
            fase = jogos[0].get('fase')
            existentes = CampeonatoJogo.query.filter_by(campeonato_id=cid, fase=fase).all()
            for j in existentes:
                if not j.concluido:
                    db.session.delete(j)
            db.session.flush()
        criados = []
        for jogo in jogos:
            nj = CampeonatoJogo(campeonato_id=cid, fase=jogo.get('fase'),
                                dupla1=jogo.get('dupla1', []), dupla2=jogo.get('dupla2', []),
                                concluido=False)
            db.session.add(nj)
            db.session.flush()
            criados.append(nj.to_dict())
        db.session.commit()
        return jsonify(criados)

    @bp.route('/api/campeonatos/<int:cid>/jogos/<int:jid>/resultado', methods=['POST'])
    @login_required
    def rk_camp_resultado(cid, jid):
        d = request.get_json(silent=True) or {}
        jogo = db.session.get(CampeonatoJogo, jid)
        if jogo:
            jogo.placar = d.get('placar')
            jogo.vencedor_dupla = d.get('vencedor_dupla')
            jogo.concluido = True
        for upd in d.get('atualizacoes', []):
            jc = CampeonatoJogador.query.filter_by(campeonato_id=cid, nome=(upd.get('nome') or '').upper()).first()
            if jc:
                jc.pts = (jc.pts or 0) + upd.get('pts_delta', 0)
                jc.vitorias = (jc.vitorias or 0) + upd.get('vitorias_delta', 0)
                jc.jogos = (jc.jogos or 0) + upd.get('jogos_delta', 0)
                jc.saldo_games = (jc.saldo_games or 0) + upd.get('saldo_delta', 0)
                jc.games_sofridos = (jc.games_sofridos or 0) + upd.get('sofridos_delta', 0)
        db.session.commit()
        return jsonify({'status': 'success'})

    @bp.route('/api/campeonatos/<int:cid>/fase', methods=['PUT'])
    @login_required
    def rk_camp_fase(cid):
        d = request.get_json(silent=True) or {}
        camp = db.session.get(Campeonato, cid)
        if camp:
            camp.fase = d.get('fase', camp.fase)
            if d.get('rodada_f1') is not None:
                camp.rodada_f1 = d.get('rodada_f1')
            db.session.commit()
        return jsonify({'status': 'success'})

    @bp.route('/api/campeonatos/<int:cid>/encerrar', methods=['POST'])
    @login_required
    def rk_camp_encerrar(cid):
        camp = db.session.get(Campeonato, cid)
        if not camp:
            return jsonify({'status': 'error'})
        jcs = CampeonatoJogador.query.filter_by(campeonato_id=cid).all()
        for jc in jcs:
            jg = Jogador.query.filter_by(nome=jc.nome.upper(), modalidade=camp.modalidade,
                                         categoria=camp.categoria).first()
            if jg:
                jg.pontuacao = (jg.pontuacao or 0) + (jc.pts or 0)
                jg.partidas = (jg.partidas or 0) + (jc.jogos or 0)
                jg.vitorias = (jg.vitorias or 0) + (jc.vitorias or 0)
        camp.status = 'encerrado'
        camp.fase = 'encerrado'
        camp.encerrado_at = _now_iso()
        log(f"Torneio ({camp.modalidade}/{camp.categoria}) encerrado — pontos lançados no ranking oficial", 'torneio')
        db.session.commit()
        return jsonify({'status': 'success'})

    @bp.route('/api/campeonatos/<int:cid>', methods=['DELETE'])
    @login_required
    def rk_camp_delete(cid):
        CampeonatoJogo.query.filter_by(campeonato_id=cid).delete(synchronize_session=False)
        CampeonatoJogador.query.filter_by(campeonato_id=cid).delete(synchronize_session=False)
        camp = db.session.get(Campeonato, cid)
        if camp:
            log(f"Torneio ({camp.modalidade}/{camp.categoria}) cancelado/apagado", 'exclusao')
            db.session.delete(camp)
        db.session.commit()
        return jsonify({'status': 'success'})

    # ── BACKUP / RESTORE ────────────────────────────────────────────────────────
    # Mapa tabela -> (modelo, campos). Ordem importa no restore (pais antes dos filhos).
    _BK_TABLES = [
        ('jogadores', Jogador,
         ['id', 'nome', 'modalidade', 'categoria', 'pontuacao', 'partidas', 'vitorias', 'idade', 'telefone']),
        ('partidas', Partida,
         ['id', 'modalidade', 'categoria', 'tipo', 'placar', 'vencedores', 'perdedores', 'created_at']),
        ('participantes_partida', ParticipantePartida,
         ['id', 'partida_id', 'nome', 'resultado', 'pontos']),
        ('campeonatos', Campeonato,
         ['id', 'modalidade', 'categoria', 'status', 'fase', 'rodada_f1', 'created_at', 'encerrado_at']),
        ('campeonato_jogadores', CampeonatoJogador,
         ['id', 'campeonato_id', 'nome', 'pts', 'vitorias', 'jogos', 'saldo_games', 'games_sofridos']),
        ('campeonato_jogos', CampeonatoJogo,
         ['id', 'campeonato_id', 'fase', 'dupla1', 'dupla2', 'placar', 'vencedor_dupla', 'concluido']),
    ]

    def _so_adm():
        if not getattr(current_user, 'is_adm', False):
            return jsonify({'detail': 'Backup e restauração são restritos ao administrador.'}), 403
        return None

    @bp.route('/api/backup', methods=['GET'])
    @login_required
    def rk_backup():
        guard = _so_adm()
        if guard: return guard
        import json
        from flask import Response
        data = {'version': '1.0', 'system': 'ranking', 'generated_at': _now_iso()}
        for key, model, fields in _BK_TABLES:
            data[key] = [{f: getattr(r, f) for f in fields} for r in model.query.all()]
        fname = 'ranking_backup_' + datetime.now().strftime('%Y%m%d_%H%M') + '.json'
        return Response(json.dumps(data, ensure_ascii=False, indent=2),
                        mimetype='application/json',
                        headers={'Content-Disposition': f'attachment; filename="{fname}"'})

    @bp.route('/api/restore', methods=['POST'])
    @login_required
    def rk_restore():
        guard = _so_adm()
        if guard: return guard
        import json
        f = request.files.get('backup_file')
        if not f or not f.filename:
            return jsonify({'detail': 'Nenhum arquivo enviado.'}), 400
        try:
            data = json.loads(f.read().decode('utf-8'))
        except Exception as e:
            return jsonify({'detail': f'Arquivo inválido: {e}'}), 400
        if data.get('system') != 'ranking':
            return jsonify({'detail': 'Este arquivo não é um backup do Ranking.'}), 400
        try:
            # Substituição total: limpa (filhos antes dos pais) e recarrega preservando os IDs.
            for _, model, _f in reversed(_BK_TABLES):
                model.query.delete(synchronize_session=False)
            db.session.flush()
            counts = {}
            for key, model, fields in _BK_TABLES:
                n = 0
                for row in data.get(key, []):
                    db.session.add(model(**{fld: row.get(fld) for fld in fields}))
                    n += 1
                counts[key] = n
            log(f"Backup do Ranking restaurado ({sum(counts.values())} registros)", 'config')
            db.session.commit()
            return jsonify({'ok': True, 'counts': counts, 'total': sum(counts.values())})
        except Exception as e:
            db.session.rollback()
            return jsonify({'detail': f'Erro no restore: {e}'}), 500

    app.register_blueprint(bp, url_prefix='/ranking')
