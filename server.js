require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const execAsync = promisify(exec);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.raw({ type: 'application/pdf', limit: '50mb' }));

// API Key middleware
const API_KEY = process.env.API_KEY;

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

// Główny endpoint OCR - obsługuje binary data, file_id lub base64
app.post('/ocr-pdf', async (req, res) => {
  const timestamp = Date.now();
  const inputPath = `/tmp/input-${timestamp}.pdf`;
  const outputPath = `/tmp/output-${timestamp}.pdf`;
  
  try {
    let pdfBuffer;
    let source = 'unknown';
    
    // Opcja 1: Binary data (najlepsze dla n8n)
    if (req.headers['content-type'] === 'application/pdf' && Buffer.isBuffer(req.body)) {
      console.log(`[${timestamp}] 📥 Otrzymano PDF jako binary data`);
      pdfBuffer = req.body;
      source = 'binary';
    }
    // Opcja 2: JSON z file_data (base64) lub file_id
    else if (req.body && typeof req.body === 'object') {
      const { file_id, file_data } = req.body;
      
      if (file_data) {
        console.log(`[${timestamp}] 📥 Otrzymano PDF jako base64`);
        pdfBuffer = Buffer.from(file_data, 'base64');
        source = 'base64';
      } else if (file_id) {
        console.log(`[${timestamp}] 📥 Pobieram PDF dla file_id: ${file_id}`);
        const downloadUrl = `https://drive.google.com/uc?id=${file_id}&export=download`;
        
        const response = await axios.get(downloadUrl, {
          responseType: 'arraybuffer',
          timeout: 30000
        });
        
        console.log(`[${timestamp}] Content-Type: ${response.headers['content-type']}`);
        pdfBuffer = Buffer.from(response.data);
        source = `file_id: ${file_id}`;
      } else {
        throw new Error('Wymagany file_id, file_data (base64) lub wyślij jako binary data (Content-Type: application/pdf)');
      }
    } else {
      throw new Error('Wyślij PDF jako binary data (Content-Type: application/pdf) lub JSON z file_id/file_data');
    }
    
    // Sprawdź czy to rzeczywiście PDF
    const firstBytes = pdfBuffer.slice(0, 4).toString();
    console.log(`[${timestamp}] Pierwsze bajty: ${firstBytes}`);
    
    if (!firstBytes.startsWith('%PDF')) {
      throw new Error('Plik nie jest PDF');
    }
    
    console.log(`[${timestamp}] 💾 Zapisuję PDF (${pdfBuffer.length} bytes)...`);
    await fs.writeFile(inputPath, pdfBuffer);
    
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
      length: text.length,
      source
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
  console.log(`📄 Body: {"file_id": "your-file-id"}`);
  console.log(`🔑 API Key: ${API_KEY}`);
  console.log(`📝 Użyj nagłówka: x-api-key: ${API_KEY}`);
});