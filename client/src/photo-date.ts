export type PhotoDateKind = "exact" | "month" | "year" | "range" | "circa";

export type PhotoDateFields = {
  kind: PhotoDateKind;
  year: string;
  month: string;
  day: string;
  yearEnd: string;
};

export type ParsedPhotoDate =
  | { kind: "exact"; year: number; month: number; day: number }
  | { kind: "month"; year: number; month: number }
  | { kind: "year"; year: number }
  | { kind: "range"; year: number; yearEnd: number }
  | { kind: "circa"; year: number };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function emptyPhotoDateFields(): PhotoDateFields {
  return {
    kind: "year",
    year: "",
    month: "",
    day: "",
    yearEnd: "",
  };
}

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

export function fieldsFromStored(stored: string | undefined): PhotoDateFields {
  if (!stored?.trim()) return emptyPhotoDateFields();
  const p = parseStoredPhotoDate(stored);
  if (!p) {
    return { kind: "year", year: stored.trim(), month: "", day: "", yearEnd: "" };
  }
  switch (p.kind) {
    case "exact":
      return {
        kind: "exact",
        year: String(p.year),
        month: String(p.month).padStart(2, "0"),
        day: String(p.day).padStart(2, "0"),
        yearEnd: "",
      };
    case "month":
      return {
        kind: "month",
        year: String(p.year),
        month: String(p.month).padStart(2, "0"),
        day: "",
        yearEnd: "",
      };
    case "year":
      return { kind: "year", year: String(p.year), month: "", day: "", yearEnd: "" };
    case "range":
      return {
        kind: "range",
        year: String(p.year),
        month: "",
        day: "",
        yearEnd: String(p.yearEnd),
      };
    case "circa":
      return { kind: "circa", year: String(p.year), month: "", day: "", yearEnd: "" };
  }
}

function validYear(y: string): number | null {
  const n = Number(y);
  if (!Number.isInteger(n) || n < 1000 || n > 9999) return null;
  return n;
}

/** Canonical string for JSON sidecar + DB `event_date`. Empty string clears the date. */
export function storedFromFields(fields: PhotoDateFields): string {
  switch (fields.kind) {
    case "year": {
      const y = validYear(fields.year);
      return y != null ? String(y) : "";
    }
    case "month": {
      const y = validYear(fields.year);
      const m = Number(fields.month);
      if (y == null || !Number.isInteger(m) || m < 1 || m > 12) return "";
      return `${y}-${String(m).padStart(2, "0")}`;
    }
    case "exact": {
      const y = validYear(fields.year);
      const m = Number(fields.month);
      const d = Number(fields.day);
      if (y == null || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) {
        return "";
      }
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    case "range": {
      const y1 = validYear(fields.year);
      const y2 = validYear(fields.yearEnd);
      if (y1 == null || y2 == null) return "";
      const lo = Math.min(y1, y2);
      const hi = Math.max(y1, y2);
      return `${lo}-${hi}`;
    }
    case "circa": {
      const y = validYear(fields.year);
      return y != null ? `c. ${y}` : "";
    }
  }
}

export function displayPhotoDate(stored: string | undefined | null): string | null {
  if (!stored?.trim()) return null;
  const p = parseStoredPhotoDate(stored);
  if (!p) return stored.trim();
  switch (p.kind) {
    case "exact":
      return new Date(p.year, p.month - 1, p.day).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    case "month":
      return `${MONTH_NAMES[p.month - 1]} ${p.year}`;
    case "year":
      return String(p.year);
    case "range":
      return `${p.year}–${p.yearEnd}`;
    case "circa":
      return `c. ${p.year}`;
  }
}

export function parseYearFromStored(stored: string): number | null {
  const p = parseStoredPhotoDate(stored);
  if (p) return p.year;
  const m = stored.trim().match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** Ascending sort key; undated photos sort first. */
export function photoDateSortKey(stored: string | undefined | null): number {
  if (!stored?.trim()) return 0;
  const p = parseStoredPhotoDate(stored);
  if (!p) return 0;
  switch (p.kind) {
    case "exact":
      return p.year * 10_000 + p.month * 100 + p.day;
    case "month":
      return p.year * 10_000 + p.month * 100;
    case "year":
    case "circa":
      return p.year * 10_000;
    case "range":
      return p.year * 10_000;
  }
}

export function comparePhotosByDate(
  a: { metadata: { date?: string }; filename: string },
  b: { metadata: { date?: string }; filename: string },
): number {
  const ka = photoDateSortKey(a.metadata.date);
  const kb = photoDateSortKey(b.metadata.date);
  if (ka !== kb) return ka - kb;
  return a.filename.localeCompare(b.filename, undefined, { sensitivity: "base" });
}

export function sortPhotosByDate<T extends { metadata: { date?: string }; filename: string }>(
  photos: T[],
): T[] {
  return [...photos].sort(comparePhotosByDate);
}

export function exactDateInputValue(fields: PhotoDateFields): string {
  if (fields.kind !== "exact") return "";
  const y = validYear(fields.year);
  const m = Number(fields.month);
  const d = Number(fields.day);
  if (y == null || !Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(d) || d < 1 || d > 31) {
    return "";
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function fieldsFromExactDateInput(iso: string, prev: PhotoDateFields): PhotoDateFields {
  if (!iso.trim()) return { ...prev, year: "", month: "", day: "" };
  const p = parseStoredPhotoDate(iso);
  if (p?.kind === "exact") {
    return {
      kind: "exact",
      year: String(p.year),
      month: String(p.month).padStart(2, "0"),
      day: String(p.day).padStart(2, "0"),
      yearEnd: "",
    };
  }
  return prev;
}
