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
 * Checks whether a road name has valid Vietnamese accents or is a recognized numbered road.
 * Returns false if the name contains unaccented Vietnamese words like "Nguyen Huu Canh", "Hoang Van Thu".
 */
export function isCleanVietnameseRoadName(roadName: string | null | undefined): boolean {
  if (!roadName) return false;
  const trimmed = roadName.trim();
  if (!trimmed) return false;

  // English road words indicate dirty untranslated data
  if (/\b(Street|Road|Boulevard|Avenue|Bridge|Tunnel)\b/i.test(trimmed)) {
    return false;
  }

  // Common unaccented Vietnamese surnames/particles that indicate missing accents
  const unaccentedMarkers = [
    /\bNguyen\b/i,
    /\bTran\b/i,
    /\bLe\b/i,
    /\bPham\b/i,
    /\bHoang\b/i,
    /\bPhan\b/i,
    /\bVu\b/i,
    /\bVo\b/i,
    /\bDang\b/i,
    /\bBui\b/i,
    /\bDo\b/i,
    /\bHo\b/i,
    /\bNgo\b/i,
    /\bDuong\b/i,
    /\bLy\b/i,
    /\bHuynh\b/i,
  ];

  for (const marker of unaccentedMarkers) {
    if (marker.test(trimmed) && !VIETNAMESE_ACCENT_REGEX.test(trimmed.replace(/^Đường\s+/i, ''))) {
      return false;
    }
  }

  return true;
}
