/**
 * Nutrition row parser that handles Tesco's many on-pack label formats.
 *
 * Known shapes (non-exhaustive):
 * - Classic: name "Protein", value "11g" / "354kcal"
 * - Unit-in-name: "Protein (g)" / "Energy (kcal)", bare number value
 * - Split energy: "Energy kJ" → "1510", next row "kcal" → "356"
 * - Combined: "Energy (kJ / kcal)" → "1873 / 450"
 * - Energy in header: Typical Values → "195 kJ (46 kcal)"
 * - Trace / <x for negligible amounts
 */

const emptyMacros = () => ({
  energyKcal: null,
  energyKj: null,
  protein: null,
  fat: null,
  saturates: null,
  carbs: null,
  sugars: null,
  fibre: null,
  salt: null,
});

const deComma = (s) => s.replace(/(\d),(\d)/g, "$1.$2");

/** Parse a numeric cell; Trace/nil/<LOD → 0; "<1" / "less than 1" → that number. */
function num(s) {
  if (s == null) return null;
  const t = deComma(String(s)).trim();
  if (!t || t === "-" || t === "–" || t === "—") return null;
  if (/^(trace|traces|nil|n\/a|na|none)\b/i.test(t)) return 0;
  // Unit-only cells like "(g)" / "(kJ / kcal)" from broken tables
  if (/^\(?\s*[a-zµ/%\s]+\s*\)?$/i.test(t) && !/\d/.test(t)) return null;
  const m = t.match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function basisFromHeader(v) {
  const t = v.toLowerCase();
  if (t.includes("100 ml") || t.includes("100ml")) return "per_100ml";
  if (t.includes("100 g") || t.includes("100g")) return "per_100g";
  if (t.includes("serving") || t.includes("portion")) return "per_serving";
  return "unknown";
}

/** Strip trailing unit suffixes: "Protein (g)" → base + unit hint. */
function normalizeLabel(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\(([^)]*)\)\s*$/i, (_, unit) => `|||${unit.trim().toLowerCase()}`);
}

const MACRO_BASE = {
  fat: "fat",
  "fat - total": "fat",
  "total fat": "fat",
  saturates: "saturates",
  saturate: "saturates",
  "saturate fat": "saturates",
  "saturated fat": "saturates",
  "fat - saturated": "saturates",
  "of which saturates": "saturates",
  carbohydrate: "carbs",
  carbohydrates: "carbs",
  "available carbohydrate": "carbs",
  "total carbohydrate": "carbs",
  sugars: "sugars",
  "of which sugars": "sugars",
  "carbohydrate - sugars": "sugars",
  fibre: "fibre",
  fiber: "fibre",
  protein: "protein",
  salt: "salt",
  "salt equivalent": "salt",
};

/** Pull kJ / kcal out of a free-text cell.
 * @param {string|null|undefined} text
 * @param {'kj-first'|'kcal-first'|null} slashOrder
 */
function parseEnergyFromText(text, slashOrder = null) {
  if (!text) return { kj: null, kcal: null };
  const t = deComma(text);
  const kj = t.match(/(\d+(?:\.\d+)?)\s*kj/i);
  // "kcal", "kcals", "calories", or bare "Cal"
  const kcal =
    t.match(/(\d+(?:\.\d+)?)\s*kcals?\b/i) ||
    t.match(/(\d+(?:\.\d+)?)\s*calories?\b/i) ||
    t.match(/(\d+(?:\.\d+)?)\s*cal\b/i);
  // "2449 / 588 kJ/kcal" — numbers first, unit pair at end
  const trailingUnits = t.match(
    /^\s*(\d+(?:\.\d+)?)\s*[\/|]\s*(\d+(?:\.\d+)?)\s*kj\s*[\/|]\s*kcals?\s*$/i,
  );
  if (trailingUnits) {
    return {
      kj: parseFloat(trailingUnits[1]),
      kcal: parseFloat(trailingUnits[2]),
    };
  }
  if (kj || kcal) {
    return {
      kj: kj ? parseFloat(kj[1]) : null,
      kcal: kcal ? parseFloat(kcal[1]) : null,
    };
  }
  // Bare "1873 / 450" or "0/(0)"
  const slash = t.match(
    /^\s*(\d+(?:\.\d+)?)\s*[\/|]\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?\s*$/,
  );
  if (slash) {
    if (slashOrder === "kcal-first") {
      return { kj: parseFloat(slash[2]), kcal: parseFloat(slash[1]) };
    }
    // Default EU order: kJ then kcal
    return { kj: parseFloat(slash[1]), kcal: parseFloat(slash[2]) };
  }
  // Truncated "2252 /" (kcal on the next row)
  const halfSlash = t.match(/^\s*(\d+(?:\.\d+)?)\s*[\/|]\s*$/);
  if (halfSlash) {
    return slashOrder === "kcal-first"
      ? { kj: null, kcal: parseFloat(halfSlash[1]) }
      : { kj: parseFloat(halfSlash[1]), kcal: null };
  }
  return { kj: null, kcal: null };
}

