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

  console.log(`= Búsqueda: "${query}"`);
  console.log(`  ’ Embedding: ${embeddingTime}ms`);
  console.log(`  ’ Similitud: ${searchTime}ms`);
  console.log(`  ’ Total: ${totalTime}ms`);
  console.log(`  ’ Resultados: ${results.length}`);

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
