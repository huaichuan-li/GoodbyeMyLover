#!/bin/bash
# 稳定启动本地 HTTP 服务器（带 PID 文件和健康检查）
set -e
PORT=8080
PIDFILE=/tmp/hospital_server.pid
LOGFILE=/tmp/hospital_server.log
PROJDIR="/Users/lihuaichuan/Documents/projects/超级交子孵化器/小马国墨鱼工作室"

cd "$PROJDIR"

# 1. 清理旧进程
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[*] 杀掉旧服务器 PID=$OLD_PID"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
fi
# 保险：清掉所有占 8080 的
lsof -i ":$PORT" -t 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 1

# 2. 启动新服务器
echo "[*] 启动 HTTP 服务器 port=$PORT dir=$PROJDIR"
nohup python3 -m http.server "$PORT" --bind 0.0.0.0 > "$LOGFILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PIDFILE"
echo "[*] PID=$NEW_PID"

# 3. 等起来 + 健康检查
for i in {1..10}; do
  if curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:$PORT/index.html" 2>/dev/null | grep -q "200"; then
    echo ""
    echo "=========================================="
    echo "  ✓ 服务器已启动!"
    echo "  PID:    $NEW_PID"
    echo "  端口:   $PORT"
    echo "  URL:    http://localhost:$PORT/index.html"
    echo "  日志:   tail -f $LOGFILE"
    echo "  停止:   kill \$(cat $PIDFILE)"
    echo "=========================================="
    exit 0
  fi
  sleep 0.5
done

echo "✗ 服务器启动失败，日志："
cat "$LOGFILE"
exit 1
