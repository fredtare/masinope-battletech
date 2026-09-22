// js/mechData.js
// Handles loading and parsing mechinfo.txt and metadata mapping

const FALLBACK_MECHS = [
  {
    "name": "Archer",
    "code": "ARC",
    "size": 3,
    "move_value": 8,
    "TMM": 1,
    "damage": { "short": 2, "medium": 2, "long": 2 },
    "health": { "armor": 6, "structure": 6 }
  },
  {
    "name": "Atlas",
    "code": "AS",
    "size": 4,
    "move_value": 6,
    "TMM": 1,
    "damage": { "short": 4, "medium": 5, "long": 2 },
    "health": { "armor": 10, "structure": 8 }
  },
  {
    "name": "Commando",
    "code": "COM",
    "size": 1,
    "move_value": 12,
    "TMM": 2,
    "damage": { "short": 2, "medium": 2, "long": 0 },
    "health": { "armor": 2, "structure": 2 }
  },
  {
    "name": "Crab",
    "code": "CRB",
    "size": 2,
    "move_value": 10,
    "TMM": 2,
    "damage": { "short": 3, "medium": 2, "long": 0 },
    "health": { "armor": 5, "structure": 4 }
  },
  {
    "name": "Hunchback",
    "code": "HBK",
    "size": 2,
    "move_value": 9,
    "TMM": 1,
    "damage": { "short": 4, "medium": 3, "long": 0 },
    "health": { "armor": 5, "structure": 4 }
  },
  {
    "name": "Highlander",
    "code": "HGL",
    "size": 4,
    "move_value": 6,
    "TMM": 1,
    "damage": { "short": 5, "medium": 6, "long": 3 },
    "health": { "armor": 9, "structure": 5 }
  },
  {
    "name": "Jenner",
    "code": "JEN",
    "size": 1,
    "move_value": 14,
    "TMM": 3,
    "damage": { "short": 1, "medium": 1, "long": 0 },
    "health": { "armor": 2, "structure": 3 }
  },
  {
    "name": "Marauder",
    "code": "MAD",
    "size": 3,
    "move_value": 8,
    "TMM": 1,
    "damage": { "short": 4, "medium": 4, "long": 2 },
    "health": { "armor": 7, "structure": 3 }
  }
];

function sanitizeMechInfoText(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.endsWith(',')) {
    cleaned = cleaned.slice(0, -1);
  }
  // Fix unclosed health arrays: "health": [ { "armor": X, "Structure": Y } },
  cleaned = cleaned.replace(/("health"\s*:\s*\[\s*\{[^}]+?\})\s*\}/g, '$1] }');
  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  // Wrap into JSON array if not wrapped
  if (!cleaned.startsWith('[')) {
    cleaned = '[' + cleaned + ']';
  }
  return cleaned;
}

function normalizeMechObject(rawObj) {
  let armor = 0;
  let structure = 0;
  if (Array.isArray(rawObj.health) && rawObj.health.length > 0) {
    armor = rawObj.health[0].armor || 0;
    structure = rawObj.health[0].Structure || rawObj.health[0].structure || 0;
  } else if (rawObj.health && typeof rawObj.health === 'object') {
    armor = rawObj.health.armor || 0;
    structure = rawObj.health.Structure || rawObj.health.structure || 0;
  }

  return {
    name: rawObj.name,
    code: rawObj.code,
    size: Number(rawObj.size),
    move_value: Number(rawObj.move_value),
    TMM: Number(rawObj.TMM),
    damage: {
      short: Number(rawObj.damage?.short ?? 0),
      medium: Number(rawObj.damage?.medium ?? 0),
      long: Number(rawObj.damage?.long ?? 0)
    },
    health: {
      armor: Number(armor),
      structure: Number(structure)
    },
    cardImage: `Mechs/Cards/${rawObj.name}.png`
  };
}

async function loadMechDatabase() {
  try {
    const res = await fetch('Mechs/mechinfo.txt');
    if (res.ok) {
      const text = await res.text();
      const cleaned = sanitizeMechInfoText(text);
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`Loaded ${parsed.length} mechs from Mechs/mechinfo.txt`);
        return parsed.map(normalizeMechObject);
      }
    }
  } catch (err) {
    console.warn("Unable to fetch Mechs/mechinfo.txt directly (normal if opened directly via file://). Using embedded mech dataset.", err);
  }

  console.log(`Loaded ${FALLBACK_MECHS.length} mechs from fallback dataset.`);
  return FALLBACK_MECHS.map(normalizeMechObject);
}

// Global export for vanilla browser environment
window.MechDataModule = {
  loadMechDatabase,
  FALLBACK_MECHS
};
