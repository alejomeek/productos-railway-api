# IMPLEMENTATION GUIDE - productos-railway-api

**Objetivo:** API optimizada con cache en memoria para búsqueda semántica de productos
**Deploy:** Railway
**Resultado esperado:** Búsquedas en 1-2s (vs 20s actual)

---

## FASE 1: Setup Inicial

### ☐ COMANDO 1.1: Verificar ubicación
```bash
pwd
# Debe mostrar: /Users/alejomeek/Documents/productos-railway-api
```

### ☐ COMANDO 1.2: Inicializar proyecto
```bash
npm init -y
```

### ☐ COMANDO 1.3: Instalar dependencias
```bash
npm install express cors firebase-admin openai dotenv node-cron
```

### ☐ COMANDO 1.4: Crear .gitignore
```bash
cat > .gitignore << 'EOF'
node_modules/
.env
firebase-key.json
.DS_Store
EOF
```

### ☐ COMANDO 1.5: Crear estructura de archivos
```bash
touch server.js cache-manager.js search-engine.js .env
```

**Validación Fase 1:** Ejecutar `ls -la` - Debe mostrar: server.js, cache-manager.js, search-engine.js, .env, package.json, .gitignore

---

## FASE 2: Código Core

### ☐ COMANDO 2.1: Crear cache-manager.js

```javascript
// cache-manager.js
const admin = require('firebase-admin');

let db;
let EMBEDDINGS_CACHE = [];
let PRODUCTS_CACHE = {};
let CACHE_TIMESTAMP = null;

function initFirebase() {
  if (admin.apps.length === 0) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  db = admin.firestore();
}

async function initializeCache() {
  console.log('📥 Iniciando carga de datos desde Firebase...');
  const startTime = Date.now();
  
  if (!db) initFirebase();
  
  // Cargar embeddings
  console.log('  → Cargando embeddings...');
  const embeddingsSnapshot = await db.collection('productos_embeddings').get();
  
  EMBEDDINGS_CACHE = embeddingsSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      embedding: data.embedding,
      text: data.text_embedded || ''
    };
  });
  
  console.log(`  ✅ ${EMBEDDINGS_CACHE.length} embeddings cargados`);
  
  // Cargar productos
  console.log('  → Cargando productos...');
  const productsSnapshot = await db.collection('productos').get();
  
  PRODUCTS_CACHE = {};
  productsSnapshot.docs.forEach(doc => {
    const data = doc.data();
    PRODUCTS_CACHE[doc.id] = {
      id: doc.id,
      name: data.name || '',
      price: data.price || 0,
      sku: data.sku || '',
      stock: data.stock_quantity || 0,
      image: data.image_url || '',
      description: data.description || ''
    };
  });
  
  console.log(`  ✅ ${Object.keys(PRODUCTS_CACHE).length} productos cargados`);
  
  CACHE_TIMESTAMP = new Date();
  
  const duration = Date.now() - startTime;
  const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  
  console.log(`✅ Cache inicializado en ${duration}ms`);
  console.log(`💾 Memoria usada: ${memUsage}MB`);
}

function getCachedData() {
  return {
    embeddings: EMBEDDINGS_CACHE,
    products: PRODUCTS_CACHE,
    timestamp: CACHE_TIMESTAMP
  };
}

function getCacheStats() {
  return {
    totalEmbeddings: EMBEDDINGS_CACHE.length,
    totalProducts: Object.keys(PRODUCTS_CACHE).length,
    lastUpdate: CACHE_TIMESTAMP,
    memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  };
}

module.exports = { initializeCache, getCachedData, getCacheStats };
```

### ☐ COMANDO 2.2: Crear search-engine.js

```javascript
// search-engine.js
const OpenAI = require('openai');
const { getCachedData } = require('./cache-manager');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function performSearch(query, topK = 20, threshold = 0.3) {
  const startTime = Date.now();
  
  // 1. Generar embedding del query
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;
  const embeddingTime = Date.now() - startTime;
  
  // 2. Obtener datos del cache
  const { embeddings, products } = getCachedData();
  
  // 3. Calcular similitud
  const searchStart = Date.now();
  const scores = embeddings.map(item => ({
    id: item.id,
    score: cosineSimilarity(queryEmbedding, item.embedding)
  }));
  const searchTime = Date.now() - searchStart;
  
  // 4. Ordenar y filtrar
  scores.sort((a, b) => b.score - a.score);
  const topResults = scores
    .filter(r => r.score >= threshold)
    .slice(0, topK);
  
  // 5. Enriquecer con datos de productos
  const results = topResults
    .map(r => {
      const product = products[r.id];
      if (!product) return null;
      return {
        ...product,
        matchScore: Math.round(r.score * 100),
        matchPercentage: `${Math.round(r.score * 100)}%`
      };
    })
    .filter(r => r !== null);
  
  const totalTime = Date.now() - startTime;
  
  console.log(`🔍 Búsqueda: "${query}"`);
  console.log(`  → Embedding: ${embeddingTime}ms`);
  console.log(`  → Similitud: ${searchTime}ms`);
  console.log(`  → Total: ${totalTime}ms`);
  console.log(`  → Resultados: ${results.length}`);
  
  return {
    results,
    metadata: {
      totalTime,
      embeddingTime,
      searchTime,
      totalResults: results.length
    }
  };
}

module.exports = { performSearch };
```

