/** Shared date parsing with client/src/photo-date.ts — keep in sync. */

export type ParsedPhotoDate =
  | { kind: "exact"; year: number; month: number; day: number }
  | { kind: "month"; year: number; month: number }
  | { kind: "year"; year: number }
  | { kind: "range"; year: number; yearEnd: number }
  | { kind: "circa"; year: number };

export function parseStoredPhotoDate(stored: string): ParsedPhotoDate | null {
  const s = stored.trim();
  if (!s) return null;

  let m = s.match(/^c\.?\s*(\d{4})$/i);
  if (m) return { kind: "circa", year: Number(m[1]) };
  m = s.match(/^circa\s+(\d{4})$/i);
  if (m) return { kind: "circa", year: Number(m[1]) };

  m = s.match(/^(\d{4})-(\d{4})$/);
  if (m) return { kind: "range", year: Number(m[1]), yearEnd: Number(m[2]) };

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { kind: "exact", year, month, day };
    }
  }

  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { kind: "month", year, month };
  }

  m = s.match(/^(\d{4})$/);
  if (m) return { kind: "year", year: Number(m[1]) };

  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return {
      kind: "exact",
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    };
  }

  return null;
}

export function parseYearFromStored(stored: string): number | null {
  const p = parseStoredPhotoDate(stored);
  if (p) return p.year;
  const m = stored.trim().match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}
