#!/bin/bash
# Pax8 CLI Demo Script — simulates typing for screen recordings
# Usage: ./demo.sh
# Tip: Use with asciinema or screen recording software

DELAY=0.04      # delay between keystrokes
PAUSE=1.5       # pause after command output
CMD_PAUSE=0.8   # pause before hitting enter

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

type_text() {
  local text="$1"
  for (( i=0; i<${#text}; i++ )); do
    printf "%s" "${text:$i:1}"
    sleep "$DELAY"
  done
}

# Type a command, pause, then execute it
run_cmd() {
  local cmd="$1"
  printf "${GREEN}\$ ${RESET}"
  type_text "$cmd"
  sleep "$CMD_PAUSE"
  echo ""
  eval "$cmd"
}

# Type something, realize it's wrong, backspace, retype
typo_then_fix() {
  local wrong="$1"
  local right="$2"
  local prefix="$3"

  printf "${GREEN}\$ ${RESET}"
  type_text "$prefix$wrong"
  sleep 0.4

  # Backspace over the wrong part
  for (( i=0; i<${#wrong}; i++ )); do
    printf "\b \b"
    sleep 0.03
  done
  sleep 0.2

  type_text "$right"
  sleep "$CMD_PAUSE"
  echo ""
  eval "$prefix$right"
}

# Section divider
section() {
  echo ""
  sleep "$PAUSE"
  echo -e "${DIM}─────────────────────────────────────────────────${RESET}"
  echo ""
  sleep 0.5
}

clear

echo -e "${BOLD}${CYAN}"
echo "  Pax8 CLI — Demo"
echo -e "${RESET}${DIM}  Managing your cloud marketplace from the terminal${RESET}"
echo ""
sleep 2

# ── Act 1: Quick health check ──
echo -e "${DIM}  # First, let's see how the business is doing${RESET}"
echo ""
sleep 1

run_cmd "pax8 dashboard"

section

# ── Act 2: Who are my customers? ──
echo -e "${DIM}  # Let's see our customers${RESET}"
echo ""
sleep 1

run_cmd "pax8 clients list"

section

# ── Act 3: Drill into a customer (with a typo!) ──
echo -e "${DIM}  # Let's look at a specific customer in detail${RESET}"
echo ""
sleep 1

typo_then_fix "Sumit" "Summit Healthcare Partners\"" "pax8 clients more \""

section

# ── Act 4: Check renewals ──
echo -e "${DIM}  # Any renewals coming up?${RESET}"
echo ""
sleep 1

run_cmd "pax8 subscriptions renewals --within 14d"

section

# ── Act 5: Recommendations ──
echo -e "${DIM}  # Where can we grow? Let's find opportunities${RESET}"
echo ""
sleep 1

typo_then_fix "recomendations" "recommendations list --priority high" "pax8 "

section

# ── Act 6: The pitch ──
echo -e "${BOLD}${CYAN}"
echo "  That's Pax8 CLI."
echo -e "${RESET}"
echo -e "  ${DIM}Manage subscriptions, track renewals, find growth"
echo -e "  opportunities — all from the terminal.${RESET}"
echo ""
echo -e "  ${CYAN}github.com/pax8labs/pax8-cli${RESET}"
echo ""
sleep 3
