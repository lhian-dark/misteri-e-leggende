import React, { useState, useEffect, useCallback } from 'react';
import { 
  Ghost, 
  MapPin, 
  Navigation, 
  Loader2, 
  Info, 
  ExternalLink,
  Skull,
  Compass,
  Search,
  Plus,
  User,
  LogOut,
  Send,
  X
} from 'lucide-react';
import { auth, db } from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { GoogleGenAI } from "@google/genai";

// Error Boundary Component
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  public state: {hasError: boolean, error: any};
  public props: {children: React.ReactNode};
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
    this.props = props;
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const state = this.state as { hasError: boolean, error: any };
    if (state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'white', background: '#300', minHeight: '100vh', fontFamily: 'sans-serif' }}>
          <h2>Ops! Qualcosa è andato storto nell'interfaccia.</h2>
          <p>L'app ha riscontrato un errore di visualizzazione.</p>
          <pre style={{ background: '#000', padding: '10px', overflow: 'auto' }}>
            {state.error?.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{ padding: '10px 20px', background: '#ff4e00', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            Ricarica Pagina
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Types
interface MysteryPlace {
  id?: string;
  title: string;
  description: string;
  location?: string;
  url?: string;
  isUserContributed?: boolean;
  authorName?: string;
  createdAt?: any;
}

function App() {
  console.log("Misteri & Leggende: App Start");
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [places, setPlaces] = useState<MysteryPlace[]>([]);
  const [userContributions, setUserContributions] = useState<MysteryPlace[]>([]);
  const [sources, setSources] = useState<{ uri: string; title?: string }[]>([]);
  const [radius, setRadius] = useState(100);
  const [searchCity, setSearchCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeApiKey, setActiveApiKey] = useState<string | null>(null);
  
  // Contribution Form State
  const [showContribute, setShowContribute] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize API Key
  useEffect(() => {
    const envKey = import.meta.env.VITE_GEMINI_API_KEY;
    const savedKey = window.localStorage.getItem('MISTERI_GEMINI_KEY');
    
    // Check if the key is valid (not empty and doesn't look like a placeholder)
    const isValid = (k: any) => k && typeof k === 'string' && k.startsWith('AIza') && k.length > 20;

    if (isValid(envKey)) {
      setActiveApiKey(envKey);
    } else if (isValid(savedKey)) {
      setActiveApiKey(savedKey);
    }
  }, []);

  // Global Error Handler for Debugging
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent | PromiseRejectionEvent) => {
      let message = "";
      let stack = "";
      
      if ('reason' in event) {
        message = event.reason?.message || event.reason?.toString() || "Unknown Promise Rejection";
        stack = event.reason?.stack || "";
      } else {
        message = event.message || "Unknown Error";
        stack = event.error?.stack || "";
      }

      console.error("Caught Global Error:", message, stack);
      
      // Ignore non-critical quota errors
      if (message.includes('Quota exceeded') || message.includes('429')) return;

      alert(`ERRORE CRITICO:\n${message}\n\nStack:\n${stack.substring(0, 200)}...`);
    };
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleGlobalError);
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleGlobalError);
    };
  }, []);

  // Auth Listener

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // Fetch User Contributions
  useEffect(() => {
    const q = query(collection(db, 'contributions'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      try {
        const contributions = snapshot.docs
          .map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              title: data.title,
              description: data.description,
              authorName: data.authorName,
              createdAt: data.createdAt,
              isUserContributed: true,
              lat: data.lat,
              lng: data.lng
            } as any;
          })
          // Completely strip out locally-pending items that lack a valid resolved timestamp from the server, which otherwise causes React to crash
          .filter(c => c.createdAt && typeof c.createdAt.toDate === 'function');
        
        setUserContributions(contributions);
      } catch (err) {
        console.error("Error processing contributions snapshot:", err);
      }
    }, (err) => {
      console.error("Firestore Error:", err);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login Error:", err);
      setError("Errore durante l'accesso con Google.");
    }
  };

  const logout = () => signOut(auth);

  const handleContribute = async (e: any) => {
    e.preventDefault();
    console.log("handleContribute: Starting submission...");
    if (!location) {
      console.warn("handleContribute: No location available");
      return;
    }
    
    setIsSubmitting(true);
    try {
      console.log("handleContribute: Sending to Firestore...");
      const docData = {
        title: newTitle,
        description: newDescription,
        lat: location.lat,
        lng: location.lng,
        authorId: user?.uid || "anon_" + Math.random().toString(36).substring(2, 9),
        authorName: user?.displayName || "Utente Anonimo",
        createdAt: serverTimestamp()
      };
      
      const res = await addDoc(collection(db, 'contributions'), docData);
      console.log("handleContribute: Success, docId:", res.id);
      
      setNewTitle("");
      setNewDescription("");
      setShowContribute(false);
    } catch (err) {
      console.error("Contribution Error:", err);
      setError("Errore durante il salvataggio del luogo. Permesso negato nel database.");
    } finally {
      setIsSubmitting(false);
      console.log("handleContribute: Finished.");
    }
  };

  const saveManualKey = () => {
    const key = window.prompt("Incolla qui la tua chiave API di Gemini (inizia con AIza):");
    if (key && key.startsWith('AIza') && key.length > 20) {
      window.localStorage.setItem('MISTERI_GEMINI_KEY', key);
      setActiveApiKey(key);
      setError(null);
      
      // Automatic trigger: if we already have a location or city, try searching immediately
      if (location || searchCity) {
        setTimeout(() => {
          if (location) findMysteryPlaces(location.lat, location.lng, radius);
          else if (searchCity) findMysteryPlaces(null, null, radius, searchCity);
        }, 100);
      } else {
        alert("Chiave configurata! Ora premi 'Usa la mia posizione' o cerca una città.");
      }
    } else if (key) {
      alert("Chiave non valida. Assicurati che inizi con AIza e sia corretta.");
    }
  };

  const getPosition = () => {
    setLoading(true);
    setError(null);
    setSearchCity(""); 
    
    if (!navigator.geolocation) {
      setError("La geolocalizzazione non è supportata dal tuo browser.");
      setLoading(false);
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log("Posizione ottenuta:", position.coords.latitude, position.coords.longitude);
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLoading(false);
      },
      (err) => {
        let errorMsg = "Errore nella geolocalizzazione.";
        switch(err.code) {
          case 1:
            errorMsg = "Permessi negati. Per favore, abilita la posizione nelle impostazioni del browser/telefono.";
            break;
          case 2:
            errorMsg = "Posizione non disponibile (segnale GPS debole o assente). Prova ad avvicinarti a una finestra.";
            break;
          case 3:
            errorMsg = "Richiesta scaduta (timeout). Riprova tra un istante.";
            break;
        }
        setError(errorMsg);
        setLoading(false);
        console.error("Geolocation Error:", err);
      },
      options
    );
  };

  const findMysteryPlaces = useCallback(async (lat: number | null, lng: number | null, searchRadius: number, city?: string) => {
    setSearching(true);
    setError(null);
    try {
      const locationContext = city 
        ? `nella città/paese di "${city}"` 
        : `entro ${searchRadius} km dalle coordinate: ${lat}, ${lng}`;

      const aiPrompt = `Agisci come un esperto mondiale di folklore, esoterismo, archeologia misteriosa e storia locale. Esegui una ricerca meticolosa, ossessiva e assolutamente esaustiva (utilizzando sia Google Search che Google Maps) per identificare OGNI possibile luogo legato al mistero, al paranormale, a leggende secolari o fatti storici inquietanti ${locationContext}. 

Voglio una lista lunga e dettagliata (punta a trovare almeno 15-20 luoghi). Non limitarti ai siti famosi. Cerca:
1. Leggende urbane, case infestate, palazzi con presenze, chiese sconsacrate o templi antichi.
2. Misteri legati a quartieri specifici, vicoli, piazze o monumenti dimenticati.
3. Luoghi di antichi riti, cripte, catacombe, sotterranei, bunker o ex-strutture psichiatriche.
4. Racconti popolari, miti locali, avvistamenti storici e folklore contadino.
5. Siti archeologici con leggende magiche o esoteriche.

Per OGNI luogo, usa ESATTAMENTE questo formato:
NOME: [Nome del luogo]
DESCRIZIONE: [Narrazione dettagliata, prolissa e coinvolgente del mistero, inclusi riferimenti storici e curiosità specifiche]

Sii estremamente specifico. Se un luogo ha più leggende, citale tutte.`;

      const apiKey = activeApiKey;
      
      if (!apiKey) {
        saveManualKey(); // Try to get it now
        throw new Error("Chiave API non configurata. Usa il pulsante 'Configura Chiave API' o aggiungi VITE_GEMINI_API_KEY su Render.");
      }

      console.log("Inizializzazione Gemini...");
      const genAI = new (GoogleGenAI as any)(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: aiPrompt }] }],
        tools: [
          { googleSearch: {} } as any
        ]
      });

      const response = result.response;
      const text = response.text() || "";
      const groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
      const chunks = groundingMetadata?.groundingChunks || [];
      
      // Improved parsing logic for the new format
      const extractedPlaces: MysteryPlace[] = [];
      
      // Clean up common AI markdown mistakes
      const cleanText = text.replace(/\*\*NOME\*\*:/ig, 'NOME:').replace(/\*\*DESCRIZIONE\*\*:/ig, 'DESCRIZIONE:');
      const blocks = cleanText.split(/NOME:/i).filter((b: string) => b.trim().length > 0);
      
      blocks.forEach((block: string) => {
        const parts = block.split(/DESCRIZIONE:/i);
        if (parts.length >= 2) {
          extractedPlaces.push({
            title: parts[0].trim().replace(/^[#*>\d.\-\s]+/, ''),
            description: parts[1].trim()
          });
        }
      });
      
      // Fallback parsing if AI completely ignored format and returned bullet points
      if (extractedPlaces.length === 0) {
        const lines = cleanText.split('\n');
        lines.forEach((line: string) => {
          const content = line.trim();
          if (content.match(/^[\*\-]\s+/) && content.length > 20) {
            const rawItem = content.replace(/^[\*\-]\s+/, '');
            const titleMatch = rawItem.match(/^(?:(?:[A-Z][a-z]+ )+[^è\-:.]*|.*?(?:è| - |:|\.))/);
            const title = titleMatch ? titleMatch[0].replace(/(è| - |:|\.)$/, '').replace(/[\*\"]/g, '').trim() : "Mistero Rilevato";
            extractedPlaces.push({
              title: title.length > 50 ? title.substring(0, 50) + '...' : title,
              description: rawItem
            });
          }
        });
      }
      
      // Collect all links (Maps and Web)
      const allLinks = chunks.map((chunk: any) => {
        if (chunk.maps?.uri) return { uri: chunk.maps.uri, title: chunk.maps.title, type: 'map' };
        if (chunk.web?.uri) return { uri: chunk.web.uri, title: chunk.web.title, type: 'web' };
        return null;
      }).filter(Boolean) as { uri: string; title?: string; type: string }[];

      // Merge URLs into places
      const finalPlaces = extractedPlaces.map((p) => {
        const matchingLink = allLinks.find(link => 
          (link.title && (link.title.toLowerCase().includes(p.title.toLowerCase()) || 
          p.title.toLowerCase().includes(link.title.toLowerCase())))
        );
        return {
          ...p,
          url: matchingLink?.uri
        };
      });

      setSources(allLinks.filter(l => l.type === 'web').map(l => ({ uri: l.uri, title: l.title })));
      setPlaces(finalPlaces.length > 0 ? finalPlaces : [{ 
        title: "Nessun luogo trovato", 
        description: "Non ho trovato leggende specifiche in questa zona immediata, prova a espandere la ricerca o muoverti." 
      }]);
    } catch (err: any) {
      console.error("Search Error:", err);
      let msg = "Errore durante la ricerca dei misteri.";
      
      if (err.message?.includes("API key not found") || err.message?.includes("API_KEY_INVALID") || err.message?.includes("400")) {
        msg = "Problema di configurazione del server. Riprova tra poco.";
      } else if (err.message?.includes("Quota exceeded") || err.message?.includes("429")) {
        msg = "Limite di ricerche gratuite raggiunto per oggi con Gemini. Riprova più tardi.";
      } else if (err.message) {
        msg += ` Dettagli: ${err.message}`;
      }
      setError(msg);
      setPlaces([]);
      setSources([]);
    } finally {
      setSearching(false);
    }
  }, [activeApiKey, location, radius, searchCity, saveManualKey]);

  useEffect(() => {
    if (location && !searchCity) {
      findMysteryPlaces(location.lat, location.lng, radius);
    }
  }, [location, findMysteryPlaces, radius, searchCity]);

  const handleCitySearch = (e: any) => {
    e.preventDefault();
    if (searchCity.trim()) {
      setLocation(null); // Clear GPS location when searching by city
      findMysteryPlaces(null, null, radius, searchCity);
    }
  };

  return (
    <div 
      className="min-h-screen bg-[#0a0502] text-[#e0d8d0] font-serif selection:bg-[#ff4e00]/30"
      style={{ 
        backgroundColor: '#0a0502', 
        color: '#e0d8d0', 
        minHeight: '100vh',
        width: '100%',
        margin: 0,
        padding: 0,
        overflowX: 'hidden'
      }}
    >
      {/* CSS Layout Failsafe */}
      <style>{`
        body { background-color: #0a0502; margin: 0; padding: 0; color: #e0d8d0; }
        * { box-sizing: border-box; }
        .bg-white\\/5 { background-color: rgba(255, 255, 255, 0.05); }
        .border-white\\/10 { border: 1px solid rgba(255, 255, 255, 0.1); }
        .text-white { color: #ffffff; }
        .bg-\\[\\#ff4e00\\] { background-color: #ff4e00; }
      `}</style>

      {/* Atmospheric Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-[#3a1510] rounded-full blur-[120px] opacity-40" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#ff4e00] rounded-full blur-[150px] opacity-20" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {!activeApiKey ? (
          <div className="flex flex-col items-center justify-center py-20 bg-white/5 rounded-[32px] border border-white/10 p-12 text-center">
            <Skull className="w-16 h-16 text-[#ff4e00] mb-6" />
            <h2 className="text-3xl font-bold text-white mb-4">Benvenuto nei Misteri</h2>
            <p className="text-[#e0d8d0]/60 mb-8 max-w-md">
              Per iniziare la ricerca dei luoghi paranormali, è necessario configurare la tua chiave API di Gemini.
            </p>
            <button 
              onClick={saveManualKey}
              className="px-10 py-4 bg-[#ff4e00] text-white rounded-full font-bold text-lg hover:scale-105 transition-all shadow-lg shadow-[#ff4e00]/20"
            >
              Configura Chiave API
            </button>
            <p className="mt-6 text-xs text-[#e0d8d0]/30 italic">
              La chiave inizierà con 'AIza...' e verrà salvata solo nel tuo browser.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="text-center mb-16 flex flex-col items-center justify-center">
          <div className="w-full flex justify-end mb-8">
            {user && (
              <div className="flex items-center gap-4 bg-white/5 p-2 pr-4 rounded-full border border-white/10">
                {user.photoURL && <img src={user.photoURL} alt={user.displayName || ""} className="w-8 h-8 rounded-full border border-[#ff4e00]/30" referrerPolicy="no-referrer" />}
                <span className="text-sm font-medium">{user.displayName}</span>
                <button onClick={logout} className="p-2 hover:text-[#ff4e00] transition-colors" title="Logout">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <h1
            className="text-4xl md:text-6xl font-bold tracking-tighter mb-4 text-white"
          >
            Misteri & Leggende <span className="text-[#ff4e00] block md:inline md:ml-2 text-2xl md:text-4xl opacity-80">by l'ORA BUIA</span>
          </h1>
          <p
            className="text-lg text-[#e0d8d0]/60 italic"
          >
            Esplora l'ignoto che ti circonda...
          </p>
        </header>

        {/* Action Section */}
        <section className="mb-12">
          <div className="grid gap-6">
            {/* Manual Search Input */}
            <form
              onSubmit={handleCitySearch}
              className="relative group"
            >
              <input
                type="text"
                placeholder="Inserisci una città o un paese..."
                value={searchCity}
                onChange={(e) => setSearchCity(e.target.value)}
                className="w-full px-6 py-4 bg-white/5 border border-white/10 rounded-2xl focus:outline-none focus:border-[#ff4e00]/50 transition-all text-lg placeholder:text-[#e0d8d0]/30"
              />
              <button
                type="submit"
                disabled={searching || !searchCity.trim()}
                className="absolute right-2 top-2 bottom-2 px-6 bg-[#ff4e00] text-white rounded-xl font-bold hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100"
              >
                <Search className="w-5 h-5" />
              </button>
            </form>

            {!location && !searching && !places.length ? (
              <div
                className="flex flex-col items-center justify-center p-12 rounded-[32px] bg-white/5 backdrop-blur-xl border border-white/10 text-center"
              >
                <Compass className="w-16 h-16 mb-6 text-[#ff4e00] animate-spin-slow" />
                <h2 className="text-2xl font-semibold mb-4 text-white">Pronto a scoprire?</h2>
                <p className="mb-6 text-[#e0d8d0]/70 max-w-md">
                  Puoi inserire una città qui sopra o usare la tua posizione per individuare i luoghi misteriosi.
                </p>

                <div className="w-full max-w-xs mb-8">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-[#e0d8d0]/60">Raggio di ricerca</span>
                    <span className="text-sm font-bold text-[#ff4e00]">{radius} km</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="200"
                    step="10"
                    value={radius}
                    onChange={(e) => setRadius(parseInt(e.target.value))}
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
                  />
                </div>

                <button
                  onClick={getPosition}
                  disabled={loading}
                  className="group relative flex items-center gap-3 px-8 py-4 bg-[#ff4e00] text-white rounded-full font-semibold transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                >
                  <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Navigation className="w-5 h-5" />}
                  <span className="relative">Usa la mia posizione</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-3">
                    {location ? (
                      <>
                        <MapPin className="w-5 h-5 text-[#ff4e00]" />
                        <span className="text-sm opacity-70">Posizione GPS: {location.lat.toFixed(4)}, {location.lng.toFixed(4)}</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-5 h-5 text-[#ff4e00]" />
                        <span className="text-sm opacity-70">Ricerca in: {searchCity}</span>
                      </>
                    )}
                    <span className="text-sm opacity-70">• {radius} km</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="10"
                      max="200"
                      step="10"
                      value={radius}
                      onChange={(e) => setRadius(parseInt(e.target.value))}
                      className="w-24 md:w-32 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#ff4e00]"
                    />
                    <button
                      onClick={location ? getPosition : () => findMysteryPlaces(null, null, radius, searchCity)}
                      className="text-xs uppercase tracking-widest font-bold text-[#ff4e00] hover:underline"
                    >
                      Aggiorna
                    </button>
                  </div>
                </div>

                {location && (
                  <div
                    className="flex justify-center"
                  >
                    {!showContribute ? (
                      <button
                        onClick={() => setShowContribute(true)}
                        className="flex items-center gap-2 px-6 py-3 bg-[#ff4e00]/10 hover:bg-[#ff4e00]/20 border border-[#ff4e00]/30 rounded-full text-[#ff4e00] font-bold transition-all"
                      >
                        <Plus className="w-5 h-5" />
                        Segnala un mistero qui
                      </button>
                    ) : (
                      <div className="w-full p-6 rounded-[32px] bg-white/5 border border-[#ff4e00]/30 backdrop-blur-xl">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-xl font-bold text-white">Nuova Segnalazione</h3>
                          <button onClick={() => setShowContribute(false)} className="p-2 hover:text-white transition-colors">
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                        <form onSubmit={handleContribute} className="space-y-4">
                          <div>
                            <label className="block text-xs uppercase tracking-widest text-[#e0d8d0]/40 mb-2">Nome del Luogo</label>
                            <input
                              required
                              type="text"
                              value={newTitle}
                              onChange={(e) => setNewTitle(e.target.value)}
                              placeholder="Esempio: La Villa del Pianto"
                              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-[#ff4e00]/50 outline-none transition-all"
                            />
                          </div>
                          <div>
                            <label className="block text-xs uppercase tracking-widest text-[#e0d8d0]/40 mb-2">Il Mistero</label>
                            <textarea
                              required
                              rows={4}
                              value={newDescription}
                              onChange={(e) => setNewDescription(e.target.value)}
                              placeholder="Racconta la leggenda o il fatto inquietante..."
                              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-[#ff4e00]/50 outline-none transition-all resize-none"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className="w-full flex items-center justify-center gap-2 py-4 bg-[#ff4e00] text-white rounded-xl font-bold hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                          >
                            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                            Invia Segnalazione
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Results Section */}
        <section>
          <React.Fragment>
            {searching ? (
              <div
                                className="flex flex-col items-center justify-center py-20"
              >
                <Ghost className="w-12 h-12 text-[#ff4e00] animate-bounce mb-4" />
                <p className="text-xl italic animate-pulse">Scansione profonda in corso...</p>
                <p className="text-sm text-[#e0d8d0]/40 mt-2">Interrogando archivi storici e leggende locali...</p>
              </div>
            ) : error ? (
              <div 
                                className="p-8 rounded-[32px] bg-red-500/10 border border-red-500/20 text-center"
              >
                <Info className="w-12 h-12 mx-auto mb-4 text-red-500" />
                <h3 className="text-xl font-bold text-white mb-2">Si è verificato un errore</h3>
                <p className="text-red-200/80 mb-6">{error}</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button 
                    onClick={() => location ? findMysteryPlaces(location.lat, location.lng, radius) : findMysteryPlaces(null, null, radius, searchCity)}
                    className="px-6 py-2 bg-red-500 text-white rounded-full font-bold hover:bg-red-600 transition-colors"
                  >
                    Riprova
                  </button>
                  <button 
                    onClick={saveManualKey}
                    className="px-6 py-2 bg-white/10 text-white rounded-full font-bold border border-white/20 hover:bg-white/20 transition-colors"
                  >
                    Configura Chiave API
                  </button>
                </div>
              </div>
            ) : (places.length > 0 || userContributions.length > 0) ? (
              <div 
                                className="grid gap-8"
              >
                {/* User Contributions First */}
                {userContributions.map((place, idx) => {
                  try {
                    if (!place || !place.title) return null;
                    return (
                      <div
                        key={place.id || `user-${idx}`}
                        className="group relative p-8 rounded-[32px] bg-[#ff4e00]/5 backdrop-blur-md border border-[#ff4e00]/20 hover:bg-[#ff4e00]/10 transition-all duration-500"
                      >
                        <div className="absolute top-4 right-8 flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#ff4e00] font-bold">
                          <Skull className="w-3 h-3" />
                          Segnalazione Utente
                        </div>
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                          <div className="flex-1">
                            <h3 className="text-2xl font-bold text-white mb-3 group-hover:text-[#ff4e00] transition-colors">
                              {place.title || "Mistero Senza Nome"}
                            </h3>
                            <p className="text-[#e0d8d0]/80 leading-relaxed mb-4">
                              {place.description || ""}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-[#e0d8d0]/40">
                              <User className="w-3 h-3" />
                              <span>Segnalato da {String(place.authorName || "Utente Anonimo")}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  } catch (e) {
                    return null;
                  }
                })}

                {/* AI Results */}
                {places.map((place, idx) => {
                  try {
                    if (!place || !place.title) return null;
                    return (
                      <div
                        key={`ai-${idx}`}
                        className="group relative p-8 rounded-[32px] bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 transition-all duration-500"
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                          <div className="flex-1">
                            <h3 className="text-2xl font-bold text-white mb-3 group-hover:text-[#ff4e00] transition-colors">
                              {String(place.title)}
                            </h3>
                            <p className="text-[#e0d8d0]/80 leading-relaxed mb-4">
                              {String(place.description)}
                            </p>
                          </div>
                          {place.url && (
                            <a 
                              href={place.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-[#ff4e00] text-sm transition-all self-start"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Mappa
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  } catch (e) {
                    return null;
                  }
                })}

                {sources.length > 0 && (
                  <div 
                    className="mt-12 p-8 rounded-[32px] bg-[#ff4e00]/5 border border-[#ff4e00]/20"
                  >
                    <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <Search className="w-5 h-5 text-[#ff4e00]" />
                      Approfondimenti dal Web
                    </h4>
                    <div className="flex flex-wrap gap-3">
                      {sources.map((source, idx) => {
                        if (!source || !source.uri) return null;
                        return (
                        <a 
                          key={idx}
                          href={source.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[#e0d8d0]/60 hover:text-[#ff4e00] underline decoration-[#ff4e00]/30 underline-offset-4"
                        >
                          {source.title || 'Fonte'}
                        </a>
                      )})}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </React.Fragment>
        </section>

        {/* Footer Info */}
        <footer className="mt-20 pt-8 border-t border-white/10 text-center text-sm text-[#e0d8d0]/40">
          <p>© {new Date().getFullYear()} Misteri & Leggende • Dati forniti da Google Maps</p>
        </footer>
          </>
        )}
      </main>

      <style>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 12s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
