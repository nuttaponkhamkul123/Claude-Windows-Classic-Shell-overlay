@echo off
title Claude & Antigravity Desktop HUD
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
echo Starting Overlay HUD...
node run.js
