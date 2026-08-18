/**
 * Práce se souborem savu v prohlížeči.
 *
 * Schválně to není implementace `Platform` z architektury §9 — ta má smysl až
 * s Electronem a Steamem ve fázi 4. Tohle jsou dvě funkce nad DOM API.
 */

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  // Bez uvolnění by objekt držel v paměti až do zavření karty.
  URL.revokeObjectURL(url);
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
