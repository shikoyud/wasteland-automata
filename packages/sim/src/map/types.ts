import type { NavGrid } from '../nav/grid.ts';
import type { Vec2 } from '../types.ts';

/** Matches the `pois` items of `MapInfo` in openapi.yaml. */
export type PoiKind = 'monument' | 'trader' | 'vendor' | 'recycler' | 'coast' | 'water';

export interface Poi {
  id: string;
  kind: PoiKind;
  name: string;
  pos: Vec2;
  radiusM: number;
}

export interface GameMap {
  /** The season seed the map was generated from. */
  seed: string;
  /** Which generation attempt satisfied the constraints (0 for most seeds). */
  attempt: number;
  sizeM: number;
  biomeCellM: number;
  /** 40 rows (north to south) of 40 single-letter biome codes (west to east). */
  biomes: string[];
  nav: NavGrid;
  pois: Poi[];
  /** Hash of the biomes, the nav grid and the points of interest. */
  hash: string;
}
