import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.post("/api/search", async (req, res) => {
    try {
      const { prompt, lat, lng } = req.body;
      
      const envKeys = Object.keys(process.env);
      
      // Try standard names first
      let apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
      
      // If not found, look for ANY key that starts with AIza (typical for Google API keys)
      if (!apiKey) {
        const potentialKeyName = envKeys.find(key => 
          process.env[key] && 
          typeof process.env[key] === 'string' && 
          process.env[key]?.startsWith('AIza')
        );
        if (potentialKeyName) {
          apiKey = process.env[potentialKeyName];
          console.log(`Using potential API key from: ${potentialKeyName}`);
        }
      }

      if (!apiKey) {
        return res.status(500).json({ 
          error: "Chiave API non trovata nel server.",
          details: `Variabili d'ambiente rilevate: ${envKeys.filter(k => !k.startsWith('NODE_') && !k.startsWith('VITE_')).join(', ')}.`,
          suggestion: "Assicurati di aver aggiunto 'GEMINI_API_KEY' nei Secrets delle impostazioni di AI Studio e di aver salvato."
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [
            { googleMaps: {} },
            { googleSearch: {} }
          ],
          toolConfig: {
            retrievalConfig: lat && lng ? {
              latLng: {
                latitude: lat,
                longitude: lng
              }
            } : undefined
          }
        },
      });

      res.json({ 
        text: response.text,
        groundingMetadata: response.candidates?.[0]?.groundingMetadata 
      });
    } catch (error: any) {
      console.error("Gemini Error:", error);
      res.status(500).json({ error: error.message || "Errore durante la ricerca." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
