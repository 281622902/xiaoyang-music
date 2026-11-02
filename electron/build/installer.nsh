; Shared by installer and uninstaller. Never depend on localized tasklist output.
!define /ifndef XY_DESKTOP_DIR "$DESKTOP"
!macro customCheckAppRunning
  Push $R0
  Push $R1
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    ${If} ${Silent}
      ; A silent invocation must not close a running app without a confirmation.
      SetErrorLevel 2
      Quit
    ${EndIf}
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "小杨音乐正在运行。$\r$\n$\r$\n是否关闭全部窗口和托盘后台，继续安装/卸载？$\r$\n收藏、歌单和设置会保留。" IDOK +2
    Quit
    ; v2.14+ accepts a graceful exit command; older versions fall back below.
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit-for-install' $R0
    ${EndIf}
    ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    StrCpy $R1 0
    ${Do}
      Sleep 300
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}
      IntOp $R1 $R1 + 1
    ${LoopWhile} $R1 < 10
    ${If} $R0 == 0
      ; User already approved closing every instance, including legacy tray apps.
      ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      Sleep 500
    ${EndIf}
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      MessageBox MB_OK|MB_ICONSTOP "小杨音乐仍未退出。可能有其他用户或管理员运行的实例。$\r$\n本次操作已停止，请关闭该实例后重试。"
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend

!macro customFinishPage
  ; Both choices are on the final page; desktop shortcut is not created earlier.
  Function XYCreateDesktopShortcut
    CreateShortCut "${XY_DESKTOP_DIR}\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    WinShell::SetLnkAUMI "${XY_DESKTOP_DIR}\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  FunctionEnd
  Function XYRunInstalledApp
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
  FunctionEnd
  !define MUI_FINISHPAGE_TITLE "小杨音乐安装完成"
  !define MUI_FINISHPAGE_TEXT "请选择完成安装后的操作，然后点击完成。"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "立即运行小杨音乐"
  !define MUI_FINISHPAGE_RUN_FUNCTION XYRunInstalledApp
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "建立桌面快捷方式"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION XYCreateDesktopShortcut
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  Delete "${XY_DESKTOP_DIR}\${SHORTCUT_NAME}.lnk"
!macroend