### ☐ COMANDO 2.3: Crear server.js

```javascript
// server.js
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const { initializeCache, getCacheStats } = require('./cache-manager');
const { performSearch } = require('./search-engine');

const app = express();
app.use(cors());
app.use(express.json());

let cacheReady = false;

// Inicializar cache al arrancar
(async () => {
  console.log('🚀 Iniciando servidor...');
  try {
    await initializeCache();
    cacheReady = true;
    console.log('✅ Servidor listo para búsquedas');
  } catch (error) {
    console.error('❌ Error inicializando cache:', error);
    process.exit(1);
  }
})();

// Refresh automático semanal (Domingos 3 AM)
cron.schedule('0 3 * * 0', async () => {
  console.log('🔄 Refresh semanal automático iniciado');
  cacheReady = false;
  await initializeCache();
  cacheReady = true;
});

// Health check
app.get('/health', (req, res) => {
  const stats = getCacheStats();
  res.json({
    status: cacheReady ? 'ok' : 'initializing',
    cacheReady,
    ...stats
  });
});

// Endpoint principal de búsqueda
app.post('/api/search', async (req, res) => {
  if (!cacheReady) {
    return res.status(503).json({
      error: 'Cache aún no está listo, intenta en unos segundos'
    });
  }
  
  try {
    const { query, topK, threshold } = req.body;
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query requerido' });
    }
    
    const searchResult = await performSearch(
      query.trim(),
      topK || 20,
      threshold || 0.3
    );
    
    res.json({
      query: query.trim(),
      ...searchResult
    });
    
  } catch (error) {
    console.error('❌ Error en búsqueda:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      message: error.message 
    });
  }
});

// Endpoint para refrescar cache (llamado por master-database)
app.post('/api/refresh-cache', async (req, res) => {
  try {
    console.log('🔄 Refresh manual solicitado');
    cacheReady = false;
    await initializeCache();
    cacheReady = true;
    res.json({ 
      success: true,
      message: 'Cache refrescado exitosamente',
      stats: getCacheStats()
    });
  } catch (error) {
    console.error('❌ Error refrescando cache:', error);
    cacheReady = true; // Volver a estado anterior
    res.status(500).json({ error: error.message });
  }
});

// Estadísticas del cache
app.get('/api/stats', (req, res) => {
  res.json(getCacheStats());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
});
```

**Validación Fase 2:** Los 3 archivos deben tener código JavaScript completo

---

## FASE 3: Configuración Local

### ☐ COMANDO 3.1: Configurar .env (PLACEHOLDER)
```bash
cat > .env << 'EOF'
PORT=3000
OPENAI_API_KEY=sk-placeholder-REEMPLAZAR
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"REEMPLAZAR"}
EOF
```

**⚠️ IMPORTANTE:** El usuario debe reemplazar los valores reales después

### ☐ COMANDO 3.2: Actualizar package.json con script de start
```bash
npm pkg set scripts.start="node server.js"
npm pkg set scripts.dev="nodemon server.js"
```

### ☐ COMANDO 3.3: Instalar nodemon (opcional, para desarrollo)
```bash
npm install --save-dev nodemon
```

**Validación Fase 3:** Ejecutar `cat package.json` - Debe tener scripts.start

---

## FASE 4: Preparación para Railway

### ☐ COMANDO 4.1: Inicializar Git
```bash
git init
git add .
git commit -m "Initial commit - Railway API con cache en memoria"
```

### ☐ COMANDO 4.2: Crear railway.json (configuración de deployment)
```bash
cat > railway.json << 'EOF'
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
EOF
```

### ☐ COMANDO 4.3: Verificar estructura final
```bash
tree -L 1 -a
```

**Estructura esperada:**
```
.
├── .env
├── .git/
├── .gitignore
├── cache-manager.js
├── node_modules/
├── package.json
├── railway.json
├── search-engine.js
└── server.js
```

