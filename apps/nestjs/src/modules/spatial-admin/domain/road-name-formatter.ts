/**
 * Utility functions for canonical Vietnamese road name normalization.
 * Enforces consistent 2-tier road naming conventions:
 * 1. Strips routing and navigation direction junk from OSM (e.g. "Hướng đi đường Hồng Hà" -> "Đường Hồng Hà")
 * 2. Translates common English road/infrastructure terms (Street, Road, Boulevard, Bridge, Tunnel)
 * 3. Expands standard abbreviations (Đ., QL, TL)
 * 4. Ensures consistent infrastructure prefixing:
 *    - Preserves specific infrastructure classifications (Cầu, Hầm, Đại lộ, Xa lộ, Quốc lộ, Tỉnh lộ, Hẻm, Ngõ, Giao lộ, Nút giao, Bến)
 *    - Prefixes naked names with "Đường " (e.g. "Nguyễn Hữu Cảnh" -> "Đường Nguyễn Hữu Cảnh", "Nguyễn Văn Linh" -> "Đường Nguyễn Văn Linh")
 */

const RECOGNIZED_INFRASTRUCTURE_PREFIXES = [
  'Đường ',
  'Phố ',
  'Đại lộ ',
  'Xa lộ ',
  'Cầu ',
  'Hầm ',
  'Quốc lộ ',
  'Tỉnh lộ ',
  'Vành đai ',
  'Hẻm ',
  'Ngõ ',
  'Ngách ',
  'Đường số ',
  'Giao lộ ',
  'Nút giao ',
  'Bến ',
];

const VIETNAMESE_ACCENT_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export function formatCanonicalRoadName(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  let name = rawName.trim();
  if (!name) return null;

  // 1. Remove navigation/routing direction noise from OSM tags
  name = name.replace(/^Hướng đi\s+(đường\s+)?/i, '');
  name = name.replace(/^Lối vào\s+(đường\s+)?/i, '');
  name = name.replace(/^Lối ra\s+(đường\s+)?/i, '');
  name = name.replace(/^Đoạn qua\s+/i, '');
  name = name.trim();
  if (!name) return null;

  // 2. English suffix/prefix normalization
  name = name.replace(/(.*)\s+(Boulevard|Avenue)$/i, 'Đại lộ $1');
  name = name.replace(/(.*)\s+(Street|Road)$/i, 'Đường $1');
  name = name.replace(/^(Street|Road)\s+No\.?\s*(\d+)/i, 'Đường số $2');
  name = name.replace(/(.*)\s+Bridge$/i, 'Cầu $1');
  name = name.replace(/(.*)\s+Tunnel$/i, 'Hầm $1');

  // 3. Abbreviation expansions
  name = name.replace(/^Đ\.\s*/i, 'Đường ');
  name = name.replace(/^QL\.?\s*(\d+[A-Z]?)/i, 'Quốc lộ $1');
  name = name.replace(/^TL\.?\s*(\d+[A-Z]?)/i, 'Tỉnh lộ $1');

  // 4. Prefix standardization:
  // If it already starts with a recognized prefix, leave as is
  const hasPrefix = RECOGNIZED_INFRASTRUCTURE_PREFIXES.some((prefix) =>
    name.toLowerCase().startsWith(prefix.toLowerCase()),
  );

  if (!hasPrefix) {
    // Naked street name (e.g. "Nguyễn Hữu Cảnh", "Nguyễn Văn Linh", "Trần Quốc Hoàn")
    // Standardize to "Đường <Name>"
    name = `Đường ${name}`;
  }

  return name.trim();
}

/**
 * Checks whether a road name is a valid, clean Vietnamese name with proper diacritics.
 * Returns false if a Vietnamese street name has zero diacritics (e.g. "Dinh Tien Hoang", "Nguyen Thi Dinh").
 */
export function isCleanVietnameseRoadName(roadName: string | null | undefined): boolean {
  if (!roadName) return false;
  const trimmed = roadName.trim();
  if (!trimmed) return false;

  // Untranslated English road words indicate dirty data
  if (/\b(Street|Road|Boulevard|Avenue|Bridge|Tunnel)\b/i.test(trimmed)) {
    return false;
  }

  // Strip infrastructure classification prefix to inspect the core road name
  const core = trimmed
    .replace(
      /^(Đường|Phố|Đại lộ|Xa lộ|Cầu|Hầm|Quốc lộ|Tỉnh lộ|Vành đai|Hẻm|Ngõ|Ngách|Đoạn|Bến|Giao lộ|Nút giao)\s+/i,
      '',
    )
    .trim();

  const hasLetters = /[a-zA-Z]/.test(core);
  const isNumbered = /^(số\s+)?\d+[a-zA-Z]?$/i.test(core);

  if (hasLetters && !isNumbered) {
    // Known foreign street names in Vietnam that legitimately have no Vietnamese diacritics
    const isForeignName = /^(Pasteur|Yersin|Calmette|Alexandre\s+de\s+Rhodes)$/i.test(core);
    if (!isForeignName && !VIETNAMESE_ACCENT_REGEX.test(core)) {
      // Core name consists of words but has ZERO Vietnamese diacritics -> UNACCENTED!
      return false;
    }
  }

  return true;
}
