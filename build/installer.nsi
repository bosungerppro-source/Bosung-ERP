; ColorPencil ERP - Windows installer (NSIS 3, Unicode). Compile: makensis -DVERSION=1.3.0 build/installer.nsi
Unicode true
!ifndef VERSION
  !define VERSION "1.3.0"
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
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "ColorPencil ERP 실행 / Chạy ngay"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "Vietnamese"
!insertmacro MUI_LANGUAGE "English"

LangString DESKTOP ${LANG_KOREAN} "바탕화면 바로가기"
LangString DESKTOP ${LANG_VIETNAMESE} "Lối tắt trên màn hình"
LangString DESKTOP ${LANG_ENGLISH} "Desktop shortcut"
LangString RUNNING ${LANG_KOREAN} "ColorPencil ERP가 실행 중입니다. 종료한 뒤 다시 시도하세요."
LangString RUNNING ${LANG_VIETNAMESE} "ColorPencil ERP đang chạy. Hãy đóng ứng dụng rồi thử lại."
LangString RUNNING ${LANG_ENGLISH} "ColorPencil ERP is running. Please close it and try again."
LangString KEEPDATA ${LANG_KOREAN} "데이터(수주·생산·재고)는 삭제되지 않습니다: %APPDATA%\ColorPencil ERP"
LangString KEEPDATA ${LANG_VIETNAMESE} "Dữ liệu (đơn hàng, sản xuất, tồn kho) được giữ lại: %APPDATA%\ColorPencil ERP"
LangString KEEPDATA ${LANG_ENGLISH} "Your data is kept: %APPDATA%\ColorPencil ERP"

Function .onInit
  ; language auto-detect by Windows UI language (Korean/Vietnamese/English)
  System::Call 'kernel32::CreateMutex(i 0, i 0, t "ColorPencilERPSetup") i .r1 ?e'
  Pop $R0
  StrCmp $R0 0 +3
    MessageBox MB_OK|MB_ICONEXCLAMATION "Setup is already running."
    Abort
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"
  ; stop if running
  FindWindow $0 "Chrome_WidgetWin_1" "ERP"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
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
