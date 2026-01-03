# Kiro. Photo Journal

A minimal, elegant personal photo journal website for sharing moments and travel stories.

## Features

- 📷 **Moments** - Photo wall for casual everyday photos with EXIF data display
- 📖 **Journal** - Travel stories with cover images and photo galleries
- 👤 **About** - Personal profile with gear list and social links
- 🔐 **Admin Panel** - Web-based content management with authentication
- 📱 **Mobile Responsive** - Optimized for all devices with touch gestures
- 🚀 **Production Ready** - Security headers, compression, rate limiting

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Start production server
NODE_ENV=production ADMIN_PASSWORD=your_secure_password npm start
```

Visit `http://localhost:3000` for the website and `http://localhost:3000/admin.html` for admin panel.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Set to `production` for production mode |
| `ADMIN_PASSWORD` | admin123 | **Important:** Change this in production! |

### Example `.env` file

```env
PORT=3000
NODE_ENV=production
ADMIN_PASSWORD=your_secure_password_here
```

## Deployment

### Option 1: VPS / Cloud Server (Recommended)

1. **Server Setup**
   ```bash
   # Install Node.js 18+
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Clone and setup
   git clone <your-repo> /var/www/kiro-journal
   cd /var/www/kiro-journal
   npm install --production
   ```

2. **Process Manager (PM2)**
   ```bash
   npm install -g pm2
   
   # Start with environment variables
   PORT=3000 NODE_ENV=production ADMIN_PASSWORD=your_password pm2 start server.js --name kiro-journal
   
   # Auto-start on reboot
   pm2 startup
   pm2 save
   ```

3. **Nginx Reverse Proxy**
   ```nginx
   server {
       listen 80;
       server_name yourdomain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_cache_bypass $http_upgrade;
           
           # File upload size limit
           client_max_body_size 50M;
       }
   }
   ```

4. **SSL with Certbot**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d yourdomain.com
   ```

### Option 2: Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
docker build -t kiro-journal .
docker run -d -p 3000:3000 \
  -e NODE_ENV=production \
  -e ADMIN_PASSWORD=your_password \
  -v $(pwd)/moments:/app/moments \
  -v $(pwd)/journals:/app/journals \
  -v $(pwd)/public/data:/app/public/data \
  -v $(pwd)/public/assets:/app/public/assets \
  kiro-journal
```

### Option 3: Railway / Render / Fly.io

These platforms auto-detect Node.js apps. Just:
1. Connect your GitHub repo
2. Set environment variables in dashboard
3. Deploy!

## Project Structure

```
kiro-ramble-journal/
├── server.js           # Express server with API routes
├── package.json        # Dependencies and scripts
├── public/
│   ├── index.html      # Main SPA frontend
│   ├── admin.html      # Admin panel
│   ├── robots.txt      # SEO robots file
│   ├── assets/         # Static assets (profile.jpg)
│   └── data/           # JSON data (about.json)
├── moments/
│   └── images/         # Uploaded moment photos
├── journals/
│   └── [journal-id]/   # Journal folders with photos + info.json
└── .gitignore
```

## API Endpoints

### Public (No Auth)
- `GET /api/health` - Health check
- `GET /api/about` - About page data
- `GET /api/photos` - All moments photos
- `GET /api/journals` - All journals list
- `GET /api/journals/:id` - Single journal detail

### Protected (Basic Auth)
- `PUT /api/about` - Update about info
- `POST /api/about/photo` - Upload profile photo
- `POST /api/photos` - Upload moments photos
- `DELETE /api/photos/:filename` - Delete photo
- `POST /api/journals` - Create journal
- `PUT /api/journals/:id` - Update journal
- `DELETE /api/journals/:id` - Delete journal
- `POST /api/journals/:id/photos` - Upload journal photos
- `DELETE /api/journals/:id/photos/:filename` - Delete journal photo

## Security Features

- ✅ Helmet security headers
- ✅ Rate limiting (API & uploads)
- ✅ File type validation
- ✅ Filename sanitization (path traversal prevention)
- ✅ File size limits (20MB)
- ✅ Basic authentication for admin
- ✅ GZIP compression

## Performance Features

- ✅ Response compression
- ✅ Static file caching (1 year in production)
- ✅ Lazy image loading
- ✅ Thumbnail generation (planned)

## License

MIT

