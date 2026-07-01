; =============================================================================
; Conchitour — Custom NSIS Installer Pages
; Included by electron-builder via nsis.include in package.json
;
; Adds before the EULA page:
;   1. Welcome      (MUI standard, with sidebar)
;   2. Features     (nsDialogs: what's in the license)
;   3. Quick Start  (nsDialogs: first-run guide)
; =============================================================================

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; =============================================================================
; PAGE: Features — "What's included"
; =============================================================================
Var feat.Dialog
Var feat.Title
Var feat.Intro
Var feat.Line1
Var feat.Line2
Var feat.Line3
Var feat.Line4
Var feat.Line5
Var feat.Line6
Var feat.Note

Function FeaturesPageCreate
  !insertmacro MUI_HEADER_TEXT "Your Conchitour License" \
      "Everything included with your one-time purchase."

  nsDialogs::Create 1018
  Pop $feat.Dialog
  ${If} $feat.Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 10u "What you get with Conchitour:"
  Pop $feat.Title

  ${NSD_CreateLabel} 0 14u 100% 9u \
      "$\x2713   Unlimited scenes, languages and AI calls"
  Pop $feat.Line1

  ${NSD_CreateLabel} 0 25u 100% 9u \
      "$\x2713   Static export — host anywhere (OVH, Netlify, S3, GitHub Pages...)"
  Pop $feat.Line2

  ${NSD_CreateLabel} 0 36u 100% 9u \
      "$\x2713   GPS-based auto-hotspot generation via integrated map"
  Pop $feat.Line3

  ${NSD_CreateLabel} 0 47u 100% 9u \
      "$\x2713   AI-powered SEO: titles, descriptions & image sitemaps in every language"
  Pop $feat.Line4

  ${NSD_CreateLabel} 0 58u 100% 9u \
      "$\x2713   Activate on up to 2 machines  $\x00B7  1 year of free updates"
  Pop $feat.Line5

  ${NSD_CreateLabel} 0 69u 100% 9u \
      "$\x2713   Email support: help@conchitour.com"
  Pop $feat.Line6

  ; Separator line
  ${NSD_CreateHLine} 0 84u 100% 1u ""
  Pop $feat.Intro

  ${NSD_CreateLabel} 0 89u 100% 20u \
      "Important: Conchitour uses krpano as the 360$\x00B0 viewer engine. \
You must supply your own krpano license (krpanolicense.xml). \
Visit krpano.com to purchase one."
  Pop $feat.Note

  nsDialogs::Show
FunctionEnd

Function FeaturesPageLeave
FunctionEnd

; =============================================================================
; PAGE: Quick Start — first-run guide
; =============================================================================
Var gs.Dialog
Var gs.Intro
Var gs.Step1
Var gs.Step2
Var gs.Step3
Var gs.Step4
Var gs.Step5
Var gs.Sep
Var gs.Docs

Function GetStartedPageCreate
  !insertmacro MUI_HEADER_TEXT "Quick Start" \
      "Five steps to publish your first virtual tour."

  nsDialogs::Create 1018
  Pop $gs.Dialog
  ${If} $gs.Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 9u \
      "After installation, follow these steps to get up and running:"
  Pop $gs.Intro

  ${NSD_CreateLabel} 0 14u 100% 9u \
      "1.   Launch Conchitour and enter your license key to activate"
  Pop $gs.Step1

  ${NSD_CreateLabel} 0 25u 100% 9u \
      "2.   Go to Modules and select your krpano folder (krpanotools.exe)"
  Pop $gs.Step2

  ${NSD_CreateLabel} 0 36u 100% 9u \
      "3.   Import your 360$\x00B0 photos (Ctrl+I) $\x2014 GPS and heading auto-detected"
  Pop $gs.Step3

  ${NSD_CreateLabel} 0 47u 100% 9u \
      "4.   Edit scenes, place hotspots, configure SEO and branding"
  Pop $gs.Step4

  ${NSD_CreateLabel} 0 58u 100% 9u \
      "5.   Compile (Ctrl+Shift+B) and upload the output folder anywhere"
  Pop $gs.Step5

  ; Separator
  ${NSD_CreateHLine} 0 73u 100% 1u ""
  Pop $gs.Sep

  ${NSD_CreateLabel} 0 78u 100% 18u \
      "Documentation: https://conchitour.com/docs$\r$\nSupport: help@conchitour.com"
  Pop $gs.Docs

  nsDialogs::Show
FunctionEnd

Function GetStartedPageLeave
FunctionEnd

; =============================================================================
; Hook: inject our pages between Welcome and License
;
; electron-builder calls:  !ifmacrodef customWelcomePage → !insertmacro customWelcomePage
; then it calls:           !ifmacrodef licensePage → !insertmacro licensePage  (EULA)
;
; Final page order:
;   1. Welcome (MUI)
;   2. Features       ← ours
;   3. Quick Start    ← ours
;   4. License/EULA   ← electron-builder (from license.rtf)
;   5. Install Mode   ← electron-builder (per-user / all users)
;   6. Directory      ← electron-builder
;   7. Installing     ← electron-builder
;   8. Finish         ← electron-builder (with "Launch Conchitour" checkbox)
; =============================================================================
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  Page custom FeaturesPageCreate FeaturesPageLeave
  Page custom GetStartedPageCreate GetStartedPageLeave
!macroend
