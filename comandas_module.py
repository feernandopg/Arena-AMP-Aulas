"""
Módulo Comandas (PDV/ERP) — migrado de FastAPI/Supabase para Flask/SQLite.
Registrado no app do ecossistema em /comandas (frontend) e /comandas/api/... (dados).
Autenticação: usa o login único do ecossistema (flask-login).

Cobre: clientes, produtos (estoque unitário/fracionado), categorias, comandas (PDV
com pagamento parcial/desconto/troco), fechamento de caixa e relatórios gerenciais.
"""
import os
import calendar
from datetime import datetime, date

from flask import Blueprint, request, jsonify, send_from_directory, abort, Response
from flask_login import login_required, current_user


def _now_iso():
    return datetime.now().isoformat(timespec='seconds')


def register(app, db, User, resource_path):
    if getattr(app, '_comandas_registered', False):
        return
    app._comandas_registered = True
    CM_DIR = resource_path('comandas_static')

    # ── MODELOS ────────────────────────────────────────────────────────────────
    class Categoria(db.Model):
        __tablename__ = 'categorias'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(80), unique=True, nullable=False)

        def to_dict(self):
            return {'id': self.id, 'nome': self.nome}

    class Cliente(db.Model):
        __tablename__ = 'clientes'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(120), nullable=False)
        telefone = db.Column(db.String(30))
        endereco = db.Column(db.String(200))
        cpf = db.Column(db.String(20))
        created_at = db.Column(db.String(40), default=_now_iso)

        def to_dict(self):
            return {'id': self.id, 'nome': self.nome, 'telefone': self.telefone,
                    'endereco': self.endereco, 'cpf': self.cpf,
                    'created_at': self.created_at}

    class Produto(db.Model):
        __tablename__ = 'produtos'
        id = db.Column(db.Integer, primary_key=True)
        nome = db.Column(db.String(120), nullable=False)
        tipo = db.Column(db.String(20), default='unitario')   # unitario | fracionado
        preco_custo = db.Column(db.Float, default=0)
        preco_venda = db.Column(db.Float)
        quantidade = db.Column(db.Integer)
        categoria = db.Column(db.String(80))
        codigo_barras = db.Column(db.String(60))
        # fracionado
        unidade_medida_fracao = db.Column(db.String(20))
        preco_venda_fracao = db.Column(db.Float)
        volume_pai = db.Column(db.Float)
        volume_fracao = db.Column(db.Float)
        total_fracoes = db.Column(db.Integer)
        fracoes_disponiveis = db.Column(db.Integer)
        created_at = db.Column(db.String(40), default=_now_iso)
        updated_at = db.Column(db.String(40), default=_now_iso)

        def to_dict(self):
            return {
                'id': self.id, 'nome': self.nome, 'tipo': self.tipo,
                'preco_custo': self.preco_custo or 0, 'preco_venda': self.preco_venda,
                'quantidade': self.quantidade, 'categoria': self.categoria,
                'codigo_barras': self.codigo_barras,
                'unidade_medida_fracao': self.unidade_medida_fracao,
                'preco_venda_fracao': self.preco_venda_fracao,
                'volume_pai': self.volume_pai, 'volume_fracao': self.volume_fracao,
                'total_fracoes': self.total_fracoes,
                'fracoes_disponiveis': self.fracoes_disponiveis,
                'created_at': self.created_at, 'updated_at': self.updated_at,
            }

    class Comanda(db.Model):
        __tablename__ = 'comandas'
        id = db.Column(db.Integer, primary_key=True)
        cliente_id = db.Column(db.Integer, db.ForeignKey('clientes.id'))
        cliente_nome = db.Column(db.String(120), nullable=False)
        data_abertura = db.Column(db.String(40), default=_now_iso)
        status = db.Column(db.String(20), default='aberta')   # aberta | paga | arquivada
        pagamento = db.Column(db.JSON)
        updated_at = db.Column(db.String(40), default=_now_iso)

        def itens(self):
            return ComandaItem.query.filter_by(comanda_id=self.id).all()

        def total(self):
            return round(sum((i.preco_unitario or 0) * (i.quantidade or 0)
                             for i in self.itens()), 2)

        def to_dict(self, itens=None):
            # aceita itens pré-carregados (evita 1 query por comanda na listagem)
            if itens is None:
                itens = self.itens()
            return {
                'id': self.id, 'cliente_id': self.cliente_id,
                'cliente_nome': self.cliente_nome, 'data_abertura': self.data_abertura,
                'status': self.status, 'pagamento': self.pagamento,
                'updated_at': self.updated_at,
                'total': round(sum((i.preco_unitario or 0) * (i.quantidade or 0) for i in itens), 2),
                'itens': [i.to_dict() for i in itens],
            }

    class CaixaSessao(db.Model):
        __tablename__ = 'caixa_sessoes'
        id = db.Column(db.Integer, primary_key=True)
        status = db.Column(db.String(20), default='aberto')   # aberto | fechado
        valor_abertura = db.Column(db.Float, default=0)        # fundo de troco
        aberto_em = db.Column(db.String(40), default=_now_iso)
        aberto_por = db.Column(db.String(50))
        fechado_em = db.Column(db.String(40))
        fechado_por = db.Column(db.String(50))

    class ComandaItem(db.Model):
        __tablename__ = 'comanda_itens'
        id = db.Column(db.Integer, primary_key=True)
        comanda_id = db.Column(db.Integer, db.ForeignKey('comandas.id'))
        produto_id = db.Column(db.Integer, db.ForeignKey('produtos.id'))
        nome = db.Column(db.String(120))
        quantidade = db.Column(db.Integer, default=1)
        preco_unitario = db.Column(db.Float, default=0)

        def to_dict(self):
            return {'id': self.id, 'comanda_id': self.comanda_id,
                    'produto_id': self.produto_id, 'nome': self.nome,
                    'quantidade': self.quantidade, 'preco_unitario': self.preco_unitario}

    # ── HELPERS DE ESTOQUE ──────────────────────────────────────────────────────
    def _calc_fracionado(p: Produto):
        vp = p.volume_pai or 0
        vf = p.volume_fracao or 0
        qtd = p.quantidade or 0
        p.total_fracoes = int(vp // vf) if (vp > 0 and vf > 0) else 0
        p.fracoes_disponiveis = qtd * (p.total_fracoes or 0)

    def _estoque_baixo(limite=5):
        criticos = []
        for p in Produto.query.all():
            if p.tipo == 'unitario':
                atual = p.quantidade or 0
            else:
                atual = p.fracoes_disponiveis or 0
            if atual <= limite:
                d = p.to_dict()
                d['estoque_atual'] = atual
                d['tipo_estoque'] = p.tipo
                criticos.append(d)
        return sorted(criticos, key=lambda x: x['estoque_atual'])

    def log(desc, category='comandas'):
        """Registra no log global do ecossistema (ActivityLog do app principal)."""
        try:
            fn = getattr(app, 'add_activity', None)
            if fn:
                fn(desc, category=category, action_type=category, system='comandas')
        except Exception:
            pass

    bp = Blueprint('comandas', __name__)

    @bp.before_request
    def cm_guard():
        """Barra acesso de quem não tem permissão pro módulo (o Hub esconde,
        mas URL direta precisa ser bloqueada também)."""
        if not current_user.is_authenticated:
            return None  # cada rota já exige login
        if getattr(current_user, 'is_adm', False) or current_user.can('comandas'):
            return None
        p = request.path
        # relatórios do bar podem ser lidos por quem tem a permissão Relatórios
        if p.startswith('/comandas/api/relatorios') and current_user.can('relatorios'):
            return None
        if p.startswith('/comandas/api'):
            return jsonify({'detail': 'Acesso restrito: sem permissão para o Comandas.'}), 403
        from flask import render_template
        return render_template('nao_autorizado.html'), 403

    # ── FRONTEND ────────────────────────────────────────────────────────────────
    @bp.route('/')
    @login_required
    def cm_index():
        return send_from_directory(CM_DIR, 'index.html')

    @bp.route('/<path:fname>')
    @login_required
    def cm_asset(fname):
        if fname.startswith('api/'):
            abort(404)
        return send_from_directory(CM_DIR, fname)

    # ── CLIENTES ────────────────────────────────────────────────────────────────
    @bp.route('/api/clientes', methods=['GET'])
    @login_required
    def cm_cli_list():
        return jsonify([c.to_dict() for c in Cliente.query.order_by(Cliente.nome).all()])

    @bp.route('/api/clientes', methods=['POST'])
    @login_required
    def cm_cli_create():
        d = request.get_json(silent=True) or {}
        nome = (d.get('nome') or '').strip()
        if not nome:
            return jsonify({'detail': 'Nome é obrigatório.'}), 400
        c = Cliente(nome=nome, telefone=(d.get('telefone') or None),
                    endereco=(d.get('endereco') or None), cpf=(d.get('cpf') or None))
        db.session.add(c)
        log(f"Cliente '{nome}' cadastrado", 'cliente')
        db.session.commit()
        return jsonify(c.to_dict()), 201

    @bp.route('/api/clientes/<int:cid>', methods=['PUT'])
    @login_required
    def cm_cli_update(cid):
        c = db.session.get(Cliente, cid)
        if not c:
            return jsonify({'detail': 'Cliente não encontrado.'}), 404
        d = request.get_json(silent=True) or {}
        for f in ('nome', 'telefone', 'endereco', 'cpf'):
            if f in d and d[f] is not None:
                setattr(c, f, d[f])
        db.session.commit()
        return jsonify(c.to_dict())

    @bp.route('/api/clientes/<int:cid>', methods=['DELETE'])
    @login_required
    def cm_cli_delete(cid):
        c = db.session.get(Cliente, cid)
        if c:
            log(f"Cliente '{c.nome}' excluído", 'exclusao')
            db.session.delete(c)
            db.session.commit()
        return jsonify({'ok': True})

    # ── CATEGORIAS ──────────────────────────────────────────────────────────────
    @bp.route('/api/categorias', methods=['GET'])
    @login_required
    def cm_cat_list():
        return jsonify([c.to_dict() for c in Categoria.query.order_by(Categoria.nome).all()])

    @bp.route('/api/categorias', methods=['POST'])
    @login_required
    def cm_cat_create():
        d = request.get_json(silent=True) or {}
        nome = (d.get('nome') or '').strip()
        if not nome:
            return jsonify({'detail': 'Nome é obrigatório.'}), 400
        existente = Categoria.query.filter_by(nome=nome).first()
        if existente:
            return jsonify(existente.to_dict())
        c = Categoria(nome=nome)
        db.session.add(c)
        db.session.commit()
        return jsonify(c.to_dict()), 201

    @bp.route('/api/categorias/<int:cid>', methods=['PUT'])
    @login_required
    def cm_cat_update(cid):
        c = db.session.get(Categoria, cid)
        if not c:
            return jsonify({'detail': 'Categoria não encontrada.'}), 404
        novo = ((request.get_json(silent=True) or {}).get('nome') or '').strip()
        if not novo:
            return jsonify({'detail': 'Nome é obrigatório.'}), 400
        antigo = c.nome
        c.nome = novo
        Produto.query.filter_by(categoria=antigo).update({'categoria': novo})
        db.session.commit()
        return jsonify(c.to_dict())

    @bp.route('/api/categorias/<int:cid>', methods=['DELETE'])
    @login_required
    def cm_cat_delete(cid):
        c = db.session.get(Categoria, cid)
        if c:
            Produto.query.filter_by(categoria=c.nome).update({'categoria': None})
            db.session.delete(c)
            db.session.commit()
        return jsonify({'ok': True})

    # ── PRODUTOS / ESTOQUE ──────────────────────────────────────────────────────
    @bp.route('/api/produtos', methods=['GET'])
    @login_required
    def cm_prod_list():
        return jsonify([p.to_dict() for p in Produto.query.order_by(Produto.nome).all()])

    @bp.route('/api/produtos/critico', methods=['GET'])
    @login_required
    def cm_prod_critico():
        return jsonify(_estoque_baixo(int(request.args.get('limite', 5))))

    @bp.route('/api/produtos/barcode/<codigo>', methods=['GET'])
    @login_required
    def cm_prod_barcode(codigo):
        p = Produto.query.filter_by(codigo_barras=codigo).first()
        if not p:
            return jsonify({'detail': 'Produto não encontrado para este código de barras.'}), 404
        return jsonify(p.to_dict())

    def _apply_produto(p, d):
        campos = ['nome', 'tipo', 'preco_custo', 'preco_venda', 'quantidade',
                  'categoria', 'codigo_barras', 'unidade_medida_fracao',
                  'preco_venda_fracao', 'volume_pai', 'volume_fracao']
        for f in campos:
            if f in d:
                setattr(p, f, d[f])
        if (p.tipo or 'unitario') == 'fracionado':
            _calc_fracionado(p)
        p.updated_at = _now_iso()

    @bp.route('/api/produtos', methods=['POST'])
    @login_required
    def cm_prod_create():
        d = request.get_json(silent=True) or {}
        if not (d.get('nome') or '').strip():
            return jsonify({'detail': 'Nome é obrigatório.'}), 400
        p = Produto(nome=d['nome'].strip())
        _apply_produto(p, d)
        db.session.add(p)
        log(f"Produto '{p.nome}' cadastrado", 'produto')
        db.session.commit()
        return jsonify(p.to_dict()), 201

    @bp.route('/api/produtos/<int:pid>', methods=['PUT'])
    @login_required
    def cm_prod_update(pid):
        p = db.session.get(Produto, pid)
        if not p:
            return jsonify({'detail': 'Produto não encontrado.'}), 404
        _apply_produto(p, request.get_json(silent=True) or {})
        log(f"Produto '{p.nome}' atualizado", 'produto')
        db.session.commit()
        return jsonify(p.to_dict())

    @bp.route('/api/produtos/<int:pid>', methods=['DELETE'])
    @login_required
    def cm_prod_delete(pid):
        p = db.session.get(Produto, pid)
        if p:
            log(f"Produto '{p.nome}' excluído", 'exclusao')
            db.session.delete(p)
            db.session.commit()
        return jsonify({'ok': True})

    # ── CAIXA (sessão de abertura/fechamento com fundo de troco) ────────────────
    def _caixa_atual():
        return (CaixaSessao.query.filter_by(status='aberto')
                .order_by(CaixaSessao.id.desc()).first())

    @bp.route('/api/caixa', methods=['GET'])
    @login_required
    def cm_caixa_status():
        """Status do caixa + resumo do dia (usado no Hub e no botão do PDV)."""
        sess = _caixa_atual()
        abertas = Comanda.query.filter_by(status='aberta').all()
        na_mesa = round(sum(c.total() for c in abertas), 2)
        hoje = datetime.now().strftime('%Y-%m-%d')
        recebidas = (Comanda.query
                     .filter(Comanda.status.in_(['paga', 'arquivada']))
                     .filter(db.func.substr(Comanda.updated_at, 1, 10) == hoje)
                     .all())
        recebido = round(sum(((c.pagamento or {}).get('valor_final')
                              if (c.pagamento or {}).get('valor_final') is not None
                              else c.total()) for c in recebidas), 2)
        return jsonify({
            'aberto': bool(sess),
            'valor_abertura': sess.valor_abertura if sess else 0,
            'aberto_em': sess.aberto_em if sess else None,
            'aberto_por': sess.aberto_por if sess else None,
            'em_aberto': len(abertas),
            'na_mesa': na_mesa,
            'recebido_hoje': recebido,
        })

    @bp.route('/api/caixa/abrir', methods=['POST'])
    @login_required
    def cm_caixa_abrir():
        if _caixa_atual():
            return jsonify({'detail': 'O caixa já está aberto.'}), 400
        d = request.get_json(silent=True) or {}
        try:
            valor = float(d.get('valor_abertura', 0) or 0)
        except (TypeError, ValueError):
            return jsonify({'detail': 'Valor inválido.'}), 400
        if valor < 0:
            return jsonify({'detail': 'Valor inválido.'}), 400
        try:
            uname = current_user.username
        except Exception:
            uname = 'sistema'
        sess = CaixaSessao(status='aberto', valor_abertura=valor, aberto_por=uname)
        db.session.add(sess)
        log(f"Caixa aberto com R$ {valor:.2f} de fundo de troco", 'caixa')
        db.session.commit()
        return jsonify({'ok': True, 'valor_abertura': valor})

    # ── COMANDAS (PDV) ──────────────────────────────────────────────────────────
    @bp.route('/api/comandas', methods=['GET'])
    @login_required
    def cm_comanda_list():
        comandas = (Comanda.query
                    .filter(Comanda.status.in_(['aberta', 'paga']))
                    .order_by(Comanda.data_abertura.desc()).all())
        # carrega TODOS os itens numa query só e agrupa (em vez de 1 query por comanda)
        ids = [c.id for c in comandas]
        por_comanda = {}
        if ids:
            for i in ComandaItem.query.filter(ComandaItem.comanda_id.in_(ids)).all():
                por_comanda.setdefault(i.comanda_id, []).append(i)
        return jsonify([c.to_dict(por_comanda.get(c.id, [])) for c in comandas])

    @bp.route('/api/comandas', methods=['POST'])
    @login_required
    def cm_comanda_create():
        d = request.get_json(silent=True) or {}
        cli = db.session.get(Cliente, d.get('cliente_id'))
        if not cli:
            return jsonify({'detail': 'Cliente não encontrado.'}), 404
        c = Comanda(cliente_id=cli.id, cliente_nome=cli.nome, status='aberta')
        db.session.add(c)
        db.session.flush()
        log(f"Comanda #{c.id} aberta para {cli.nome}", 'comanda')
        db.session.commit()
        return jsonify(c.to_dict()), 201

    @bp.route('/api/comandas/<int:cid>/itens', methods=['POST'])
    @login_required
    def cm_comanda_add_item(cid):
        d = request.get_json(silent=True) or {}
        qtd = int(d.get('quantidade', 1) or 1)
        comanda = db.session.get(Comanda, cid)
        if not comanda:
            return jsonify({'detail': 'Comanda não encontrada.'}), 404
        if comanda.status != 'aberta':
            return jsonify({'detail': 'Comanda não está aberta.'}), 400
        p = db.session.get(Produto, d.get('produto_id'))
        if not p:
            return jsonify({'detail': 'Produto não encontrado.'}), 404

        if p.tipo == 'fracionado':
            disp = p.fracoes_disponiveis or 0
            if disp < qtd:
                return jsonify({'detail': f'Estoque insuficiente. Disponível: {disp} frações.'}), 400
            preco = p.preco_venda_fracao or 0
            p.fracoes_disponiveis = disp - qtd
        else:
            disp = p.quantidade or 0
            if disp < qtd:
                return jsonify({'detail': f'Estoque insuficiente. Disponível: {disp} unidades.'}), 400
            preco = p.preco_venda or 0
            p.quantidade = disp - qtd

        item = ComandaItem.query.filter_by(comanda_id=cid, produto_id=p.id).first()
        if item:
            item.quantidade += qtd
        else:
            db.session.add(ComandaItem(comanda_id=cid, produto_id=p.id, nome=p.nome,
                                       quantidade=qtd, preco_unitario=preco))
        comanda.updated_at = _now_iso()
        log(f"{qtd}x {p.nome} na comanda #{cid} ({comanda.cliente_nome})", 'consumo')
        db.session.commit()
        return jsonify(comanda.to_dict())

    @bp.route('/api/comandas/<int:cid>/itens/<int:item_id>', methods=['DELETE'])
    @login_required
    def cm_comanda_remove_item(cid, item_id):
        comanda_chk = db.session.get(Comanda, cid)
        if comanda_chk and comanda_chk.status != 'aberta':
            return jsonify({'detail': 'A comanda já foi paga — não é possível alterar os itens.'}), 400
        item = db.session.get(ComandaItem, item_id)
        if not item:
            return jsonify({'detail': 'Item não encontrado.'}), 404
        p = db.session.get(Produto, item.produto_id)
        if p:
            if p.tipo == 'fracionado':
                p.fracoes_disponiveis = (p.fracoes_disponiveis or 0) + item.quantidade
            else:
                p.quantidade = (p.quantidade or 0) + item.quantidade
        db.session.delete(item)
        comanda = db.session.get(Comanda, cid)
        if comanda:
            comanda.updated_at = _now_iso()
            log(f"Item '{item.nome}' removido da comanda #{cid} ({comanda.cliente_nome})", 'consumo')
        db.session.commit()
        return jsonify(comanda.to_dict() if comanda else {'ok': True})

    @bp.route('/api/comandas/<int:cid>/pagar', methods=['POST'])
    @login_required
    def cm_comanda_pagar(cid):
        d = request.get_json(silent=True) or {}
        info = d.get('pagamento_info') or {}
        comanda = db.session.get(Comanda, cid)
        if not comanda:
            return jsonify({'detail': 'Comanda não encontrada.'}), 404
        if comanda.status != 'aberta':
            return jsonify({'detail': 'Esta comanda já foi paga.'}), 400
        if not comanda.itens():
            return jsonify({'detail': 'A comanda está vazia.'}), 400
        comanda.status = 'paga'
        comanda.pagamento = info
        comanda.updated_at = _now_iso()
        formas = ', '.join(sorted({(p.get('forma') or '?') for p in (info.get('pagamentos_recebidos') or [])})) or '—'
        log(f"Comanda #{cid} ({comanda.cliente_nome}) paga — R$ {info.get('valor_final', 0):.2f} ({formas})", 'pagamento')
        db.session.commit()
        return jsonify(comanda.to_dict())

    @bp.route('/api/comandas/<int:cid>', methods=['DELETE'])
    @login_required
    def cm_comanda_delete(cid):
        comanda = db.session.get(Comanda, cid)
        if not comanda:
            return jsonify({'ok': True})
        for item in ComandaItem.query.filter_by(comanda_id=cid).all():
            p = db.session.get(Produto, item.produto_id)
            if p:
                if p.tipo == 'fracionado':
                    p.fracoes_disponiveis = (p.fracoes_disponiveis or 0) + item.quantidade
                else:
                    p.quantidade = (p.quantidade or 0) + item.quantidade
            db.session.delete(item)
        log(f"Comanda #{cid} ({comanda.cliente_nome}) excluída — itens devolvidos ao estoque", 'exclusao')
        db.session.delete(comanda)
        db.session.commit()
        return jsonify({'ok': True})

    @bp.route('/api/comandas/fechar-dia', methods=['POST'])
    @login_required
    def cm_comanda_fechar_dia():
        if Comanda.query.filter_by(status='aberta').count() > 0:
            return jsonify({'detail': 'Ainda há comandas abertas. Feche-as antes de fechar o dia.'}), 400
        pagas = Comanda.query.filter_by(status='paga').all()
        if not pagas and not _caixa_atual():
            return jsonify({'detail': 'Nenhuma comanda paga para fechar.'}), 400
        arquivadas = [c.to_dict() for c in pagas]
        total = sum(((c.get('pagamento') or {}).get('valor_final') or c.get('total') or 0) for c in arquivadas)
        for c in pagas:
            c.status = 'arquivada'
            c.updated_at = _now_iso()
        # encerra a sessão do caixa (se houver)
        sess = _caixa_atual()
        if sess:
            sess.status = 'fechado'
            sess.fechado_em = _now_iso()
            try:
                sess.fechado_por = current_user.username
            except Exception:
                pass
        log(f"Caixa fechado — {len(arquivadas)} comanda(s), R$ {total:.2f}" +
            (f" (troco inicial R$ {sess.valor_abertura:.2f})" if sess else ""), 'caixa')
        db.session.commit()
        return jsonify(arquivadas)

    # ── RELATÓRIOS ──────────────────────────────────────────────────────────────
    def _agregar(comandas):
        prod_map = {p.id: p for p in Produto.query.all()}
        faturamento = 0.0
        custo_total = 0.0
        produtos_vendidos = {}
        clientes_gastos = {}
        formas_pagamento = {}
        fat_dia = {}
        fat_hora = {}

        for c in comandas:
            pag = c.pagamento or {}
            valor = pag.get('valor_final') if pag.get('valor_final') is not None else c.total()
            faturamento += valor or 0

            if c.data_abertura:
                try:
                    dt = datetime.fromisoformat(c.data_abertura.replace('Z', ''))
                    dia = dt.strftime('%Y-%m-%d')
                    fat_dia[dia] = fat_dia.get(dia, 0) + (valor or 0)
                    fat_hora[dt.hour] = fat_hora.get(dt.hour, 0) + (valor or 0)
                except Exception:
                    pass

            for pg in pag.get('pagamentos_recebidos', []) or []:
                forma = pg.get('forma', 'Outros')
                formas_pagamento[forma] = formas_pagamento.get(forma, 0) + (pg.get('valor', 0) or 0)

            cid_key = c.cliente_id or 'sem_cliente'
            if cid_key not in clientes_gastos:
                clientes_gastos[cid_key] = {'nome': c.cliente_nome or 'N/A', 'total_gasto': 0.0, 'visitas': 0}
            clientes_gastos[cid_key]['total_gasto'] += (valor or 0)
            clientes_gastos[cid_key]['visitas'] += 1

            for item in c.itens():
                qtd = item.quantidade or 0
                pv = item.preco_unitario or 0
                orig = prod_map.get(item.produto_id)
                custo_unit = 0
                if orig:
                    if orig.tipo == 'fracionado':
                        tf = orig.total_fracoes or 1
                        custo_unit = (orig.preco_custo or 0) / (tf or 1)
                    else:
                        custo_unit = orig.preco_custo or 0
                custo_total += custo_unit * qtd
                key = item.produto_id or item.nome
                if key not in produtos_vendidos:
                    produtos_vendidos[key] = {'nome': item.nome or 'N/A', 'quantidade': 0,
                                              'faturamento': 0.0, 'lucro': 0.0,
                                              'custo_unit': custo_unit, 'preco_venda_unit': pv}
                produtos_vendidos[key]['quantidade'] += qtd
                produtos_vendidos[key]['faturamento'] += pv * qtd
                produtos_vendidos[key]['lucro'] += (pv - custo_unit) * qtd

        lucro = faturamento - custo_total
        margem = (lucro / faturamento * 100) if faturamento > 0 else 0
        ticket = faturamento / len(comandas) if comandas else 0
        hora_pico = max(fat_hora, key=fat_hora.get) if fat_hora else None
        return {
            'total_comandas': len(comandas),
            'faturamento_bruto': round(faturamento, 2),
            'custo_total': round(custo_total, 2),
            'lucro_bruto': round(lucro, 2),
            'margem_lucro': round(margem, 2),
            'ticket_medio': round(ticket, 2),
            'produtos_vendidos': sorted(produtos_vendidos.values(), key=lambda x: x['quantidade'], reverse=True),
            'ranking_lucrativos': sorted(produtos_vendidos.values(), key=lambda x: x['lucro'], reverse=True),
            'clientes_ranking': sorted(clientes_gastos.values(), key=lambda x: x['total_gasto'], reverse=True),
            'formas_pagamento': [{'forma': k, 'valor': round(v, 2)} for k, v in formas_pagamento.items()],
            'faturamento_por_dia': [{'dia': k, 'valor': round(v, 2)} for k, v in sorted(fat_dia.items())],
            'hora_pico': hora_pico,
            'faturamento_por_hora': [{'hora': k, 'valor': round(v, 2)} for k, v in sorted(fat_hora.items())],
        }

    def _comandas_periodo(status_list, dia_ini, dia_fim):
        """Filtra pela DATA (YYYY-MM-DD) de abertura, comparando só os 10 primeiros
        caracteres de data_abertura — imune a hora/fuso/formato do timestamp."""
        dcol = db.func.substr(Comanda.data_abertura, 1, 10)
        return (Comanda.query
                .filter(Comanda.status.in_(status_list))
                .filter(dcol >= dia_ini)
                .filter(dcol <= dia_fim)
                .order_by(Comanda.data_abertura)
                .all())

    @bp.route('/api/relatorios/fechamento-dia', methods=['POST'])
    @login_required
    def cm_rel_fechamento():
        d = request.get_json(silent=True) or {}
        ref = (d.get('data') or date.today().isoformat())[:10]
        comandas = _comandas_periodo(['arquivada'], ref, ref)
        if not comandas:
            return jsonify({'detail': 'Nenhuma comanda arquivada encontrada para esta data.'}), 404
        dados = _agregar(comandas)
        dados['data_ref'] = ref
        dados['comandas'] = [c.to_dict() for c in comandas]
        return jsonify(dados)

    @bp.route('/api/relatorios/gerencial', methods=['POST'])
    @login_required
    def cm_rel_gerencial():
        d = request.get_json(silent=True) or {}
        di, df = d.get('data_inicio'), d.get('data_fim')
        if not di or not df:
            return jsonify({'detail': 'Informe data_inicio e data_fim.'}), 400
        di, df = di[:10], df[:10]
        if di > df:
            di, df = df, di
        comandas = _comandas_periodo(['arquivada', 'paga'], di, df)
        if not comandas:
            return jsonify({'detail': 'Nenhuma comanda encontrada no período selecionado.'}), 404
        dados = _agregar(comandas)
        dados['data_inicio'], dados['data_fim'] = di, df
        return jsonify(dados)

    @bp.route('/api/relatorios/mensal', methods=['POST'])
    @login_required
    def cm_rel_mensal():
        d = request.get_json(silent=True) or {}
        ano, mes = int(d.get('ano')), int(d.get('mes'))
        ultimo = calendar.monthrange(ano, mes)[1]
        di, df = f'{ano}-{mes:02d}-01', f'{ano}-{mes:02d}-{ultimo:02d}'
        comandas = _comandas_periodo(['arquivada', 'paga'], di, df)
        if not comandas:
            return jsonify({'detail': 'Nenhuma comanda encontrada no período selecionado.'}), 404
        dados = _agregar(comandas)
        # Comparativo mês anterior
        if mes == 1:
            mes_ant, ano_ant = 12, ano - 1
        else:
            mes_ant, ano_ant = mes - 1, ano
        ult_ant = calendar.monthrange(ano_ant, mes_ant)[1]
        comandas_ant = _comandas_periodo(['arquivada', 'paga'],
                                         f'{ano_ant}-{mes_ant:02d}-01',
                                         f'{ano_ant}-{mes_ant:02d}-{ult_ant:02d}')
        if comandas_ant:
            da = _agregar(comandas_ant)
            fb = da['faturamento_bruto']
            dados['comparativo_mes_anterior'] = {
                'mes': mes_ant, 'ano': ano_ant,
                'faturamento_bruto': fb, 'lucro_bruto': da['lucro_bruto'],
                'total_comandas': da['total_comandas'], 'ticket_medio': da['ticket_medio'],
                'variacao_faturamento': round(
                    ((dados['faturamento_bruto'] - fb) / fb * 100) if fb > 0 else 0, 2),
            }
        else:
            dados['comparativo_mes_anterior'] = None
        dados['estoque_critico'] = _estoque_baixo(5)
        dados['ano'], dados['mes'] = ano, mes
        return jsonify(dados)

    # ── BACKUP / RESTORE ────────────────────────────────────────────────────────
    _BK = [
        ('categorias', Categoria, ['id', 'nome']),
        ('clientes', Cliente, ['id', 'nome', 'telefone', 'endereco', 'cpf', 'created_at']),
        ('produtos', Produto, ['id', 'nome', 'tipo', 'preco_custo', 'preco_venda', 'quantidade',
                               'categoria', 'codigo_barras', 'unidade_medida_fracao',
                               'preco_venda_fracao', 'volume_pai', 'volume_fracao',
                               'total_fracoes', 'fracoes_disponiveis', 'created_at', 'updated_at']),
        ('comandas', Comanda, ['id', 'cliente_id', 'cliente_nome', 'data_abertura',
                               'status', 'pagamento', 'updated_at']),
        ('comanda_itens', ComandaItem, ['id', 'comanda_id', 'produto_id', 'nome',
                                        'quantidade', 'preco_unitario']),
        ('caixa_sessoes', CaixaSessao, ['id', 'status', 'valor_abertura', 'aberto_em',
                                        'aberto_por', 'fechado_em', 'fechado_por']),
    ]

    def _so_adm():
        if not getattr(current_user, 'is_adm', False):
            return jsonify({'detail': 'Backup e restauração são restritos ao administrador.'}), 403
        return None

    @bp.route('/api/backup', methods=['GET'])
    @login_required
    def cm_backup():
        guard = _so_adm()
        if guard: return guard
        import json
        data = {'version': '1.0', 'system': 'comandas', 'generated_at': _now_iso()}
        for key, model, fields in _BK:
            data[key] = [{f: getattr(r, f) for f in fields} for r in model.query.all()]
        fname = 'comandas_backup_' + datetime.now().strftime('%Y%m%d_%H%M') + '.json'
        return Response(json.dumps(data, ensure_ascii=False, indent=2),
                        mimetype='application/json',
                        headers={'Content-Disposition': f'attachment; filename="{fname}"'})

    @bp.route('/api/restore', methods=['POST'])
    @login_required
    def cm_restore():
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
        if data.get('system') != 'comandas':
            return jsonify({'detail': 'Este arquivo não é um backup do Comandas.'}), 400
        try:
            for _, model, _f in reversed(_BK):
                model.query.delete(synchronize_session=False)
            db.session.flush()
            counts = {}
            for key, model, fields in _BK:
                n = 0
                for row in data.get(key, []):
                    db.session.add(model(**{fld: row.get(fld) for fld in fields}))
                    n += 1
                counts[key] = n
            log(f"Backup do Comandas restaurado ({sum(counts.values())} registros)", 'config')
            db.session.commit()
            return jsonify({'ok': True, 'counts': counts, 'total': sum(counts.values())})
        except Exception as e:
            db.session.rollback()
            return jsonify({'detail': f'Erro no restore: {e}'}), 500

    app.register_blueprint(bp, url_prefix='/comandas')
