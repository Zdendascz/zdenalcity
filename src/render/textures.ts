import type { Texture } from 'pixi.js';

/**
 * Nastaví textuře vzorkování, se kterým se dá kreslit zmenšená.
 *
 * **Natažení okraje, ne opakování.** Na svahu není dlaždice rovnoběžník, takže
 * afinní matice sáhne kousek za okraj textury. S výchozím režimem tam karta
 * vrátí průhlednou — projevilo se to jako černé klíny u pobřeží — a s
 * opakováním skočí na protější okraj a udělá šev.
 *
 * **Mipmapy**, protože bez nich je z obrázků zrno. Dlaždice má obrázek 256 px,
 * ale na obrazovce je široká 64: každý pixel by vzal jeden texel ze šestnácti
 * a zbytek zahodil. Jemná kresba se tím nerozmaže, ale rozsype na jiskření.
 *
 * Změřeno na trávě, jako směrodatná odchylka vysokých frekvencí: 20,1
 * v obrázku, 22,2 při vzorkování bez filtru — tedy **zmenšením se zrno ani
 * nesnížilo** — ale jen 9,2, když se čtverec poctivě zprůměruje. Přesně to
 * mipmapa dělá. Pro srovnání, vzor z parku, který autor chválil, má 15,0, a to
 * při poloviční hustotě obrazu na dlaždici.
 *
 * Autor to nahlásil slovy „proč je všechno tak zrnité".
 */
export function sampleSmooth(texture: Texture): void {
  texture.source.addressMode = 'clamp-to-edge';
  texture.source.autoGenerateMipmaps = true;
  texture.source.updateMipmaps();
}
