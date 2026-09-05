#!/usr/bin/env bash
# =============================================================================
# setup_venv.sh — Create a Python virtual environment and install requirements
# =============================================================================
# Usage (from repo root):
#   bash apps/fastapi/setup_venv.sh
#
# Then activate and run locally:
#   source apps/fastapi/.venv/bin/activate
#   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"

echo "[STM-FastAPI] Python: $(python3 --version 2>&1 || python --version)"
echo "[STM-FastAPI] Creating virtual environment at ${VENV_DIR} ..."

# Allow calling script with any working directory; always operate on SCRIPT_DIR
if command -v python3 &>/dev/null; then
  python3 -m venv "${VENV_DIR}"
else
  python -m venv "${VENV_DIR}"
fi

echo "[STM-FastAPI] Activating virtual environment and upgrading pip ..."
# shellcheck source=/dev/null
source "${VENV_DIR}/bin/activate"
pip install --upgrade pip

echo "[STM-FastAPI] Installing requirements ..."
pip install -r "${SCRIPT_DIR}/requirements.txt"

echo ""
echo "[STM-FastAPI] Done! Activate the venv:"
echo "    source ${VENV_DIR}/bin/activate  # (Linux/macOS)"
echo "    ${VENV_DIR}\\Scripts\\activate      # (Windows PowerShell: .venv\\Scripts\\Activate.ps1)"
echo ""
echo "[STM-FastAPI] Run the service:"
echo "    cd ${SCRIPT_DIR} && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
