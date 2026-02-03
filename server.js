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
  console.log('=€ Iniciando servidor...');
  try {
    await initializeCache();
    cacheReady = true;
    console.log(' Servidor listo para búsquedas');
  } catch (error) {
    console.error('L Error inicializando cache:', error);
    process.exit(1);
  }
})();

// Refresh automático semanal (Domingos 3 AM)
cron.schedule('0 3 * * 0', async () => {
  console.log('= Refresh semanal automático iniciado');
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
    console.error('L Error en búsqueda:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// Endpoint para refrescar cache (llamado por master-database)
app.post('/api/refresh-cache', async (req, res) => {
  try {
    console.log('= Refresh manual solicitado');
    cacheReady = false;
    await initializeCache();
    cacheReady = true;
    res.json({
      success: true,
      message: 'Cache refrescado exitosamente',
      stats: getCacheStats()
    });
  } catch (error) {
    console.error('L Error refrescando cache:', error);
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
  console.log(`=€ Servidor escuchando en puerto ${PORT}`);
});
