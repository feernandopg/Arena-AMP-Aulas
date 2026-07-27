; ============================================================
;  Instalador do Arena AMP (Inno Setup)
;  Gera um "Arena AMP Setup.exe" que o cliente instala em qualquer PC.
;
;  Como usar:
;   1. Instale o Inno Setup: https://jrsoftware.org/isdl.php
;   2. Rode o build.bat primeiro (gera dist\Arena AMP\)
;   3. Abra este arquivo no Inno Setup e clique em "Compile" (F9)
;   4. O instalador sai na pasta "Output\"
; ============================================================

#define AppName "Arena AMP"
#define AppVersion "3.4"
#define AppPublisher "Fernando Prestes Godinho"
#define AppExe "Arena AMP.exe"
; Precisa BATER com APP_MUTEX em run_desktop.py — é assim que o instalador
; detecta o app aberto e o fecha antes de sobrescrever os arquivos.
#define AppMutexName "ArenaAMP_Running_Mutex"

[Setup]
AppId={{A7E3C9B1-4F2D-4A6E-9C11-ARENAAMP2024}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
OutputBaseFilename=ArenaAMP-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
; Instala sem exigir admin (fica na pasta do usuario)
PrivilegesRequired=lowest
SetupIconFile=static\logo.ico
; Fecha o app se estiver aberto durante a atualização (usa o mutex do app).
AppMutex={#AppMutexName}
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Area de Trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "run_desktop.dist\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Abrir o {#AppName} agora"; Flags: nowait postinstall skipifsilent
