const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3847);
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'cookbook.sqlite');
const BACKUP_JSON_PATH = path.join(DATA_DIR, 'recipes-backup.json');
const VELINA_JPG_PATH = path.join(ROOT_DIR, 'Velina.jpg');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    prep_time_min INTEGER DEFAULT 0,
    base_servings REAL DEFAULT 1,
    image_url TEXT DEFAULT '',
    ingredients_json TEXT NOT NULL DEFAULT '[]',
    steps_json TEXT NOT NULL DEFAULT '[]',
    links_json TEXT NOT NULL DEFAULT '[]',
    chef_notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function detectLinkPlatform(urlStr) {
  if (!urlStr) return 'web';
  const lower = String(urlStr).toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.ogg')) return 'video';
  return 'web';
}

function rowToRecipe(row) {
  if (!row) return null;
  let ingredients = [];
  let steps = [];
  let links = [];
  try {
    ingredients = JSON.parse(row.ingredients_json || '[]');
  } catch (_) {
    ingredients = [];
  }
  try {
    steps = JSON.parse(row.steps_json || '[]');
  } catch (_) {
    steps = [];
  }
  try {
    links = JSON.parse(row.links_json || '[]');
  } catch (_) {
    links = [];
  }

  // Normalize ingredient fields including calories & optional flags
  ingredients = ingredients.map((ing, idx) => ({
    id: ing.id || `ing-${idx + 1}`,
    name: String(ing.name || '').trim(),
    amount: Math.max(0, Number(ing.amount) || 0),
    unit: String(ing.unit ?? 'g').trim(),
    calories: Math.max(0, Number(ing.calories) || 0),
    isOptional: Boolean(ing.isOptional),
    isEnabled: ing.isEnabled !== undefined ? Boolean(ing.isEnabled) : true,
    notes: String(ing.notes ?? '').trim()
  }));

  return {
    id: row.id,
    title: row.title,
    category: row.category || 'General',
    prepTimeMin: Number(row.prep_time_min) || 0,
    baseServings: Number(row.base_servings) || 1,
    imageUrl: row.image_url || '',
    ingredients,
    steps,
    links,
    chefNotes: row.chef_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getAllRecipes() {
  const stmt = db.prepare(`
    SELECT * FROM recipes
    ORDER BY datetime(updated_at) DESC
  `);
  return stmt.all().map(rowToRecipe);
}

function getRecipeById(id) {
  const stmt = db.prepare('SELECT * FROM recipes WHERE id = ?');
  return rowToRecipe(stmt.get(id));
}

function syncJsonBackup() {
  try {
    const all = getAllRecipes();
    const payload = {
      exportedAt: new Date().toISOString(),
      databasePath: DB_PATH,
      recipeCount: all.length,
      recipes: all
    };
    fs.writeFileSync(BACKUP_JSON_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to sync JSON backup:', err);
  }
}

function upsertRecipe(input, existingId = null) {
  const now = new Date().toISOString();
  const id = existingId || input.id || crypto.randomUUID();
  const existing = getRecipeById(id);

  const title = String(input.title || existing?.title || 'Untitled Recipe').trim();
  const category = String(input.category ?? existing?.category ?? 'General').trim() || 'General';
  const prepTimeMin = Math.max(0, Number(input.prepTimeMin ?? existing?.prepTimeMin ?? 0) || 0);
  const baseServings = Math.max(0.25, Number(input.baseServings ?? existing?.baseServings ?? 1) || 1);
  const imageUrl = String(
    input.imageUrl !== undefined ? input.imageUrl : (existing?.imageUrl || '')
  ).trim();
  const chefNotes = String(
    input.chefNotes !== undefined ? input.chefNotes : (existing?.chefNotes || '')
  );

  const rawIngredients = Array.isArray(input.ingredients)
    ? input.ingredients
    : (existing?.ingredients || []);
  const ingredients = rawIngredients
    .filter((ing) => ing && String(ing.name || '').trim().length > 0)
    .map((ing, idx) => ({
      id: ing.id || `ing-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
      name: String(ing.name).trim(),
      amount: Math.max(0, Number(ing.amount) || 0),
      unit: String(ing.unit ?? '').trim(),
      calories: Math.max(0, Number(ing.calories) || 0),
      isOptional: Boolean(ing.isOptional),
      isEnabled: ing.isEnabled !== undefined ? Boolean(ing.isEnabled) : true,
      notes: String(ing.notes ?? '').trim()
    }));

  const rawSteps = Array.isArray(input.steps) ? input.steps : (existing?.steps || []);
  const steps = rawSteps
    .map((st, idx) => {
      if (typeof st === 'string') {
        return { id: `step-${idx + 1}`, text: st.trim() };
      }
      return {
        id: st.id || `step-${idx + 1}`,
        text: String(st.text || '').trim()
      };
    })
    .filter((st) => st.text.length > 0);

  const rawLinks = Array.isArray(input.links) ? input.links : (existing?.links || []);
  const links = rawLinks
    .filter((lnk) => lnk && String(lnk.url || '').trim().length > 0)
    .map((lnk, idx) => {
      const url = String(lnk.url).trim();
      return {
        id: lnk.id || `link-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
        title: String(lnk.title || '').trim() || `Video / Link #${idx + 1}`,
        url,
        platform: lnk.platform || detectLinkPlatform(url)
      };
    });

  const createdAt = existing?.createdAt || now;
  const stmt = db.prepare(`
    INSERT INTO recipes (
      id, title, category, prep_time_min, base_servings, image_url,
      ingredients_json, steps_json, links_json, chef_notes,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      prep_time_min = excluded.prep_time_min,
      base_servings = excluded.base_servings,
      image_url = excluded.image_url,
      ingredients_json = excluded.ingredients_json,
      steps_json = excluded.steps_json,
      links_json = excluded.links_json,
      chef_notes = excluded.chef_notes,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    id,
    title,
    category,
    prepTimeMin,
    baseServings,
    imageUrl,
    JSON.stringify(ingredients),
    JSON.stringify(steps),
    JSON.stringify(links),
    chefNotes,
    createdAt,
    now
  );

  syncJsonBackup();
  return getRecipeById(id);
}

syncJsonBackup();

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({ interface: name, address: net.address, url: `http://${net.address}:${PORT}` });
      }
    }
  }
  return results;
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStaticFile(res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname === '/velina.jpg' || pathname === '/Velina.jpg') {
      if (fs.existsSync(VELINA_JPG_PATH)) {
        serveStaticFile(res, VELINA_JPG_PATH);
        return;
      }
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      const recipes = getAllRecipes();
      sendJson(res, 200, {
        ok: true,
        app: 'CookBook PC Database Server',
        port: PORT,
        databasePath: DB_PATH,
        backupJsonPath: BACKUP_JSON_PATH,
        recipeCount: recipes.length,
        localUrl: `http://127.0.0.1:${PORT}`,
        lanEndpoints: getLanAddresses()
      });
      return;
    }

    if (pathname === '/api/recipes' && req.method === 'GET') {
      sendJson(res, 200, { recipes: getAllRecipes() });
      return;
    }

    if (pathname === '/api/recipes/export' && req.method === 'GET') {
      const all = getAllRecipes();
      const body = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          app: 'CookBook Personal Recipe Database',
          recipes: all
        },
        null,
        2
      );
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="cookbook-recipes-backup.json"',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(body);
      return;
    }

    if (pathname === '/api/recipes/import' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const list = Array.isArray(body) ? body : (Array.isArray(body.recipes) ? body.recipes : []);
      if (!list.length) {
        sendJson(res, 400, { error: 'No recipes found in import file.' });
        return;
      }
      const imported = [];
      for (const item of list) {
        imported.push(upsertRecipe(item, item.id || null));
      }
      sendJson(res, 200, { importedCount: imported.length, recipes: getAllRecipes() });
      return;
    }

    if (pathname === '/api/upload-image' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (!match) {
        sendJson(res, 400, { error: 'Invalid image data URL' });
        return;
      }
      let ext = match[1].toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
      if (!['png', 'jpg', 'webp', 'gif'].includes(ext)) ext = 'png';
      const buffer = Buffer.from(match[2], 'base64');
      const fileName = `recipe-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const targetPath = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(targetPath, buffer);
      sendJson(res, 200, { imageUrl: `/uploads/${fileName}` });
      return;
    }

    if (pathname === '/api/recipes' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const created = upsertRecipe(body, null);
      sendJson(res, 201, { recipe: created, recipes: getAllRecipes() });
      return;
    }

    const recipeMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
    if (recipeMatch) {
      const id = recipeMatch[1];
      if (req.method === 'GET') {
        const recipe = getRecipeById(id);
        if (!recipe) {
          sendJson(res, 404, { error: 'Recipe not found' });
          return;
        }
        sendJson(res, 200, { recipe });
        return;
      }
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const updated = upsertRecipe(body, id);
        sendJson(res, 200, { recipe: updated, recipes: getAllRecipes() });
        return;
      }
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
        syncJsonBackup();
        sendJson(res, 200, { deletedId: id, recipes: getAllRecipes() });
        return;
      }
    }

    if (pathname.startsWith('/uploads/')) {
      const safeName = path.basename(pathname);
      serveStaticFile(res, path.join(UPLOADS_DIR, safeName));
      return;
    }

    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const fullPath = path.resolve(PUBLIC_DIR, relPath);
    if (!fullPath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    serveStaticFile(res, fullPath);
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CookBook PC Database Server listening on http://127.0.0.1:${PORT}`);
  console.log(`SQLite Database: ${DB_PATH}`);
});
