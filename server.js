const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const sharp = require('sharp');
const exifReader = require('exif-reader');
const multer = require('multer');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ==================== 配置 ====================
const config = {
    port: process.env.PORT || 3000,
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123', // 生产环境务必修改
    maxFileSize: 20 * 1024 * 1024, // 20MB
    maxFiles: 50,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    thumbnailSize: 400,
    isProduction: process.env.NODE_ENV === 'production'
};

// ==================== 安全中间件 ====================

// Helmet 安全头 - 禁用 CSP 以允许内联事件处理器
// 注意：生产环境应考虑更严格的 CSP 配置
app.use(helmet({
    contentSecurityPolicy: false, // 禁用 CSP，因为 admin 面板使用内联事件处理器
    crossOriginEmbedderPolicy: false,
}));

// 压缩响应
app.use(compression());

// JSON body parser
app.use(express.json({ limit: '1mb' }));

// API 速率限制
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100, // 每IP最多100次请求
    message: { error: 'Too many requests, please try again later.' }
});

// 上传速率限制 (更严格)
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1小时
    max: 200, // 每IP最多200次上传
    message: { error: 'Upload limit reached, please try again later.' }
});

// ==================== 管理员认证中间件 ====================

function adminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');
    
    if (username === 'admin' && password === config.adminPassword) {
        next();
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
}

// ==================== 文件验证 ====================

// 清理文件名，防止路径遍历攻击
function sanitizeFilename(filename) {
    return filename
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/\.{2,}/g, '.')
        .substring(0, 100);
}

// Multer 文件过滤器
const fileFilter = (req, file, cb) => {
    if (config.allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPEG, PNG and WebP are allowed.'), false);
    }
};

// ==================== 缓存控制 ====================

// 静态文件缓存 (生产环境1年，开发环境不缓存)
const staticOptions = {
    maxAge: config.isProduction ? '1y' : 0,
    etag: true,
    lastModified: true
};

// 设置静态文件服务
app.use(express.static('public', staticOptions));
app.use('/images', express.static('moments/images', staticOptions));
app.use('/thumbnails', express.static('moments/thumbnails', staticOptions));
app.use('/content/journals', express.static('journals', staticOptions));

// ==================== Multer 配置 ====================

// Moments 照片上传
const momentsStorage = multer.diskStorage({
    destination: 'moments/images/',
    filename: (req, file, cb) => {
        const safeName = sanitizeFilename(file.originalname);
        const uniqueName = Date.now() + '-' + safeName;
        cb(null, uniqueName);
    }
});
const uploadMoments = multer({ 
    storage: momentsStorage,
    fileFilter,
    limits: { fileSize: config.maxFileSize, files: config.maxFiles }
});

// Journal 照片上传
const journalStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const journalId = sanitizeFilename(req.params.id);
        const journalDir = path.join('journals', journalId);
        if (!fsSync.existsSync(journalDir)) {
            fsSync.mkdirSync(journalDir, { recursive: true });
        }
        cb(null, journalDir);
    },
    filename: (req, file, cb) => {
        if (req.query.type === 'cover') {
            cb(null, 'cover.jpg');
        } else {
            const safeName = sanitizeFilename(file.originalname);
            cb(null, Date.now() + '-' + safeName);
        }
    }
});
const uploadJournal = multer({ 
    storage: journalStorage,
    fileFilter,
    limits: { fileSize: config.maxFileSize, files: config.maxFiles }
});

// Profile 头像上传
const profileStorage = multer.diskStorage({
    destination: 'public/assets/',
    filename: (req, file, cb) => {
        cb(null, 'profile.jpg');
    }
});
const uploadProfile = multer({ 
    storage: profileStorage,
    fileFilter,
    limits: { fileSize: config.maxFileSize, files: 1 }
});

// ==================== 工具函数 ====================

// 解析EXIF日期
function parseExifDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const match = dateStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (match) {
        const [_, year, month, day, hour, minute, second] = match;
        return new Date(year, month - 1, day, hour, minute, second).toISOString();
    }
    return null;
}

