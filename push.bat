@echo off
cd /d "%~dp0"
git add src/lib/ai-content.ts src/lib/ai-seo.ts src/lib/audit/ai-checks.ts src/screens/BrandingScreen.tsx src/screens/SeoScreen.tsx src/screens/content/DiffPreviewModal.tsx
git commit -m "chore: commit outstanding modified files"
git push
pause
