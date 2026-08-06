# 📗 MANUAL — Arena AMP (App Desktop) · para futuros agentes

> **Leia inteiro antes de mexer.** Este é o **app de produção** do cliente
> **Arena AMP** (gestão de arena de beach tennis), já em produção na versão
> **3.17**. Marca do desenvolvedor: **PG SYSTEMS** (Fernando).
> Repositório GitHub: **`feernandopg/pg-systems-app`** (público, branch `main`).

Esta é a **pasta real de produção do APP**. O outro projeto (o servidor de
licença / painel `/admin`) fica em `Desktop\Arena AMP - Servidor (admin)` — veja
o MANUAL de lá. A base genérica reutilizável fica em `Desktop\SISTEMA-BASE
(esqueleto)`.

---

## 1. O que é / como roda

App de **desktop Windows**: um **Flask** local (`127.0.0.1`) servido numa janela
dedicada do **Microsoft Edge em modo `--app`** (sem abas/barra de endereço).
Compilado com **Nuitka** (protege o fonte) e empacotado com **Inno Setup**.

- **Todos os dados do cliente ficam no PC dele** (SQLite em `%APPDATA%\ArenaAMP\arena.db`).
  Nada de dado operacional vai pra nuvem.
- Antes de abrir, valida a **licença** no servidor (Ed25519, 1 PC, 5 dias offline).
- **Não usa `pywebview`/WebView2** (o `pythonnet` não empacota com Nuitka). Por
  isso o ícone da barra de tarefas é o do Edge — limitação conhecida e aceita.

```
Cliente clica no atalho → run_desktop.py (o exe) sobe o Flask + valida licença
   → se ok, abre a janela Edge --app apontando pro Flask local
   → se versão < min_version do servidor, trava e atualiza sozinho
```

---

## 2. Mapa dos arquivos

```
app.py               Flask principal: backbone (login, hub, shell, config, backup,
                     MP relay, update relay) + o MÓDULO AULAS inline (modelos
                     Student/ClassSession/... e rotas /api/students, /api/classes).
run_desktop.py       Lançador do .exe: gate de licença (/_gate), janela Edge,
                     watchdog, e TODO o fluxo de atualização (baixa+instala).
license_client.py    Validação Ed25519 (online + offline), machine binding,
                     relay de checkout/assinatura, clear_key (usar outra chave).
version.py           APP_VERSION (3.17) e PRODUCT ('arena'). Fonte da lógica de update.
build.bat            Compila com Nuitka + MinGW (Python 3.12). --file-version aqui.
installer.iss        Inno Setup: gera o instalador. CONTÉM o fix do update (§6).
run_dev.py / .bat    Roda em dev no navegador (AMP_DEV=1, login admin/admin123).
requirements-desktop.txt
mingwfix/            Header que falta no MinGW (structuredquerycondition.h).
templates/           shell.html, hub.html, login.html, configuracoes.html,
                     assinatura.html, index.html (UI do Aulas), nao_autorizado.html
static/              logo.ico, logo.png, style.css+script.js (Aulas), nochrome.js
ranking_module.py    Módulo Ranking (register(app,db,User,resource_path)); /ranking
ranking_static/      frontend do Ranking (vanilla)
comandas_module.py   Módulo Comandas (PDV, estoque, caixa); /comandas
comandas_static/     frontend do Comandas
relatorios_static/   frontend dos Relatórios (gráficos SVG próprios)
Output/              (gerado) instalador ArenaAMP-Setup.exe
run_desktop.dist/    (gerado) saída do Nuitka
.venv-build312/      (gitignored) venv de build Python 3.12
```

Os 3 módulos do cliente: **Aulas** (inline no `app.py`), **Ranking**
(`ranking_module.py`) e **Comandas** (`comandas_module.py`). São registrados no
fim do `app.py`.

---

## 3. Onde ficam os dados (no PC do cliente)

`%APPDATA%\ArenaAMP\` (= `C:\Users\<user>\AppData\Roaming\ArenaAMP\`):
- `arena.db` — banco SQLite com TUDO (aulas, comandas, ranking, config, atividade).
- `license.json` — payload assinado da licença + machine binding (NÃO é o arena.db).
- `secret.key` — SECRET_KEY do Flask, aleatória por instalação.
- `edge-profile/` — perfil dedicado do Edge --app.
- `backups/` — backups automáticos semanais do arena.db (mantém 8).
- `launcher.log` — passos do app (boot, janela, watchdog, atualização).
- `inno_update.log` — o que o instalador fez na última auto-atualização.

**Regra de ouro:** o "desvincular PC" NÃO apaga o `arena.db` (dados do cliente);
só o `license.json` é limpo (via `clear_key()` no botão "usar outra chave").

---

## 4. Licença (license_client.py)

- Envia `POST /api/validate {key, machine_id, product='arena', client_version}`
  pro servidor (`LICENSE_SERVER_URL` = `https://arena-amp-licencas-nl7l.onrender.com`).
- Recebe um **payload assinado (Ed25519)** e **re-verifica a assinatura offline**
  (editar o `license.json` = licença adulterada). A chave **pública** está embutida
  no `license_client.py`; a **privada** só no servidor.
- **1 licença = 1 PC** (machine_id). **5 dias** de tolerância offline (pelos dias
  assinados, não estica burlando o relógio — tem proteção anti-rollback).
- `get_modules()` lê os módulos liberados do payload (à prova de falha: inválido = []).

---

