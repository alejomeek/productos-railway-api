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

async function loadEmbeddingsInBatches() {
  const BATCH_SIZE = 1000;
  const allEmbeddings = [];
  let processedCount = 0;

  console.log('[LOADING] Iniciando carga por batches...');

  // Obtener IDs primero (más liviano)
  const idsSnapshot = await db.collection('productos_embeddings')
    .select('__name__')
    .get();

  const totalDocs = idsSnapshot.size;
  console.log(`[LOADING] Total documentos a cargar: ${totalDocs}`);

  // Cargar en batches
  let lastDoc = null;

  while (processedCount < totalDocs) {
    let query = db.collection('productos_embeddings')
      .orderBy('__name__')
      .limit(BATCH_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) break;

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      allEmbeddings.push({
        id: doc.id,
        embedding: data.embedding
      });
    });

    processedCount += snapshot.docs.length;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    console.log(`[LOADING] Progreso: ${processedCount}/${totalDocs} embeddings (${Math.round(processedCount / totalDocs * 100)}%)`);

    // Forzar garbage collection cada 2000 docs
    if (processedCount % 2000 === 0 && global.gc) {
      global.gc();
    }

    if (snapshot.docs.length < BATCH_SIZE) break;
  }

  console.log(`[OK] ${allEmbeddings.length} embeddings cargados en batches`);
  return allEmbeddings;
}

async function loadProductsInBatches() {
  const BATCH_SIZE = 1000;
  const allProducts = {};
  let processedCount = 0;

  const idsSnapshot = await db.collection('productos')
    .select('__name__')
    .get();

  const totalDocs = idsSnapshot.size;
  console.log(`[LOADING] Total productos a cargar: ${totalDocs}`);

  let lastDoc = null;

  while (processedCount < totalDocs) {
    let query = db.collection('productos')
      .orderBy('__name__')
      .limit(BATCH_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) break;

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      allProducts[doc.id] = {
        id: doc.id,
        name: data.name || '',
        price: data.price || 0,
        sku: data.sku || '',
        stock: data.stock?.quantity || data.inventory || 0,
        image: data.media?.mainMedia?.image?.url || data.imagen_url || data.image_url || '',
        description: data.description || ''
      };
    });

    processedCount += snapshot.docs.length;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    console.log(`[LOADING] Progreso productos: ${processedCount}/${totalDocs} (${Math.round(processedCount / totalDocs * 100)}%)`);

    if (processedCount % 2000 === 0 && global.gc) {
      global.gc();
    }

    if (snapshot.docs.length < BATCH_SIZE) break;
  }

  console.log(`[OK] ${Object.keys(allProducts).length} productos cargados`);
  return allProducts;
}

async function initializeCache() {
  console.log('[LOADING] Iniciando carga de datos desde Firebase...');
  const startTime = Date.now();

  if (!db) initFirebase();

  // Cargar embeddings en batches
  console.log('  -> Cargando embeddings...');
  EMBEDDINGS_CACHE = await loadEmbeddingsInBatches();

  // Cargar productos en batches
  console.log('  -> Cargando productos...');
  PRODUCTS_CACHE = await loadProductsInBatches();

  CACHE_TIMESTAMP = new Date();

  const duration = Date.now() - startTime;
  const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  console.log(`[OK] Cache inicializado en ${duration}ms`);
  console.log(`[MEM] Memoria usada: ${memUsage}MB`);
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
