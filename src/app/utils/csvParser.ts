// Shared CSV parsing logic for asset imports. Used by both the Upload Asset tab
// and the CSV Viewer tab, so both parse files exactly the same way.

export interface ParsedAsset {
  nama_file: string;
  asset_name: string;
  url_lightroom: string;
  type: string;
}

/**
 * The image extensions an asset filename may carry.
 *
 * Exported so `assetKey()` strips exactly the same set this does. Two separate
 * ideas of "what counts as an extension" would mean a filename could be graded
 * against the library one way and named another.
 */
export const IMAGE_EXTENSION_RE = /\.(png|jpg|jpeg|svg|webp|gif)$/i;

// Generate asset name from filename (remove prefixes and extensions)
export const generateAssetName = (filename: string): string => {
  return filename
    .replace(IMAGE_EXTENSION_RE, '') // Remove file extension
    .replace(/^(tds_si_|tds_mi_|tds_ic_)/, '') // Remove prefixes
    .replace(/_/g, ' ') // Replace underscores with spaces
    .trim();
};

// Generate type from filename prefix (fallback only)
export const generateTypeFromFilename = (filename: string): string => {
  if (filename.startsWith("tds_si_")) return "Spot";
  if (filename.startsWith("tds_mi_")) return "Micro";
  if (filename.startsWith("tds_ic_")) return "Icon";
  // Real exports use both bare ("sg_"/"ot_") and tds_-prefixed ("tds_sg_"/"tds_ot_")
  // forms for these two, so match either.
  if (filename.startsWith("sg_") || filename.startsWith("tds_sg_")) return "Supergraphic";
  if (filename.startsWith("ot_") || filename.startsWith("tds_ot_")) return "Other";
  return "General";
};

// Validate category/type value
export const validateCategory = (category: string): string => {
  const normalizedCategory = category.trim();

  // Map common variations to standard types
  const categoryMap: Record<string, string> = {
    'spot': 'Spot',
    'spot illus': 'Spot',
    'spot illustration': 'Spot',
    'micro': 'Micro',
    'micro illustration': 'Micro',
    'micro illus': 'Micro',
    'icon': 'Icon',
    'icons': 'Icon',
    'general': 'General',
    'supergraphic': 'Supergraphic'
  };

  const mappedCategory = categoryMap[normalizedCategory.toLowerCase()];
  if (mappedCategory) {
    return mappedCategory;
  }

  // Return as-is if no mapping found (capitalize first letter)
  return normalizedCategory.charAt(0).toUpperCase() + normalizedCategory.slice(1);
};

// Helper function to parse CSV row respecting quotes
export const parseCSVRow = (row: string): string[] => {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && row[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add the last field
  result.push(current.trim());
  return result;
};

// Parse CSV content with 3-column support (nama_file, url_lightroom, category)
export const parseCSV = (content: string): { assets: ParsedAsset[]; errors: string[] } => {
  const lines = content.trim().split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) {
    return { assets: [], errors: ["CSV must have at least a header and one data row"] };
  }

  // Parse headers with improved CSV parsing
  const headerRow = lines[0];
  const headers = parseCSVRow(headerRow).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const assets: ParsedAsset[] = [];
  const errors: string[] = [];

  console.log('📋 CSV Headers found:', headers);

  // Check for expected columns (case-insensitive, flexible header support)
  const possibleNameColumns = ['nama_file', 'filename', 'asset_library_name', 'name', 'file_name'];
  const possibleUrlColumns = ['url_lightroom', 'lightroom', 'url', 'link', 'lightroom_url', 'image_url'];
  const possibleCategoryColumns = ['category', 'type', 'kind', 'class', 'classification'];

  let nameColumnIndex = -1;
  let urlColumnIndex = -1;
  let categoryColumnIndex = -1;

  // Find the name column (case-insensitive)
  for (const col of possibleNameColumns) {
    const index = headers.findIndex(h => h.includes(col) || col.includes(h));
    if (index !== -1) {
      nameColumnIndex = index;
      console.log(`✅ Found name column: ${headers[index]} at index ${index}`);
      break;
    }
  }

  // Find the URL column (case-insensitive)
  for (const col of possibleUrlColumns) {
    const index = headers.findIndex(h => h.includes(col) || col.includes(h));
    if (index !== -1) {
      urlColumnIndex = index;
      console.log(`✅ Found URL column: ${headers[index]} at index ${index}`);
      break;
    }
  }

  // Find the category column (optional)
  for (const col of possibleCategoryColumns) {
    const index = headers.findIndex(h => h.includes(col) || col.includes(h));
    if (index !== -1) {
      categoryColumnIndex = index;
      console.log(`✅ Found category column: ${headers[index]} at index ${index}`);
      break;
    }
  }

  if (nameColumnIndex === -1) {
    const detailedError = `Missing required filename column.

Headers found: ${headers.join(', ')}
Expected one of: ${possibleNameColumns.join(', ')}

Please ensure your CSV has a column for the filename (nama_file, filename, or asset_library_name).`;

    errors.push(detailedError);
    return { assets, errors };
  }

  if (urlColumnIndex === -1) {
    const detailedError = `Missing required URL column.

Headers found: ${headers.join(', ')}
Expected one of: ${possibleUrlColumns.join(', ')}

Please ensure your CSV has a column for the image URL (url_lightroom, lightroom, url, or link).`;

    errors.push(detailedError);
    return { assets, errors };
  }

  console.log(`📋 Parsing ${lines.length - 1} data rows...`);
  console.log(`📊 Column mapping: filename=${nameColumnIndex}, url=${urlColumnIndex}, category=${categoryColumnIndex >= 0 ? categoryColumnIndex : 'auto-detect'}`);

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim();
    if (!row) continue; // Skip empty rows

    const values = parseCSVRow(row);

    if (values.length !== headers.length) {
      console.warn(`⚠️ Row ${i + 1} has ${values.length} columns, expected ${headers.length}. Skipping.`);
      continue; // Skip malformed rows
    }

    const nama_file = values[nameColumnIndex]?.trim().replace(/['"]/g, '');
    const url_lightroom = values[urlColumnIndex]?.trim().replace(/['"]/g, '');
    const categoryValue = categoryColumnIndex >= 0 ? values[categoryColumnIndex]?.trim().replace(/['"]/g, '') : '';

    // Validate required fields
    if (!nama_file || !url_lightroom) {
      console.warn(`⚠️ Row ${i + 1} missing required data (nama_file: "${nama_file}", url: "${url_lightroom}"). Skipping.`);
      continue; // Skip rows with missing data
    }

    // Validate URL format
    try {
      new URL(url_lightroom);
    } catch {
      console.warn(`⚠️ Row ${i + 1} has invalid URL: "${url_lightroom}". Skipping.`);
      continue; // Skip invalid URLs
    }

    // Determine category/type
    let finalCategory: string;
    if (categoryValue) {
      // Use provided category
      finalCategory = validateCategory(categoryValue);
      console.log(`📝 Using provided category: ${categoryValue} → ${finalCategory}`);
    } else {
      // Fallback to filename-based detection
      finalCategory = generateTypeFromFilename(nama_file);
      console.log(`🔍 Auto-detected category from filename: ${nama_file} → ${finalCategory}`);
    }

    // Generate asset data
    const asset: ParsedAsset = {
      nama_file: nama_file,
      asset_name: generateAssetName(nama_file),
      url_lightroom: url_lightroom,
      type: finalCategory
    };

    assets.push(asset);
  }

  console.log(`📊 CSV parsing complete: ${assets.length} valid assets parsed`);
  return { assets, errors };
};
