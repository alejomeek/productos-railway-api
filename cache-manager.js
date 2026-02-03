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
  console.log('=å Iniciando carga de datos desde Firebase...');
  const startTime = Date.now();

  if (!db) initFirebase();

  // Cargar embeddings
  console.log('  ’ Cargando embeddings...');
  const embeddingsSnapshot = await db.collection('productos_embeddings').get();

  EMBEDDINGS_CACHE = embeddingsSnapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      embedding: data.embedding,
      text: data.text_embedded || ''
    };
  });

  console.log(`   ${EMBEDDINGS_CACHE.length} embeddings cargados`);

  // Cargar productos
  console.log('  ’ Cargando productos...');
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

  console.log(`   ${Object.keys(PRODUCTS_CACHE).length} productos cargados`);

  CACHE_TIMESTAMP = new Date();

  const duration = Date.now() - startTime;
  const memUsage = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

  console.log(` Cache inicializado en ${duration}ms`);
  console.log(`=¾ Memoria usada: ${memUsage}MB`);
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
