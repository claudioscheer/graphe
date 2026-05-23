/**
 * Converter registry — public API for converting module files to MyBible SQLite3.
 */
import path from 'path';
import * as myswordConverter from './mysword-converter.ts';
import * as thewordConverter from './theword-converter.ts';

type ProgressCallback = (completed: number, total: number) => void;

interface Converter {
  convert(inputPath: string, outputDir: string, onProgress?: ProgressCallback): Promise<string> | string;
}

// Registry: extension → converter module
const converters: Record<string, Converter> = {
  '.ont': thewordConverter,
  '.ontx': thewordConverter,
  '.nt': thewordConverter,
  '.ntx': thewordConverter,
  '.ot': thewordConverter,
  '.otx': thewordConverter,
  '.twm': thewordConverter,
  '.mybible': myswordConverter,
};

function getSupportedExtensions(): string[] {
  return Object.keys(converters);
}

async function convertFile(
  inputPath: string,
  outputDir: string,
  onProgress?: ProgressCallback
): Promise<string> {
  const basename = path.basename(inputPath).toLowerCase();

  // Handle compound extensions (.bbl.mybible, .dct.mybible)
  if (basename.endsWith('.bbl.mybible') || basename.endsWith('.dct.mybible')) {
    return myswordConverter.convert(inputPath, outputDir, onProgress);
  }

  const ext = path.extname(inputPath).toLowerCase();
  const converter = converters[ext];
  if (!converter) throw new Error(`Unsupported format: ${ext}`);
  return converter.convert(inputPath, outputDir, onProgress);
}

export { convertFile, getSupportedExtensions };

if (typeof module !== 'undefined') module.exports = { convertFile, getSupportedExtensions };