// 处理单个图片文件
async function processImageFile(filePath, publicUrlPath) {
    try {
        const imageBuffer = await fs.readFile(filePath);
        const metadata = await sharp(imageBuffer).metadata();
        let exif = null;
        if (metadata.exif) {
            try {
                exif = exifReader(metadata.exif);
            } catch (e) {}
        }

        const stats = await fs.stat(filePath);
        let dateTaken = null;

        if (exif?.exif?.DateTimeOriginal) {
            dateTaken = parseExifDate(exif.exif.DateTimeOriginal);
        }
        if (!dateTaken && exif?.image?.ModifyDate) {
            dateTaken = parseExifDate(exif.image.ModifyDate);
        }
        if (!dateTaken && stats.birthtimeMs) {
            dateTaken = new Date(stats.birthtimeMs).toISOString();
        }
        if (!dateTaken) {
            dateTaken = new Date(stats.mtimeMs).toISOString();
        }

        return {
            name: path.basename(filePath),
            url: publicUrlPath,
            dateTaken,
            camera: exif?.image?.Make ? `${exif.image.Make} ${exif.image.Model}` : '',
            lens: exif?.exif?.LensModel || '',
            width: metadata.width,
            height: metadata.height
        };
    } catch (error) {
        return {
            name: path.basename(filePath),
            url: publicUrlPath,
            dateTaken: new Date().toISOString(),
            camera: '',
            lens: '',
            width: 0,
            height: 0
        };
    }
}

// 生成缩略图
async function generateThumbnail(inputPath, outputPath) {
    try {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await sharp(inputPath)
            .resize(config.thumbnailSize, config.thumbnailSize, { 
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ quality: 80 })
            .toFile(outputPath);
        return true;
    } catch (error) {
        console.error('Thumbnail generation failed:', error.message);
        return false;
    }
}

// ==================== 公共 API (无需认证) ====================

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 获取 About 信息
app.get('/api/about', async (req, res) => {
    try {
        const data = await fs.readFile('public/data/about.json', 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.json({
            name: "Kiro",
            bio: "",
            bio2: "",
            gear: [],
            social: { email: "", instagram: "", twitter: "" }
        });
    }
});

// 获取所有照片
app.get('/api/photos', apiLimiter, async (req, res) => {
    try {
        const files = await fs.readdir('moments/images');
        const photoPromises = files
            .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file) && !file.startsWith('.'))
            .map(file => processImageFile(
                path.join('moments/images', file),
                `/images/${file}`
            ));
        const photos = await Promise.all(photoPromises);
        
        // 按日期排序
        photos.sort((a, b) => new Date(b.dateTaken) - new Date(a.dateTaken));
        
        res.json(photos);
    } catch (error) {
        res.status(500).json({ error: 'Failed to read photos' });
    }
});

// 获取所有游记
app.get('/api/journals', apiLimiter, async (req, res) => {
    try {
        const journalsDir = 'journals';
        try {
            await fs.access(journalsDir);
        } catch {
            return res.json([]);
        }

        const entries = await fs.readdir(journalsDir, { withFileTypes: true });
        const journals = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                try {
                    const infoPath = path.join(journalsDir, entry.name, 'info.json');
                    const infoData = await fs.readFile(infoPath, 'utf-8');
                    const info = JSON.parse(infoData);
                    journals.push({
                        id: entry.name,
                        ...info,
                        cover: info.cover ? `/content/journals/${entry.name}/${info.cover}` : null
                    });
                } catch (e) {}
            }
        }
        
        journals.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(journals);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get journals' });
    }
});

// 获取单个游记详情
app.get('/api/journals/:id', apiLimiter, async (req, res) => {
    try {
        const id = sanitizeFilename(req.params.id);
        const journalDir = path.join('journals', id);
        
        const infoPath = path.join(journalDir, 'info.json');
        const infoData = await fs.readFile(infoPath, 'utf-8');
        const info = JSON.parse(infoData);
        
        const files = await fs.readdir(journalDir);
        const photoPromises = files
            .filter(file => /\.(jpg|jpeg|png|webp)$/i.test(file) && file !== info.cover && !file.startsWith('.'))
            .map(file => processImageFile(
                path.join(journalDir, file),
                `/content/journals/${id}/${file}`
            ));
            
        const photos = await Promise.all(photoPromises);
        photos.sort((a, b) => new Date(b.dateTaken).getTime() - new Date(a.dateTaken).getTime());
        
        res.json({ id, ...info, cover: `/content/journals/${id}/${info.cover}`, photos });
    } catch (error) {
        res.status(404).json({ error: 'Journal not found' });
    }
});