/**
 * Classify an energy-ish row name.
 * @returns {'kj'|'kcal'|'both'|'energy'|null}
 */
function energyKind(rawName, unitHint) {
  const n = rawName.trim().toLowerCase().replace(/\s+/g, " ");
  const hint = (unitHint ?? "").toLowerCase();

  // Wine shorthand: "E =", "E=", "E:", "E"
  if (/^e\s*[=:]?$/.test(n)) return "energy";
  // Placeholder row whose value holds the energy: name "-"
  if (n === "-" || n === "–" || n === "—") return "energy";

  // Standalone kcal row after a kJ row: "kcal", "(kcal)", "Kcals"
  if (/^\(?\s*kcals?\s*\)?$/.test(n)) return "kcal";
  if (/^calories?\b/.test(n)) return "kcal";
  if (hint === "kcal" || hint === "kcals" || hint === "cal") {
    if (/^energy/.test(n) || /^calories?/.test(n) || !n) return "kcal";
  }

  if (
    !/^energy\b/.test(n) &&
    n !== "kcal" &&
    n !== "kcals" &&
    !/^calories?\b/.test(n)
  ) {
    return null;
  }

  const blob = `${n} ${hint}`;
  if (/kj\s*[\/|&]\s*kcals?|kcals?\s*[\/|&]\s*kj/.test(blob)) return "both";
  if (/kcal\s*\/\s*\(?\s*kj|calories?\s*\/\s*\(?\s*kj/.test(blob)) return "both";
  if (/\bkcals?\b/.test(blob) && !/\bkj\b/.test(blob)) return "kcal";
  if (/\bkj\b/.test(blob) && !/\bkcals?\b/.test(blob)) return "kj";
  if (/\bkcals?\b/.test(blob) && /\bkj\b/.test(blob)) return "both";
  return "energy";
}

function slashOrderFromLabel(rawName, unitHint) {
  const blob = `${rawName} ${unitHint ?? ""}`.toLowerCase();
  // "Energy kcal/(kJ)" → kcal first
  if (/kcal\s*\/\s*\(?\s*kj|calories?\s*\/\s*\(?\s*kj/.test(blob)) {
    return "kcal-first";
  }
  return "kj-first";
}

/**
 * @param {unknown[]} rows
 * @returns {{ basis: string, macros: Record<string, number|null> } | null}
 */
export function parseNutritionRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const macros = emptyMacros();
  let basis = "unknown";
  let expectKcalNext = false;

  for (const r of rows) {
    const row = r ?? {};
    const rawName = typeof row.name === "string" ? row.name.trim() : "";
    const value1 =
      typeof row.value1 === "string"
        ? deComma(row.value1.trim())
        : row.value1 != null
          ? deComma(String(row.value1).trim())
          : null;
    if (!rawName) continue;

    // Previous row was kJ-only — this row may be bare "kcal" / "(kcal)" / "-" + number.
    if (expectKcalNext) {
      expectKcalNext = false;
      const kind = energyKind(rawName, null);
      const fromText = parseEnergyFromText(value1);
      if (fromText.kcal != null) {
        macros.energyKcal = fromText.kcal;
        if (fromText.kj != null) macros.energyKj = fromText.kj;
        continue;
      }
      const n = num(value1);
      if (
        n != null &&
        (kind === "kcal" ||
          rawName === "-" ||
          rawName === "–" ||
          rawName === "—" ||
          (kind === "energy" && !/kj/i.test(value1 ?? "")))
      ) {
        macros.energyKcal = n;
        continue;
      }
      // fall through and parse this row normally
    }

    const isHeader =
      /typical values/i.test(rawName) ||
      (value1 && /per\s*100|per\s*serving|per\s*portion/i.test(value1));

    if (isHeader) {
      if (value1) {
        const b = basisFromHeader(value1);
        if (b !== "unknown") basis = b;
        // Red Bull-style: energy jammed into the header cell.
        const e = parseEnergyFromText(value1);
        if (e.kcal != null) macros.energyKcal = e.kcal;
        if (e.kj != null) macros.energyKj = e.kj;
      }
      continue;
    }

    const normalized = normalizeLabel(rawName);
    const [base, unitHint] = normalized.split("|||");
    let baseLabel = (base ?? "").replace(/^of which\s+/i, "of which ").trim();

    // Names that are entirely parenthetical: "(of which Saturates)", "(kcal)"
    if (!baseLabel && unitHint) {
      if (/^kcals?$/.test(unitHint)) {
        macros.energyKcal = num(value1);
        continue;
      }
      baseLabel = unitHint.replace(/^of which\s+/i, "of which ").trim();
    }

    const kind = energyKind(rawName, unitHint);
    if (kind) {
      if (kind === "kcal") {
        macros.energyKcal = num(value1);
        continue;
      }
      if (kind === "kj") {
        macros.energyKj = num(value1);
        expectKcalNext = macros.energyKcal == null;
        continue;
      }
      if (kind === "both" || kind === "energy") {
        const order = slashOrderFromLabel(rawName, unitHint);
        const e = parseEnergyFromText(value1 ?? "", order);
        if (e.kj != null) macros.energyKj = e.kj;
        if (e.kcal != null) macros.energyKcal = e.kcal;
        if (e.kj != null && e.kcal == null && macros.energyKcal == null) {
          expectKcalNext = true;
        }
        // Bare single number on generic "Energy" — don't guess unit.
        continue;
      }
    }

    // "Contains negligible amounts of Fat, … Protein and Salt"
    if (/negligible amounts of/i.test(rawName)) {
      const named = rawName.toLowerCase();
      for (const [label, key] of Object.entries(MACRO_BASE)) {
        if (named.includes(label)) {
          if (macros[key] == null) macros[key] = 0;
        }
      }
      continue;
    }

    const key = MACRO_BASE[baseLabel];
    if (key) {
      macros[key] = num(value1);
      continue;
    }
  }

  const hasAny = Object.values(macros).some((v) => typeof v === "number");
  if (!hasAny) return null;

  // If the label only printed kJ, derive kcal (1 kcal ≈ 4.184 kJ).
  if (macros.energyKcal == null && macros.energyKj != null) {
    macros.energyKcal = Math.round((macros.energyKj / 4.184) * 10) / 10;
  }

  return { basis, macros };
}

/**
 * Prefer our parser; fall back to basketeer's Nutrition object if present.
 * @param {{ nutrition?: { basis?: string|null, macros?: Record<string, number|null>|null, raw?: unknown[] }|null, macros?: Record<string, number|null>|null, raw?: any }} product
 */
export function extractMacros(product) {
  const rows =
    product?.nutrition?.raw ??
    product?.raw?.details?.nutrition ??
    null;

  if (Array.isArray(rows) && rows.length) {
    const parsed = parseNutritionRows(rows);
    if (parsed) {
      return {
        nutritionBasis:
          parsed.basis !== "unknown"
            ? parsed.basis
            : (product?.nutrition?.basis ?? null),
        ...parsed.macros,
      };
    }
  }

  const macros = product?.macros ?? product?.nutrition?.macros ?? null;
  if (!macros) {
    return {
      nutritionBasis: product?.nutrition?.basis ?? null,
      energyKcal: null,
      energyKj: null,
      protein: null,
      fat: null,
      saturates: null,
      carbs: null,
      sugars: null,
      fibre: null,
      salt: null,
    };
  }

  return {
    nutritionBasis: product?.nutrition?.basis ?? null,
    energyKcal: macros.energyKcal ?? null,
    energyKj: macros.energyKj ?? null,
    protein: macros.protein ?? null,
    fat: macros.fat ?? null,
    saturates: macros.saturates ?? null,
    carbs: macros.carbs ?? null,
    sugars: macros.sugars ?? null,
    fibre: macros.fibre ?? null,
    salt: macros.salt ?? null,
  };
}
