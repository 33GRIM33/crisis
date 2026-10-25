import { withEncodedUserParams } from '@strapi/admin/strapi-admin';

import { useListQueryParams } from './useListQueryParams';

/**
 * Sort state for the assets list, backed by URL query params so the current
 * ordering is shareable and survives Back/refresh:
 *
 * - `?sort=<rule>` — a single whitelisted rule. Omitted → default (most
 *   recent updates).
 * - `?folders=mixed` — folders interleaved with files. Omitted → folders on top.
 *
 * The date rules and the direction rules are mutually exclusive: exactly one
 * rule is active at a time (one checkmark total, like the design mock). Picking
 * an option in one group clears the other; clearing the active option falls
 * back to the default — an unsorted list is not a state the UI offers.
 */

export const SORT_BY_RULES = {
  oldestUploads: 'createdAt:ASC',
  mostRecentUpdates: 'updatedAt:DESC',
} as const;

export const SORT_DIRECTION_RULES = {
  nameAsc: 'name:ASC',
  nameDesc: 'name:DESC',
  sizeAsc: 'size:ASC',
  sizeDesc: 'size:DESC',
} as const;

export type SortByKey = keyof typeof SORT_BY_RULES;
export type SortDirectionKey = keyof typeof SORT_DIRECTION_RULES;
export type FoldersPosition = 'top' | 'mixed';

const DEFAULT_SORT_BY: SortByKey = 'mostRecentUpdates';

const SORT_BY_BY_RULE = Object.fromEntries(
  Object.entries(SORT_BY_RULES).map(([key, rule]) => [rule, key])
) as Record<string, SortByKey>;

const SORT_DIRECTION_BY_RULE = Object.fromEntries(
  Object.entries(SORT_DIRECTION_RULES).map(([key, rule]) => [rule, key])
) as Record<string, SortDirectionKey>;

interface ParsedSort {
  sortBy: SortByKey | null;
  direction: SortDirectionKey | null;
  /** False when the state is the fallback default (no recognized rule in the URL). */
  isExplicit: boolean;
}

/** Parses `?sort=` — the first recognized rule wins, unknown rules are dropped. */
const parseSortParam = (raw: string | undefined): ParsedSort => {
  for (const rule of (raw ?? '').split(',')) {
    if (rule in SORT_BY_BY_RULE) {
      return { sortBy: SORT_BY_BY_RULE[rule], direction: null, isExplicit: true };
    }
    if (rule in SORT_DIRECTION_BY_RULE) {
      return { sortBy: null, direction: SORT_DIRECTION_BY_RULE[rule], isExplicit: true };
    }
  }

  return { sortBy: DEFAULT_SORT_BY, direction: null, isExplicit: false };
};

/** Columns the folders collection can be ordered by — it has no `size`. */
const FOLDER_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'];
const DEFAULT_FOLDERS_SORT = 'name:ASC';

/** Keeps the rules the folders query understands, or falls back to alphabetical. */
const toFoldersSort = (assetsSort: string, isExplicit: boolean): string => {
  if (!isExplicit) {
    return DEFAULT_FOLDERS_SORT;
  }

  const supportedRules = assetsSort
    .split(',')
    .filter((rule) => FOLDER_SORTABLE_FIELDS.includes(rule));

  if (supportedRules.length === 0) {
    return DEFAULT_FOLDERS_SORT;
  }

  return supportedRules.join(',');
};

const serializeSort = (sortBy: SortByKey | null, direction: SortDirectionKey | null): string => {
  const rules: (string | null)[] = [
    sortBy && SORT_BY_RULES[sortBy],
    direction && SORT_DIRECTION_RULES[direction],
  ];

  return rules.filter((rule): rule is string => Boolean(rule)).join(',');
};

export interface ListSort {
  sortBy: SortByKey | null;
  direction: SortDirectionKey | null;
  foldersPosition: FoldersPosition;
  /**
   * The active rule for the files query, e.g. `updatedAt:DESC` — always a
   * single rule since the sort groups are mutually exclusive.
   */
  assetsSort: string;
  /**
   * Rule applicable to the folders query. In the default state (no sort in the
   * URL) folders keep their alphabetical order so the band matches the sidebar
   * tree; an explicit user sort applies, except size rules (folders have no
   * `size` column), which fall back to alphabetical.
   */
  foldersSort: string;
  setSortBy: (key: SortByKey | null) => void;
  setDirection: (key: SortDirectionKey | null) => void;
  setFoldersPosition: (position: FoldersPosition) => void;
}

export const useListSort = (): ListSort => {
  const [{ query }, setQuery] = useListQueryParams<{
    sort?: string;
    folders?: string;
    _q?: string;
  }>();

  const { sortBy, direction, isExplicit } = parseSortParam(query?.sort);
  const foldersPosition: FoldersPosition = query?.folders === 'mixed' ? 'mixed' : 'top';

  const writeSort = (nextSortBy: SortByKey | null, nextDirection: SortDirectionKey | null) => {
    // Exactly one active rule: clearing the active one falls back to default.
    if (nextSortBy === null && nextDirection === null) {
      nextSortBy = DEFAULT_SORT_BY;
    }

    const serialized = serializeSort(nextSortBy, nextDirection);

    if (nextSortBy === DEFAULT_SORT_BY && nextDirection === null) {
      setQuery(withEncodedUserParams(query, { sort: undefined }));
    } else {
      setQuery(withEncodedUserParams(query, { sort: serialized }));
    }
  };

  // Groups are mutually exclusive — picking in one clears the other.
  const setSortBy = (key: SortByKey | null) => writeSort(key, null);
  const setDirection = (key: SortDirectionKey | null) => writeSort(null, key);

  const setFoldersPosition = (position: FoldersPosition) => {
    if (position === 'mixed') {
      setQuery(withEncodedUserParams(query, { folders: 'mixed' }));
    } else {
      setQuery(withEncodedUserParams(query, { folders: undefined }));
    }
  };

  const assetsSort = serializeSort(sortBy, direction);
  // Default state keeps folders alphabetical (matches the sidebar tree) — only
  // an explicit user sort reorders the folders band.
  const foldersSort = toFoldersSort(assetsSort, isExplicit);

  return {
    sortBy,
    direction,
    foldersPosition,
    assetsSort,
    foldersSort,
    setSortBy,
    setDirection,
    setFoldersPosition,
  };
};