**Validación Fase 4:** Git debe estar inicializado, railway.json debe existir

---

## FASE 5: Deploy a Railway (MANUAL POR USUARIO)

**⚠️ PAUSA AQUÍ - El usuario debe completar estos pasos manualmente:**

1. **Conectar Railway con el repositorio:**
   - Ir a https://railway.com/new
   - Seleccionar "Deploy from GitHub repo" o "Deploy from local repo"
   - Conectar `/Users/alejomeek/Documents/productos-railway-api`

2. **Configurar variables de entorno en Railway:**
   - `OPENAI_API_KEY` → Copiar de master-database
   - `FIREBASE_SERVICE_ACCOUNT` → Copiar JSON completo de firebase-key.json

3. **Deploy:**
   - Railway detectará automáticamente Node.js
   - Usará `npm install` y `npm start`
   - Asignará URL pública (ej: `https://productos-railway-api-production.up.railway.app`)

4. **Verificar deployment:**
   - Abrir `https://TU-URL.railway.app/health`
   - Debe mostrar: `{"status":"ok","cacheReady":true,...}`

---

## FASE 6: Testing

### ☐ COMANDO 6.1: Crear archivo de test
```bash
cat > test-api.sh << 'EOF'
#!/bin/bash

# Reemplazar con tu URL de Railway
API_URL="https://TU-URL.railway.app"

echo "🧪 Testing API..."
echo ""

# Test 1: Health check
echo "1️⃣ Health Check:"
curl -s "$API_URL/health" | jq
echo ""

# Test 2: Stats
echo "2️⃣ Cache Stats:"
curl -s "$API_URL/api/stats" | jq
echo ""

# Test 3: Búsqueda
echo "3️⃣ Búsqueda de prueba:"
curl -s -X POST "$API_URL/api/search" \
  -H "Content-Type: application/json" \
  -d '{"query":"regalo para niña activa"}' | jq
echo ""

echo "✅ Tests completados"
EOF

chmod +x test-api.sh
```

**⚠️ Usuario debe:** Editar `test-api.sh` y reemplazar `TU-URL` con la URL real de Railway

---

## FASE 7: Integración con Clientes

### Cliente 1: bot-whatsapp

**Archivo a modificar:** `bot-whatsapp/src/config.js` (o donde esté la URL)

```javascript
// ANTES:
const SEARCH_API_URL = 'https://product-matcher-mvp.vercel.app/api/mvp-search';

// DESPUÉS:
const SEARCH_API_URL = 'https://TU-URL.railway.app/api/search';
```

### Cliente 2: match-productos

**Archivo a modificar:** `match-productos/index.html`

Buscar la función de búsqueda y cambiar:

```javascript
// ANTES:
const response = await fetch('/api/mvp-search', {
  method: 'POST',
  body: JSON.stringify({ query: searchQuery })
});

// DESPUÉS:
const response = await fetch('https://TU-URL.railway.app/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: searchQuery })
});
```

---

## FASE 8: Webhook desde master-database

**Archivo a modificar:** `master-database` (script de sync/embeddings)

Al final del proceso de actualización, agregar:

```javascript
// Al final de tu script de master-database
async function notifyRailwayRefresh() {
  try {
    const response = await fetch('https://TU-URL.railway.app/api/refresh-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const result = await response.json();
    console.log('✅ Railway cache refrescado:', result);
  } catch (error) {
    console.error('⚠️  Error notificando Railway:', error.message);
  }
}

// Llamar al final
await syncWixToFirebase();
await generateEmbeddings();
await notifyRailwayRefresh(); // ← NUEVO
```

---

## ✅ CHECKLIST FINAL

- [ ] Fase 1: Setup completado
- [ ] Fase 2: Código creado (3 archivos)
- [ ] Fase 3: Configuración local
- [ ] Fase 4: Git y Railway config
- [ ] Fase 5: Deployado en Railway
- [ ] Fase 6: Tests pasaron exitosamente
- [ ] Fase 7: bot-whatsapp actualizado
- [ ] Fase 7: match-productos actualizado
- [ ] Fase 8: master-database con webhook

---

## 🎯 RESULTADOS ESPERADOS

**Antes:**
- Búsqueda: 20 segundos ❌
- Cold start: +2-3s
- Cada request lee 8K documentos

**Después:**
- Búsqueda: 1-2 segundos ✅
- Sin cold start (always-on)
- Cache en memoria

**Costos:**
- Railway: $5/mes
- OpenAI: ~$0.10/mes (solo queries)
- Total: ~$5.10/mes
