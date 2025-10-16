const express = require('express');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const execAsync = promisify(exec);

const app = express();
app.use(express.json({ limit: '50mb' }));

// API Key middleware
const API_KEY = process.env.API_KEY || '2a96434b639b4c1e889130682bd618d309f313b30f7b84f243b8a225f424a097';

app.use('/ocr-pdf', (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized - wymagany poprawny klucz API w nagłówku x-api-key' 
    });
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Główny endpoint OCR
app.post('/ocr-pdf', async (req, res) => {
  const { file_id, access_token } = req.body;
  
  if (!file_id || !access_token) {
    return res.status(400).json({ 
      error: 'Brak file_id lub access_token' 
    });
  }
  
  const timestamp = Date.now();
  const inputPath = `/tmp/input-${timestamp}.pdf`;
  const outputPath = `/tmp/output-${timestamp}.pdf`;
  
  try {
    console.log(`[${timestamp}] 📥 Pobieram PDF z Google Drive...`);
    
    // Pobierz PDF z Google Drive
    const response = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${file_id}?alt=media`,
      {
        headers: { 'Authorization': `Bearer ${access_token}` },
        responseType: 'arraybuffer',
        timeout: 30000
      }
    );
    
    console.log(`[${timestamp}] 💾 Zapisuję PDF (${response.data.byteLength} bytes)...`);
    await fs.writeFile(inputPath, response.data);
    
    console.log(`[${timestamp}] 🔍 Uruchamiam OCR...`);
    
    // OCR z timeout
    await execAsync(
      `ocrmypdf -l pol --skip-text --optimize 1 "${inputPath}" "${outputPath}"`,
      { timeout: 120000 } // 2 minuty timeout
    );
    
    console.log(`[${timestamp}] 📄 Wyciągam tekst...`);
    const { stdout } = await execAsync(`pdftotext "${outputPath}" -`);
    
    console.log(`[${timestamp}] 🧹 Sprzątam pliki...`);
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
    
    const text = stdout.trim();
    console.log(`[${timestamp}] ✅ Sukces! Wyciągnięto ${text.length} znaków`);
    
    res.json({ 
      text, 
      status: 'success',
      length: text.length
    });
    
  } catch (error) {
    console.error(`[${timestamp}] ❌ Błąd:`, error.message);
    
    // Cleanup w razie błędu
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
    
    res.status(500).json({ 
      error: error.message,
      status: 'error'
    });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Serwer OCR działa na porcie ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 OCR endpoint: POST http://localhost:${PORT}/ocr-pdf`);
  console.log(`🔑 API Key: ${API_KEY}`);
  console.log(`📝 Użyj nagłówka: x-api-key: ${API_KEY}`);
});