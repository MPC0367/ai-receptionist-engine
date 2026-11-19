#!/bin/sh
# Saves an API key to engine/.env.local (git-ignored, readable only by you) without showing it on screen.
# Run it yourself and paste the key at the prompt; nothing else ever sees it. Other keys already saved are kept.
#   sh scripts/save-key.sh             Anthropic (Claude), ANTHROPIC_API_KEY
#   sh scripts/save-key.sh cerebras    Cerebras free trial, CEREBRAS_API_KEY
#   sh scripts/save-key.sh gemini      Google Gemini free tier, GEMINI_API_KEY
#   sh scripts/save-key.sh groq        Groq free tier, GROQ_API_KEY
# Add --clipboard to take the key you just copied instead of pasting it (macOS): it is never shown.
set -e
cd "$(dirname "$0")/.."
case "${1:-anthropic}" in
  anthropic) VAR=ANTHROPIC_API_KEY; NAME=Anthropic ;;
  cerebras) VAR=CEREBRAS_API_KEY; NAME=Cerebras ;;
  gemini) VAR=GEMINI_API_KEY; NAME=Gemini ;;
  groq) VAR=GROQ_API_KEY; NAME=Groq ;;
  openai-compatible) VAR=OPENAI_COMPATIBLE_API_KEY; NAME="OpenAI-compatible" ;;
  *) echo "Unknown provider '$1' (anthropic, cerebras, gemini, groq, openai-compatible). Nothing was saved."; exit 1 ;;
esac
trap 'stty echo 2>/dev/null; rm -f .env.local.new' EXIT INT TERM
if [ "${2:-}" = --clipboard ]; then
  KEY=$(pbpaste | tr -d '\r\n')
else
  printf 'Paste your %s API key (it will not show), then press Return: ' "$NAME"
  stty -echo; IFS= read -r KEY; stty echo; echo
fi
case "$KEY" in
  *[[:space:]]*|'') echo "That is empty or has spaces in it. Nothing was saved."; exit 1 ;;
esac
if [ "$VAR" = ANTHROPIC_API_KEY ]; then
  case "$KEY" in sk-ant-*) ;; *) echo "That does not look like an Anthropic API key (they start with sk-ant-). Nothing was saved."; exit 1 ;; esac
fi
if [ "$VAR" = GROQ_API_KEY ]; then
  case "$KEY" in gsk_*) ;; *) echo "That does not look like a Groq API key (they start with gsk_). Nothing was saved."; KEY=; exit 1 ;; esac
fi
umask 077
if [ -f .env.local ]; then grep -v "^$VAR=" .env.local > .env.local.new || true; else : > .env.local.new; fi
printf '%s=%s\n' "$VAR" "$KEY" >> .env.local.new
KEY=
mv .env.local.new .env.local
echo "Saved $VAR to engine/.env.local (git-ignored, only you can read it). Tell Claude it is done."
