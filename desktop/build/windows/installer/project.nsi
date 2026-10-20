Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
##
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the ProjectInfo file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "MyProject" # Default "{{.Name}}"
## !define INFO_COMPANYNAME    "MyCompany" # Default "{{.Info.CompanyName}}"
## !define INFO_PRODUCTNAME    "MyProduct" # Default "{{.Info.ProductName}}"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "{{.Info.ProductVersion}}"
## !define INFO_COPYRIGHT      "Copyright" # Default "{{.Info.Copyright}}"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
####
## Raya installs for the current user only (in %LocalAppData%\Programs\Raya), so installing it, and
## opening .raya files with it, needs no administrator rights
!define REQUEST_EXECUTION_LEVEL "user"
!define WAILS_INSTALL_SCOPE "user"
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}" # "Run Raya" checkbox on the last page

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uinstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
!ifdef WAILS_INSTALL_SCOPE
  !if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
  !else
    InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
  !endif
!else
  InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
!endif # Default installing folder ($PROGRAMFILES is Program Files folder).
ShowInstDetails show # This will always show the installation details.

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

# .raya files open in Raya. These replace wails.associateFiles and wails.unassociateFiles (wails_tools.nsh,
# which wails build regenerates), which:
# - leave the program's path unquoted in the open command, so opening a file fails when the install
#   folder has a space in it (a user name with a space)
# - back up whatever .raya pointed to on every install, so after reinstalling, the "previous" program
#   is Raya itself and uninstalling points .raya back at Raya
!define RAYA_EXT "Software\Classes\.raya"
!define RAYA_CLASS "Raya.Document"

!macro raya.associateFiles
    ReadRegStr $R0 SHELL_CONTEXT "${RAYA_EXT}" ""
    ${If} $R0 != "${RAYA_CLASS}"
        WriteRegStr SHELL_CONTEXT "${RAYA_EXT}" "${RAYA_CLASS}_backup" "$R0"
    ${EndIf}
    WriteRegStr SHELL_CONTEXT "${RAYA_EXT}" "" "${RAYA_CLASS}"

    WriteRegStr SHELL_CONTEXT "Software\Classes\${RAYA_CLASS}" "" "Raya document"
    WriteRegStr SHELL_CONTEXT "Software\Classes\${RAYA_CLASS}\DefaultIcon" "" "$INSTDIR\rayaFile.ico"
    WriteRegStr SHELL_CONTEXT "Software\Classes\${RAYA_CLASS}\shell" "" "open"
    WriteRegStr SHELL_CONTEXT "Software\Classes\${RAYA_CLASS}\shell\open" "" "Open with ${INFO_PRODUCTNAME}"
    WriteRegStr SHELL_CONTEXT "Software\Classes\${RAYA_CLASS}\shell\open\command" "" '"$INSTDIR\${PRODUCT_EXECUTABLE}" "%1"'
    File "..\rayaFile.ico"
!macroend

!macro raya.unassociateFiles
    # give .raya back to the program it had before Raya, or remove it if it had none (a backup naming
    # Raya itself, left by an installer from before this fix, counts as none)
    ReadRegStr $R0 SHELL_CONTEXT "${RAYA_EXT}" "${RAYA_CLASS}_backup"
    ${If} $R0 == ""
    ${OrIf} $R0 == "${RAYA_CLASS}"
        DeleteRegKey SHELL_CONTEXT "${RAYA_EXT}"
    ${Else}
        WriteRegStr SHELL_CONTEXT "${RAYA_EXT}" "" "$R0"
        DeleteRegValue SHELL_CONTEXT "${RAYA_EXT}" "${RAYA_CLASS}_backup"
    ${EndIf}
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${RAYA_CLASS}"
    Delete "$INSTDIR\rayaFile.ico"
!macroend

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro raya.associateFiles
    !insertmacro wails.associateCustomProtocols
    # tell Explorer the file types changed, so .raya files show their icon straight away
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro raya.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

    !insertmacro wails.deleteUninstaller
SectionEnd