// ==================== 管理 API (需要认证) ====================

// 更新 About 信息
app.put('/api/about', adminAuth, async (req, res) => {
    try {
        await fs.mkdir('public/data', { recursive: true });
        await fs.writeFile('public/data/about.json', JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save about info' });
    }
});

// 上传头像
app.post('/api/about/photo', adminAuth, uploadLimiter, uploadProfile.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ success: true, url: '/assets/profile.jpg?t=' + Date.now() });
});

// 上传照片到 Moments
app.post('/api/photos', adminAuth, uploadLimiter, uploadMoments.array('photos', config.maxFiles), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }
    
    // 异步生成缩略图
    for (const file of req.files) {
        const thumbPath = path.join('moments/thumbnails', file.filename);
        generateThumbnail(file.path, thumbPath);
    }
    
    res.json({ success: true, count: req.files.length });
});

// 删除 Moments 照片
app.delete('/api/photos/:filename', adminAuth, async (req, res) => {
    try {
        const filename = sanitizeFilename(req.params.filename);
        const filePath = path.join('moments/images', filename);
        const thumbPath = path.join('moments/thumbnails', filename);
        
        await fs.unlink(filePath);
        // 尝试删除缩略图
        try { await fs.unlink(thumbPath); } catch (e) {}
        
        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ error: 'File not found' });
    }
});

// 创建新游记
app.post('/api/journals', adminAuth, async (req, res) => {
    try {
        const { id, title, date, description } = req.body;
        const safeId = sanitizeFilename(id);
        const journalDir = path.join('journals', safeId);
        
        await fs.mkdir(journalDir, { recursive: true });
        
        const info = {
            title: title || 'Untitled',
            date: date || new Date().toISOString().split('T')[0],
            description: description || '',
            cover: 'cover.jpg'
        };
        
        await fs.writeFile(path.join(journalDir, 'info.json'), JSON.stringify(info, null, 2));
        res.json({ success: true, id: safeId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create journal' });
    }
});

// 更新游记信息
app.put('/api/journals/:id', adminAuth, async (req, res) => {
    try {
        const id = sanitizeFilename(req.params.id);
        const { title, date, description } = req.body;
        const infoPath = path.join('journals', id, 'info.json');
        
        const existingData = await fs.readFile(infoPath, 'utf-8');
        const info = JSON.parse(existingData);
        
        info.title = title || info.title;
        info.date = date || info.date;
        info.description = description !== undefined ? description : info.description;
        
        await fs.writeFile(infoPath, JSON.stringify(info, null, 2));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update journal' });
    }
});

// 删除游记
app.delete('/api/journals/:id', adminAuth, async (req, res) => {
    try {
        const id = sanitizeFilename(req.params.id);
        const journalDir = path.join('journals', id);
        await fs.rm(journalDir, { recursive: true, force: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete journal' });
    }
});

// 上传游记照片
app.post('/api/journals/:id/photos', adminAuth, uploadLimiter, uploadJournal.array('photos', config.maxFiles), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }
    res.json({ success: true, count: req.files.length });
});

// 删除游记照片
app.delete('/api/journals/:id/photos/:filename', adminAuth, async (req, res) => {
    try {
        const id = sanitizeFilename(req.params.id);
        const filename = sanitizeFilename(req.params.filename);
        const filePath = path.join('journals', id, filename);
        await fs.unlink(filePath);
        res.json({ success: true });
    } catch (error) {
        res.status(404).json({ error: 'File not found' });
    }
});

// ==================== 错误处理 ====================

// Multer 错误处理
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 20MB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum is 50 files.' });
        }
        return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('Invalid file type')) {
        return res.status(400).json({ error: err.message });
    }
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 所有其他路由返回主页 (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 启动服务器 ====================

app.listen(config.port, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  Kiro. Journal Server                                  ║
╠════════════════════════════════════════════════════════╣
║  Mode:    ${config.isProduction ? 'Production' : 'Development'}                                 ║
║  URL:     http://localhost:${config.port}                        ║
║  Admin:   http://localhost:${config.port}/admin.html             ║
╠════════════════════════════════════════════════════════╣
║  Admin credentials: admin / ${config.adminPassword.substring(0,8)}...                  ║
╚════════════════════════════════════════════════════════╝
    `);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Error: Port ${config.port} is already in use.`);
        process.exit(1);
    }
    throw err;
});