## 5. Pagamento (Mercado Pago) — o app é só relay

O app **não** fala com o MP direto: chama o **servidor** (relay em
`license_client.py` + rotas em `app.py`), que cria o checkout e devolve o link.
- **Avulso** (`/api/checkout`) e **assinatura recorrente** (`/api/subscribe`)
  convivem. Modal de Planos no `shell.html`. Cancelar assinatura mostra os dias
  restantes (`assinatura.html`).
- Preço é sempre calculado no **servidor**. Detalhes de MP no MANUAL do servidor.

---

## 6. ⚠️ Atualização automática — CRÍTICO (não desfaça os fixes)

Fluxo: o servidor guarda `min_version:arena` e `download_url` (GitHub Releases).
Se `APP_VERSION < min_version`, o `/_gate` trava e o app baixa+instala sozinho,
**silencioso e invisível**, e reabre. Foi o que mais deu trabalho. Os fixes:

1. **`installer.iss` NÃO usa `AppMutex`** (`CloseApplications=no`). Com o app
   (processo SEM janela) rodando, o Inno via o mutex e ABORTAVA a instalação
   silenciosa → "atualiza mas continua na versão antiga, em loop". A correção é
   o bloco **`[Code]`** que faz `taskkill /F /IM "Arena AMP.exe"` (SEM `/T`, senão
   mata o próprio instalador que é processo-filho) + fecha a janela antiga do
   Edge (`--app=http://127.0.0.1`) + `Sleep(1500)` ANTES de copiar.
2. **`run_desktop.py` lança o instalador DIRETO** (sem helper `.cmd`, que piscava
   um CMD preto na tela), `DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB`,
   `/VERYSILENT` (invisível). Passa `/LOG=%APPDATA%\ArenaAMP\inno_update.log`.
3. **Watchdog** vigia o processo do Edge (`.poll()`), não "batimentos" — o
   Chromium congela `setInterval` em janela minimizada e derrubava o backend.
4. Barra de progresso **monotônica + lock** (senão oscila com download duplo).

> Se um update travar: leia `launcher.log` + `inno_update.log` no `%APPDATA%`.

---

## 7. Build e Release (o que você roda a cada versão)

**Pré-requisitos:** Python **3.12** (o MinGW do Nuitka não roda no 3.13+) e Inno
Setup 6 (`ISCC.exe` em `C:\Program Files (x86)\Inno Setup 6`).

1. Bump da versão em **3 lugares**: `version.py` (`APP_VERSION`), `installer.iss`
   (`#define AppVersion`) e `build.bat` (`--file-version`).
2. `build.bat` → Nuitka **`--mingw64`** (NUNCA zig — zig otimiza pro CPU da máquina
   e o app crasha `STATUS_ILLEGAL_INSTRUCTION` em PC antigo). `CPATH=%CD%\mingwfix`.
   Saída: `run_desktop.dist\Arena AMP.exe`.
3. `ISCC.exe installer.iss` → `Output\ArenaAMP-Setup.exe`. (Se der
   "EndUpdateResource failed", é antivírus travando o exe — rode de novo.)
4. Sobe o `.exe` no **GitHub Releases** de `pg-systems-app` como tag `vX.Y` +
   **"Set as the latest release"** (o download é `/releases/latest/download/ArenaAMP-Setup.exe`).
5. No **`/admin`** do servidor: `min_version` do produto `arena` = a nova versão.
6. Cliente abre → atualiza sozinho.

**Comando do Nuitka** (é o que o build.bat roda): `--standalone --mingw64
--windows-console-mode=disable --include-data-dir` de templates/static/os _static
dos módulos + certifi + `--windows-icon-from-ico=static\logo.ico`
+ `--output-filename="Arena AMP.exe"`.

---

## 8. Dev (testar no navegador, sem compilar)

```
cd "Arena AMP - App"
.venv-build312\Scripts\python.exe run_dev.py    (ou run_dev.bat)
```
Abre em `http://127.0.0.1:5000` (login **admin / admin123**). Com `AMP_DEV=1` a
licença é ignorada e todos os módulos ficam liberados. Trava de segurança: um
`.exe` compilado tem `sys.frozen=True` e IGNORA `AMP_DEV` — então mesmo o repo
sendo público, ninguém libera os módulos com `set AMP_DEV=1` no exe instalado.

---

## 9. Pendências pós-lançamento (não travam funcionamento)

- **1º pagamento real** confirmar que ativa sozinho (webhook já corrigido; há
  rede de segurança: ativar manual no `/admin`).
- **UptimeRobot** no `/healthz` do servidor (Render free dorme em 15 min).
- **CPF + cidade** nos Termos de Uso (edita no `/admin`).
- Ícone da taskbar = Edge (limitação do `--app`; fix só com janela nativa).

---

## 10. Relações importantes

- **Servidor** (licença/MP/admin): `Desktop\Arena AMP - Servidor (admin)` — repo
  `pg-systems-licencas`. É UM só, compartilhado por todos os produtos.
- **Base genérica** (pra novos clientes): `Desktop\SISTEMA-BASE (esqueleto)`.
- Este app **é o produto `arena`** no servidor (o `PRODUCT` no `version.py`).
  Cada produto tem seu próprio `min_version`/`download_url`/preços/termos no `/admin`.
- **NUNCA** troque a chave privada Ed25519 do servidor sem reembutir a pública
  aqui no `license_client.py` — quebra a licença de todos os clientes.
