; ColorPencil ERP - Windows installer (NSIS 3, Unicode). Compile: makensis -DVERSION=1.10.2 build/installer.nsi
; 15차(v1.10.0): /UPDATE = ERP 자동 업데이트가 실행 — 첫 화면 · 폴더 · 마침 화면 없이 진행 막대만, ERP 가 닫히기를 기다리고, 끝나면 ERP 를 다시 켠다.
;   ERP 는 "ColorPencil-ERP-Setup-<버전>.exe /UPDATE /D=<지금 설치 폴더>" 로 실행한다 (/D= 는 NSIS 규칙대로 맨 끝 · 따옴표 없음)
Unicode true
!ifndef VERSION
  !define VERSION "1.10.2"
!endif
!define APPNAME "ColorPencil ERP"
!define EXENAME "ColorPencil ERP.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ColorPencilERP"
!define SRCDIR "..\dist\win-unpacked"

Name "${APPNAME} ${VERSION}"
OutFile "..\dist\ColorPencil-ERP-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\ColorPencil ERP"
InstallDirRegKey HKCU "Software\ColorPencilERP" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "ColorPencil ERP ${VERSION}"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "ColorPencil ERP 실행 / Chạy ngay"

Var UPD   ; 1 = 자동 업데이트 (/UPDATE)

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipInUpdate
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipInUpdate
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipInUpdate
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "Vietnamese"
!insertmacro MUI_LANGUAGE "English"

LangString DESKTOP ${LANG_KOREAN} "바탕화면 바로가기"
LangString DESKTOP ${LANG_VIETNAMESE} "Lối tắt trên màn hình"
LangString DESKTOP ${LANG_ENGLISH} "Desktop shortcut"
LangString RUNNING ${LANG_KOREAN} "ColorPencil ERP 가 실행 중입니다.$\r$\n프로그램 창을 닫은 뒤(입력한 내용은 닫을 때 저장됩니다) [다시 시도]를 누르세요."
LangString RUNNING ${LANG_VIETNAMESE} "ColorPencil ERP đang chạy.$\r$\nHãy đóng cửa sổ chương trình (dữ liệu sẽ được lưu khi đóng) rồi bấm [Thử lại]."
LangString RUNNING ${LANG_ENGLISH} "ColorPencil ERP is running.$\r$\nClose the program window (your entries are saved on close), then click Retry."
LangString KEEPDATA ${LANG_KOREAN} "데이터(수주·생산·재고)는 삭제되지 않습니다: %APPDATA%\ColorPencil ERP"
LangString KEEPDATA ${LANG_VIETNAMESE} "Dữ liệu (đơn hàng, sản xuất, tồn kho) được giữ lại: %APPDATA%\ColorPencil ERP"
LangString KEEPDATA ${LANG_ENGLISH} "Your data is kept: %APPDATA%\ColorPencil ERP"

; 10차(v1.5.0): ERP 가 실행 중이면 설치 · 삭제 전에 닫으라고 알린다.
; 실행 중인 프로그램 파일(exe)은 Windows 가 쓰기를 막으므로, 설치 폴더의 exe 를 쓰기 모드로 열어 보고 열리지 않으면 실행 중으로 본다
; (다른 Windows 사용자의 ERP 는 상관없음 · 플러그인 없이 동작). [다시 시도] / [취소] — 취소하면 설치(삭제)를 멈춘다
; 15차: 자동 업데이트는 ERP 가 스스로 닫히는 중이므로 먼저 최대 30초 기다린 뒤에 묻는다
!macro CHECK_RUNNING_FN un
Function ${un}CheckRunning
  StrCpy $R9 0
  retry:
    IfFileExists "$INSTDIR\${EXENAME}" 0 done
    ClearErrors
    FileOpen $0 "$INSTDIR\${EXENAME}" a
    IfErrors locked
    FileClose $0
    Goto done
  locked:
    ${If} $UPD == 1
    ${AndIf} $R9 < 60
      IntOp $R9 $R9 + 1
      Sleep 500
      Goto retry
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(RUNNING)" IDRETRY retry
    Abort
  done:
FunctionEnd
!macroend
!insertmacro CHECK_RUNNING_FN ""
!insertmacro CHECK_RUNNING_FN "un."

Function .onInit
  ; language auto-detect by Windows UI language (Korean/Vietnamese/English)
  System::Call 'kernel32::CreateMutex(i 0, i 0, t "ColorPencilERPSetup") i .r1 ?e'
  Pop $R0
  StrCmp $R0 0 +3
    MessageBox MB_OK|MB_ICONEXCLAMATION "Setup is already running."
    Abort
  StrCpy $UPD 0
  ${GetParameters} $R1
  ClearErrors
  ${GetOptions} $R1 "/UPDATE" $R2
  ${IfNot} ${Errors}
    StrCpy $UPD 1
  ${EndIf}
  Call CheckRunning
FunctionEnd

; 자동 업데이트는 첫 화면 · 폴더 · 마침 화면을 건너뛴다 (진행 막대만)
Function SkipInUpdate
  ${If} $UPD == 1
    Abort
  ${EndIf}
FunctionEnd

; 설치 폴더를 바꿨을 때도 그 폴더의 ERP 가 실행 중인지 본다 (취소 = 이 화면에 머묾)
Function DirLeave
  Call CheckRunning
FunctionEnd

; 자동 업데이트가 끝나면 새 버전을 다시 켠다
Function .onInstSuccess
  ${If} $UPD == 1
    Exec '"$INSTDIR\${EXENAME}"'
  ${EndIf}
FunctionEnd

Function un.onInit
  StrCpy $UPD 0
  Call un.CheckRunning
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  ${If} $UPD == 1
    SetAutoClose true
  ${EndIf}
  Call CheckRunning
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  ; 자동 업데이트는 바탕화면 바로가기를 지운 PC 에 다시 만들지 않는다
  ${If} $UPD != 1
  ${OrIf} ${FileExists} "$DESKTOP\${APPNAME}.lnk"
    CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  ${EndIf}
  WriteRegStr HKCU "Software\ColorPencilERP" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "Factory ERP"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\ColorPencilERP"
  MessageBox MB_OK|MB_ICONINFORMATION "$(KEEPDATA)"
SectionEnd
