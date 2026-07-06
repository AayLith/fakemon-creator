const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = 8090;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Dossier de sauvegarde local pour vos exports de Fakemons
const EXPORT_DIR = path.join(__dirname, 'exports');
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR);


// Analyseur pour vos fichiers de Pet Mod personnalisés (pokedex, learnsets, etc.)
function parseCustomModTS(tsContent) {
    try {
        if (!tsContent || typeof tsContent !== 'string') return "{}";
        const equalIndex = tsContent.indexOf('=');
        if (equalIndex === -1) return "{}";
        const firstBrace = tsContent.indexOf('{', equalIndex);
        const lastBrace = tsContent.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) return "{}";
        return tsContent.slice(firstBrace, lastBrace + 1).trim();
    } catch (e) {
        return "{}";
    }
}

// Extracteur de métadonnées pour le fichier moves.ts de Smogon
function parseMovesToJSON(text) {
    const moves = {};
    if (!text) return "{}";
    const lines = text.split('\n');
    let currentId = null;
    let currentMove = null;
    let depth = 0;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;

        if (!currentId) {
            const startMatch = line.match(/^['"]?([a-zA-Z0-9_-]+)['"]?:\s*\{/);
            if (startMatch) {
                const id = startMatch[1];
                // Évite de confondre un sous-ensemble (comme flags) avec une attaque
                if (!['flags', 'secondary', 'boosts', 'baseStats', 'abilities', 'types', 'learnset'].includes(id)) {
                    currentId = id;
                    currentMove = {};
                    depth = 1;
                    continue;
                }
            }
        }

        if (currentId && currentMove) {
            depth += openBraces - closeBraces;
            if (depth <= 0) {
                if (currentMove.name || currentId) moves[currentId] = currentMove;
                currentId = null;
                currentMove = null;
                continue;
            }

            if (depth === 1) {
                if (line.startsWith('name:')) {
                    const m = line.match(/name:\s*["']([^"']+)["']/);
                    if (m) currentMove.name = m[1];
                } else if (line.startsWith('type:')) {
                    const m = line.match(/type:\s*["']([^"']+)["']/);
                    if (m) currentMove.type = m[1];
                } else if (line.startsWith('category:')) {
                    const m = line.match(/category:\s*["']([^"']+)["']/);
                    if (m) currentMove.category = m[1];
                } else if (line.startsWith('basePower:')) {
                    const m = line.match(/basePower:\s*([0-9]+)/);
                    if (m) currentMove.basePower = parseInt(m[1], 10);
                } else if (line.startsWith('accuracy:')) {
                    if (line.includes('true')) {
                        currentMove.accuracy = true;
                    } else {
                        const m = line.match(/accuracy:\s*([0-9]+)/);
                        if (m) currentMove.accuracy = parseInt(m[1], 10);
                    }
                }
            }
        }
    }
    return JSON.stringify(moves);
}

// Extracteur de métadonnées pour le fichier abilities.ts de Smogon
function parseAbilitiesToJSON(text) {
    const abilities = {};
    if (!text) return "{}";
    const lines = text.split('\n');
    let currentId = null;
    let currentAbility = null;
    let depth = 0;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;

        if (!currentId) {
            const startMatch = line.match(/^['"]?([a-zA-Z0-9_-]+)['"]?:\s*\{/);
            if (startMatch) {
                const id = startMatch[1];
                if (!['flags', 'secondary', 'boosts', 'baseStats', 'abilities', 'types', 'learnset'].includes(id)) {
                    currentId = id;
                    currentAbility = {};
                    depth = 1;
                    continue;
                }
            }
        }

        if (currentId && currentAbility) {
            depth += openBraces - closeBraces;
            if (depth <= 0) {
                if (currentAbility.name || currentId) abilities[currentId] = currentAbility;
                currentId = null;
                currentAbility = null;
                continue;
            }

            if (depth === 1) {
                if (line.startsWith('name:')) {
                    const m = line.match(/name:\s*["']([^"']+)["']/);
                    if (m) currentAbility.name = m[1];
                }
            }
        }
    }
    return JSON.stringify(abilities);
}

// Extracteur pour les fichiers de dictionnaires texte (text/moves.ts et text/abilities.ts)
function parseTextToJSON(text) {
    const dict = {};
    if (!text) return "{}";
    const lines = text.split('\n');
    let currentId = null;
    let currentEntry = null;
    let depth = 0;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;

        if (!currentId) {
            const startMatch = line.match(/^['"]?([a-zA-Z0-9_-]+)['"]?:\s*\{/);
            if (startMatch) {
                currentId = startMatch[1];
                currentEntry = {};
                depth = 1;
                continue;
            }
        }

        if (currentId && currentEntry) {
            depth += openBraces - closeBraces;
            if (depth <= 0) {
                dict[currentId] = currentEntry;
                currentId = null;
                currentEntry = null;
                continue;
            }

            if (depth === 1) {
                if (line.startsWith('name:')) {
                    const m = line.match(/name:\s*["'\`](.*)["'\`]/);
                    if (m) currentEntry.name = m[1];
                } else if (line.startsWith('desc:')) {
                    const m = line.match(/desc:\s*["'\`](.*)["'\`]/);
                    if (m) currentEntry.desc = m[1];
                } else if (line.startsWith('shortDesc:')) {
                    const m = line.match(/shortDesc:\s*["'\`](.*)["'\`]/);
                    if (m) currentEntry.shortDesc = m[1];
                }
            }
        }
    }
    return JSON.stringify(dict);
}

// API : Charger les données globales depuis le dépôt officiel GitHub de Showdown (Gen 9)
app.get('/api/load-showdown', async (req, res) => {
    try {
        const baseUrl = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data";
        
        const [pokedexRes, formatsRes, learnsetsRes, movesRes, abilitiesRes] = await Promise.all([
            fetch(`${baseUrl}/pokedex.ts`).then(r => r.text()),
            fetch(`${baseUrl}/formats-data.ts`).then(r => r.text()),
            fetch(`${baseUrl}/learnsets.ts`).then(r => r.text()),
            fetch(`${baseUrl}/moves.ts`).then(r => r.text()),
            fetch(`${baseUrl}/abilities.ts`).then(r => r.text())
        ]);

        res.json({
            success: true,
            pokedex: parseShowdownTS(pokedexRes),
            formatsData: parseShowdownTS(formatsRes),
            learnsets: parseShowdownTS(learnsetsRes),
            moves: parseShowdownTS(movesRes),
            abilities: parseShowdownTS(abilitiesRes)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API : Sauvegarder les modifications dans des fichiers distincts
app.post('/api/save-fakemons', (req, res) => {
    try {
        const { pokedex, formatsData, learnsets, images } = req.body;

        // 1. Sauvegarde des fichiers de données au format TypeScript pour Showdown / DH2
        fs.writeFileSync(path.join(EXPORT_DIR, 'pokedex.ts'), `export const Pokedex: ModdedSpeciesDataTable = ${JSON.stringify(pokedex, null, '\t')};`);
        fs.writeFileSync(path.join(EXPORT_DIR, 'formats-data.ts'), `export const FormatsData: ModdedFormatsDataTable = ${JSON.stringify(formatsData, null, '\t')};`);
        fs.writeFileSync(path.join(EXPORT_DIR, 'learnsets.ts'), `export const Learnsets: ModdedLearnsetDataTable = ${JSON.stringify(learnsets, null, '\t')};`);

        // 2. Sauvegarde des images physiques décodées depuis le Base64 du canvas
        const imgDir = path.join(EXPORT_DIR, 'sprites');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
        if (!fs.existsSync(path.join(imgDir, 'xy'))) fs.mkdirSync(path.join(imgDir, 'xy'));
        if (!fs.existsSync(path.join(imgDir, 'icons'))) fs.mkdirSync(path.join(imgDir, 'icons'));

        for (const [id, data] of Object.entries(images)) {
            if (data.sprite) {
                const spriteBuffer = Buffer.from(data.sprite.split(',')[1], 'base64');
                fs.writeFileSync(path.join(imgDir, 'xy', `${id}.png`), spriteBuffer);
            }
            if (data.icon) {
                const iconBuffer = Buffer.from(data.icon.split(',')[1], 'base64');
                fs.writeFileSync(path.join(imgDir, 'icons', `${id}.png`), iconBuffer);
            }
        }

        res.json({ success: true, message: "Fichiers et sprites exportés avec succès dans le dossier /exports !" });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => console.log(`Fakemon Creator actif sur http://localhost:${PORT}`));

// API : Charger les données depuis un dossier de Mod GitHub spécifique
app.post('/api/load-mod', async (req, res) => {
    try {
        let { githubUrl } = req.body;
        if (!githubUrl) return res.status(400).send("URL manquante");

        let baseUrl = githubUrl.trim().replace(/\/$/, "");
        if (baseUrl.includes("github.com") && baseUrl.includes("/tree/")) {
            baseUrl = baseUrl.replace("github.com", "raw.githubusercontent.com").replace("/tree/", "/");
        }

        const smogonBaseUrl = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data";
        
        console.log(`📥 Aspiration du mod et des dictionnaires de texte Smogon...`);

        const fetchFileWithFallback = async (url, fallbackContent) => {
            const r = await fetch(url);
            if (r.status === 404) return fallbackContent;
            return r.text();
        };

        // Téléchargement des données de votre mod + Données mécaniques Smogon + Textes Smogon
        const [pokedexRes, formatsRes, learnsetsRes, movesRes, abilitiesRes, movesTextRes, abilitiesTextRes] = await Promise.all([
            fetchFileWithFallback(`${baseUrl}/pokedex.ts`, 'export const Pokedex = {};'),
            fetchFileWithFallback(`${baseUrl}/formats-data.ts`, 'export const FormatsData = {};'),
            fetchFileWithFallback(`${baseUrl}/learnsets.ts`, 'export const Learnsets = {};'),
            fetch(`${smogonBaseUrl}/moves.ts`).then(r => r.text()),
            fetch(`${smogonBaseUrl}/abilities.ts`).then(r => r.text()),
            fetch(`${smogonBaseUrl}/text/moves.ts`).then(r => r.text()),       // 🌟 Nouveau : Textes des attaques
            fetch(`${smogonBaseUrl}/text/abilities.ts`).then(r => r.text())   // 🌟 Nouveau : Textes des talents
        ]);

		res.json({
            success: true,
            pokedex: parseCustomModTS(pokedexRes),
            formatsData: parseCustomModTS(formatsRes),
            learnsets: parseCustomModTS(learnsetsRes),
            moves: parseMovesToJSON(movesRes),                  // 🌟 Utilise le nouveau filtre
            abilities: parseAbilitiesToJSON(abilitiesRes),      // 🌟 Utilise le nouveau filtre
            movesText: parseTextToJSON(movesTextRes),           // 🌟 Utilise le nouveau filtre
            abilitiesText: parseTextToJSON(abilitiesTextRes)    // 🌟 Utilise le nouveau filtre
        });
    } catch (error) {
        res.status(500).send(`Erreur interne du serveur : ${error.message}`);
    }
});