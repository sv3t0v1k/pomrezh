#!/usr/bin/env bash
#
# Run-of-Show Tool — запуск локального сервера на macOS
# Использование: chmod +x start.sh && ./start.sh
# Другой порт: PORT=3001 ./start.sh
#

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

export PORT="${PORT:-3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${GREEN}Run-of-Show Tool — запуск${NC}"

# Только macOS
if [[ "$(uname -s)" != "Darwin" ]]; then
    echo -e "${RED}Этот скрипт рассчитан на macOS.${NC}"
    exit 1
fi

# --- 1. Node.js ---
if ! command -v node &>/dev/null; then
    echo -e "${YELLOW}Node.js не найден в PATH.${NC}"
    read -r -p "Установить Node.js через Homebrew? [y/N] " reply
    if [[ "${reply}" =~ ^[Yy]$ ]]; then
        if ! command -v brew &>/dev/null; then
            echo -e "${YELLOW}Установите Homebrew: https://brew.sh${NC}"
            echo -e "${CYAN}Затем: brew install node${NC}"
            exit 1
        fi
        echo -e "${GREEN}brew install node...${NC}"
        brew install node
    else
        echo -e "${RED}Нужен Node.js: https://nodejs.org или brew install node${NC}"
        exit 1
    fi
fi

echo -e "${CYAN}Node $(node -v) / npm $(npm -v)${NC}"

# --- 2. Зависимости ---
if [[ ! -d "node_modules" ]]; then
    echo -e "${YELLOW}npm install...${NC}"
    npm install
fi

# --- 3. Порт ---
check_port() {
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

if check_port; then
    echo -e "${YELLOW}Порт ${PORT} занят.${NC}"
    read -r -p "Завершить процесс на порту ${PORT}? [y/N] " reply
    if [[ "${reply}" =~ ^[Yy]$ ]]; then
        pids=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
        if [[ -n "${pids}" ]]; then
            echo "$pids" | xargs kill -9 2>/dev/null || true
            sleep 1
        fi
        if check_port; then
            echo -e "${RED}Не удалось освободить порт ${PORT}.${NC}"
            exit 1
        fi
        echo -e "${GREEN}Порт ${PORT} свободен.${NC}"
    else
        echo -e "${RED}Отмена. Пример: PORT=3001 ./start.sh${NC}"
        exit 1
    fi
fi

# --- 4. Браузер через секунду после старта (сервер поднимается быстро) ---
(
    sleep 1
    open "http://localhost:${PORT}"
) &

echo -e "${GREEN}Сервер: http://localhost:${PORT}${NC}"
echo -e "${CYAN}Логи ниже. Остановка: Ctrl+C${NC}"
echo ""

# --- 5. Foreground: логи в терминале, корректное завершение по Ctrl+C ---
exec node server.js
