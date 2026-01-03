#!/bin/bash

# ============================================
# Kiro Ramble Journal - 一键部署脚本
# 适用于 Ubuntu/Debian/阿里云 Linux
# ============================================

set -e

echo "🚀 开始部署 Kiro Ramble Journal..."

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 配置变量
DOMAIN="kirozeng.com"
APP_DIR="/var/www/kiro-ramble-journal"
GITHUB_REPO="https://github.com/kirozeng/kiro-ramble-journal.git"

echo -e "${YELLOW}[1/6] 更新系统并安装依赖...${NC}"
apt update -y
apt install -y curl git nginx

# 安装 Node.js 18.x
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}[2/6] 安装 Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
else
    echo -e "${GREEN}[2/6] Node.js 已安装${NC}"
fi

# 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}[3/6] 安装 PM2...${NC}"
    npm install -g pm2
else
    echo -e "${GREEN}[3/6] PM2 已安装${NC}"
fi

echo -e "${YELLOW}[4/6] 下载代码...${NC}"
# 清理旧目录
rm -rf $APP_DIR
mkdir -p /var/www
cd /var/www
git clone $GITHUB_REPO
cd $APP_DIR

# 安装项目依赖
npm install --production

# 创建必要的目录和文件
mkdir -p public/data public/assets content/journals moments/images

# 创建默认的 about.json
if [ ! -f public/data/about.json ]; then
cat > public/data/about.json << 'ABOUTEOF'
{
  "name": "Kiro",
  "profileImage": "/assets/profile.jpg",
  "bio": [
    "Hi, I'm Kiro. I capture moments and stories through my lens.",
    "This journal is a collection of my visual ramblings."
  ],
  "gear": [
    { "type": "Camera", "name": "Fujifilm X-T1" },
    { "type": "Lens", "name": "XF 23mm f/1.4 R" }
  ],
  "social": {
    "email": "hello@kiro.me",
    "instagram": "kiro",
    "twitter": "kiro"
  }
}
ABOUTEOF
fi

echo -e "${YELLOW}[5/6] 配置 Nginx...${NC}"
cat > /etc/nginx/conf.d/kirozeng.conf << 'NGINXEOF'
server {
    listen 80;
    server_name kirozeng.com www.kirozeng.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
NGINXEOF

# 测试并重载 Nginx
nginx -t
systemctl enable nginx
systemctl reload nginx

echo -e "${YELLOW}[6/6] 启动应用...${NC}"
cd $APP_DIR

# 停止旧进程
pm2 delete kiro-journal 2>/dev/null || true

# 设置环境变量并启动
export ADMIN_PASSWORD="kiro2024"
pm2 start server.js --name "kiro-journal" --env production

# 设置开机自启
pm2 startup systemd -u root --hp /root
pm2 save

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}✅ 部署完成！${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "🌐 网站地址: http://${DOMAIN}"
echo -e "🔐 后台地址: http://${DOMAIN}/admin.html"
echo -e "🔑 后台密码: kiro2024 (请尽快修改)"
echo ""
echo -e "${YELLOW}下一步：${NC}"
echo "1. 在阿里云域名控制台添加 DNS 解析 (A 记录指向服务器 IP)"
echo "2. 修改后台密码: 编辑 /var/www/kiro-ramble-journal/.env"
echo "3. 配置 HTTPS: certbot --nginx -d kirozeng.com"
echo ""

